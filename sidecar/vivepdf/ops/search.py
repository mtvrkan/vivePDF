import contextlib
import os
import re
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.ops._appdata import user_data_dir
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

DB_NAME = "search.sqlite"
MAX_PAGE_CHARS = 200_000
MAX_MATCHED_PAGES = 5
SNIPPET_RADIUS = 60
QUERY_ROW_LIMIT = 5000
STATUS_OK = "ok"
STATUS_UNINDEXABLE = "unindexable"
SNIPPET_OPEN = ""
SNIPPET_CLOSE = ""
REINDEX_STALE_SECONDS = 600

TERM_PATTERN = re.compile(r"[^\W_]+\*?", re.UNICODE)
TOKEN_PATTERN = re.compile(
    r"(?P<near>NEAR\(\s*(?P<near_body>[^)]*?)\s*\))"
    r"|(?P<or>\bOR\b)"
    r'|(?P<neg_phrase>-"(?P<neg_phrase_body>[^"]*)")'
    r'|(?P<phrase>"(?P<phrase_body>[^"]*)")'
    r"|(?P<neg_word>-(?P<neg_word_body>[^\W_]+\*?))"
    r"|(?P<word>[^\W_]+\*?)"
)
_TURKISH_FOLD = str.maketrans({"ş": "s", "ğ": "g", "ç": "c", "ö": "o", "ü": "u"})


def fold_text(text: str) -> str:
    text = text.replace("İ", "i").replace("I", "i")
    text = text.lower()
    text = text.replace("ı", "i")
    return text.translate(_TURKISH_FOLD)


SCHEMA_VERSION = 2


def database_path() -> Path:
    return user_data_dir() / DB_NAME


def _migrate(connection: sqlite3.Connection) -> None:
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version >= SCHEMA_VERSION:
        return
    connection.execute("DROP TABLE IF EXISTS pages")
    connection.execute("DROP TABLE IF EXISTS files")
    tables = {
        row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    if "folders" in tables:
        connection.execute("UPDATE folders SET last_indexed = NULL")
    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    connection.commit()


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(database_path())
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    _migrate(connection)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY,"
        " recursive INTEGER NOT NULL DEFAULT 1, added_at REAL NOT NULL, last_indexed REAL)"
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL,"
        " folder TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL, pages INTEGER NOT NULL,"
        " title TEXT NOT NULL DEFAULT '', indexed_at REAL NOT NULL,"
        " status TEXT NOT NULL DEFAULT 'ok', error TEXT)"
    )
    connection.execute("CREATE INDEX IF NOT EXISTS files_folder ON files(folder)")
    connection.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(text UNINDEXED, text_folded,"
        " file_id UNINDEXED, page UNINDEXED, tokenize='unicode61 remove_diacritics 2')"
    )
    return connection


@contextlib.contextmanager
def open_db() -> Iterator[sqlite3.Connection]:
    connection = connect()
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def normalize_folder(path: str) -> str:
    return str(Path(path).resolve())


def _iter_pdfs(folder: Path, recursive: bool) -> list[Path]:
    pattern = "**/*" if recursive else "*"
    found = {
        item for item in folder.glob(pattern) if item.is_file() and item.suffix.lower() == ".pdf"
    }
    return sorted(found)


def _page_texts(path: Path) -> tuple[list[str], str] | None:
    try:
        document = pymupdf.open(path)
    except Exception:
        return None
    try:
        if document.needs_pass or not document.is_pdf:
            return None
        title = str((document.metadata or {}).get("title") or "").strip()
        texts = [page.get_text()[:MAX_PAGE_CHARS] for page in document]
        return texts, title
    finally:
        document.close()


def _delete_file(connection: sqlite3.Connection, file_id: int) -> None:
    connection.execute("DELETE FROM pages WHERE file_id = ?", (file_id,))
    connection.execute("DELETE FROM files WHERE id = ?", (file_id,))


class IndexStats(RpcModel):
    indexed: int
    unchanged: int
    skipped: int
    removed: int
    pages: int


def index_folder(
    connection: sqlite3.Connection, folder: str, recursive: bool, progress: Progress | None
) -> IndexStats:
    root = Path(folder)
    if not root.is_dir():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"folder not found: {root.name}", {"path": folder})
    known = {
        row["path"]: row
        for row in connection.execute(
            "SELECT id, path, mtime, size FROM files WHERE folder = ?", (folder,)
        )
    }
    pdfs = _iter_pdfs(root, recursive)
    seen: set[str] = set()
    indexed = unchanged = skipped = pages_total = 0
    for position, pdf in enumerate(pdfs):
        if progress is not None:
            progress.check_cancelled()
        key = str(pdf)
        seen.add(key)
        try:
            stat = pdf.stat()
        except OSError:
            continue
        existing = known.get(key)
        if (
            existing
            and abs(existing["mtime"] - stat.st_mtime) < 1e-6
            and existing["size"] == stat.st_size
        ):
            unchanged += 1
            continue
        extracted = _page_texts(pdf)
        if existing:
            _delete_file(connection, existing["id"])
        if extracted is None:
            connection.execute(
                "INSERT INTO files (path, folder, mtime, size, pages, title, indexed_at, status,"
                " error) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
                (
                    key,
                    folder,
                    stat.st_mtime,
                    stat.st_size,
                    pdf.stem,
                    time.time(),
                    STATUS_UNINDEXABLE,
                    "unreadable or encrypted",
                ),
            )
            skipped += 1
            continue
        texts, title = extracted
        cursor = connection.execute(
            "INSERT INTO files (path, folder, mtime, size, pages, title, indexed_at, status)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                key,
                folder,
                stat.st_mtime,
                stat.st_size,
                len(texts),
                title or pdf.stem,
                time.time(),
                STATUS_OK,
            ),
        )
        file_id = cursor.lastrowid
        connection.executemany(
            "INSERT INTO pages (text, text_folded, file_id, page) VALUES (?, ?, ?, ?)",
            [
                (text, fold_text(text), file_id, number + 1)
                for number, text in enumerate(texts)
                if text.strip()
            ],
        )
        indexed += 1
        pages_total += len(texts)
        if progress is not None and (position + 1) % 5 == 0:
            connection.commit()
            progress.report(
                (position + 1) / max(len(pdfs), 1),
                "progress.indexing",
                {"current": position + 1, "total": len(pdfs)},
            )
    removed = 0
    for key, row in known.items():
        if key not in seen:
            _delete_file(connection, row["id"])
            removed += 1
    connection.execute("UPDATE folders SET last_indexed = ? WHERE path = ?", (time.time(), folder))
    connection.commit()
    return IndexStats(
        indexed=indexed, unchanged=unchanged, skipped=skipped, removed=removed, pages=pages_total
    )


class FolderInfo(RpcModel):
    path: str
    recursive: bool
    files: int
    pages: int
    last_indexed: float | None


class FoldersResult(RpcModel):
    folders: list[FolderInfo]
    database: str


def _folders(connection: sqlite3.Connection) -> list[FolderInfo]:
    rows = connection.execute(
        "SELECT f.path, f.recursive, f.last_indexed, COUNT(x.id) AS files,"
        " COALESCE(SUM(x.pages), 0) AS pages FROM folders f"
        " LEFT JOIN files x ON x.folder = f.path AND x.status = 'ok'"
        " GROUP BY f.path ORDER BY f.added_at"
    ).fetchall()
    return [
        FolderInfo(
            path=row["path"],
            recursive=bool(row["recursive"]),
            files=row["files"],
            pages=row["pages"],
            last_indexed=row["last_indexed"],
        )
        for row in rows
    ]


class EmptyParams(RpcModel):
    pass


@op("search.folders", EmptyParams)
def list_folders(params: EmptyParams, progress: Progress) -> FoldersResult:
    with open_db() as connection:
        return FoldersResult(folders=_folders(connection), database=str(database_path()))


class AddFolderParams(RpcModel):
    path: str
    recursive: bool = True


class AddFolderResult(RpcModel):
    folders: list[FolderInfo]
    stats: IndexStats


@op("search.add_folder", AddFolderParams)
def add_folder(params: AddFolderParams, progress: Progress) -> AddFolderResult:
    folder = normalize_folder(params.path)
    if not Path(folder).is_dir():
        raise OpError(ErrorCode.FILE_NOT_FOUND, "folder not found", {"path": params.path})
    with open_db() as connection:
        for existing in _folders(connection):
            if folder != existing.path and (
                folder.startswith(existing.path + os.sep)
                or existing.path.startswith(folder + os.sep)
            ):
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    "folder overlaps an indexed folder",
                    {"reason": "overlap", "path": existing.path},
                )
        connection.execute(
            "INSERT OR IGNORE INTO folders (path, recursive, added_at) VALUES (?, ?, ?)",
            (folder, int(params.recursive), time.time()),
        )
        connection.commit()
        stats = index_folder(connection, folder, params.recursive, progress)
        return AddFolderResult(folders=_folders(connection), stats=stats)


class RemoveFolderParams(RpcModel):
    path: str


@op("search.remove_folder", RemoveFolderParams)
def remove_folder(params: RemoveFolderParams, progress: Progress) -> FoldersResult:
    folder = normalize_folder(params.path)
    with open_db() as connection:
        ids = [
            row["id"]
            for row in connection.execute("SELECT id FROM files WHERE folder = ?", (folder,))
        ]
        for file_id in ids:
            _delete_file(connection, file_id)
        connection.execute("DELETE FROM folders WHERE path = ?", (folder,))
        connection.commit()
        return FoldersResult(folders=_folders(connection), database=str(database_path()))


class IndexParams(RpcModel):
    path: str | None = None
    force: bool = False


class IndexResult(RpcModel):
    folders: list[FolderInfo]
    stats: IndexStats


@op("search.index", IndexParams)
def index(params: IndexParams, progress: Progress) -> IndexResult:
    with open_db() as connection:
        targets = _folders(connection)
        raw_targets = {
            row["path"]: row["last_indexed"]
            for row in connection.execute("SELECT path, last_indexed FROM folders")
        }
        if params.path:
            wanted = normalize_folder(params.path)
            targets = [item for item in targets if item.path == wanted]
            if not targets:
                raise OpError(
                    ErrorCode.INVALID_PARAMS, "folder is not indexed", {"path": params.path}
                )
        elif not params.force:
            now = time.time()
            targets = [
                item
                for item in targets
                if raw_targets.get(item.path) is None
                or now - raw_targets[item.path] >= REINDEX_STALE_SECONDS
            ]
        total = IndexStats(indexed=0, unchanged=0, skipped=0, removed=0, pages=0)
        for item in targets:
            progress.check_cancelled()
            if not Path(item.path).is_dir():
                continue
            stats = index_folder(connection, item.path, item.recursive, progress)
            total = IndexStats(
                indexed=total.indexed + stats.indexed,
                unchanged=total.unchanged + stats.unchanged,
                skipped=total.skipped + stats.skipped,
                removed=total.removed + stats.removed,
                pages=total.pages + stats.pages,
            )
        return IndexResult(folders=_folders(connection), stats=total)


@op("search.clear_all", EmptyParams)
def clear_all(params: EmptyParams, progress: Progress) -> FoldersResult:
    with open_db() as connection:
        connection.execute("DELETE FROM pages")
        connection.execute("DELETE FROM files")
        connection.execute("DELETE FROM folders")
        connection.commit()
        connection.execute("VACUUM")
        return FoldersResult(folders=[], database=str(database_path()))


class StatsResult(RpcModel):
    path: str
    size_bytes: int
    files: int
    pages: int
    unindexable: int


@op("search.stats", EmptyParams)
def index_stats(params: EmptyParams, progress: Progress) -> StatsResult:
    path = database_path()
    size_bytes = 0
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(str(path) + suffix)
        try:
            size_bytes += candidate.stat().st_size
        except OSError:
            continue
    with open_db() as connection:
        row = connection.execute(
            "SELECT"
            " SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS files,"
            " SUM(CASE WHEN status = 'ok' THEN pages ELSE 0 END) AS pages,"
            " SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS unindexable"
            " FROM files"
        ).fetchone()
        return StatsResult(
            path=str(path),
            size_bytes=size_bytes,
            files=row["files"] or 0,
            pages=row["pages"] or 0,
            unindexable=row["unindexable"] or 0,
        )


def _quote_term(word: str) -> str:
    prefix = word.endswith("*")
    core = word.rstrip("*")
    folded = fold_text(core)
    if not folded:
        return ""
    return f'"{folded}"*' if prefix else f'"{folded}"'


def build_match(raw_query: str) -> str:
    parts: list[str] = []
    for token in TOKEN_PATTERN.finditer(raw_query):
        if token.group("near"):
            body = token.group("near_body")
            terms_part, _, distance_part = body.partition(",")
            terms = [fold_text(term) for term in terms_part.split() if fold_text(term)]
            if len(terms) >= 2:
                distance = distance_part.strip()
                if not distance.isdigit():
                    distance = "10"
                quoted = " ".join(f'"{term}"' for term in terms)
                parts.append(f"NEAR({quoted}, {distance})")
        elif token.group("or"):
            if parts and parts[-1] != "OR":
                parts.append("OR")
        elif token.group("neg_phrase"):
            folded = fold_text(token.group("neg_phrase_body")).strip()
            if folded:
                parts.append(f'NOT "{folded}"')
        elif token.group("phrase"):
            folded = fold_text(token.group("phrase_body")).strip()
            if folded:
                parts.append(f'"{folded}"')
        elif token.group("neg_word"):
            quoted = _quote_term(token.group("neg_word_body"))
            if quoted:
                parts.append(f"NOT {quoted}")
        elif token.group("word"):
            quoted = _quote_term(token.group("word"))
            if quoted:
                parts.append(quoted)
    while parts and parts[-1] == "OR":
        parts.pop()
    if parts and parts[0] == "OR":
        parts.pop(0)
    return " ".join(parts)


def positive_terms(raw_query: str) -> list[str]:
    terms: list[str] = []
    for token in TOKEN_PATTERN.finditer(raw_query):
        if (
            token.group("neg_phrase")
            or token.group("neg_word")
            or token.group("near")
            or token.group("or")
        ):
            continue
        if token.group("phrase"):
            folded = fold_text(token.group("phrase_body")).strip()
        elif token.group("word"):
            folded = fold_text(token.group("word")).rstrip("*")
        else:
            folded = ""
        if folded:
            terms.append(folded)
    return terms


def build_snippet(text: str, folded_text: str, terms: list[str]) -> str:
    for term in terms:
        index = folded_text.find(term)
        if index == -1:
            continue
        start = max(0, index - SNIPPET_RADIUS)
        end = min(len(text), index + len(term) + SNIPPET_RADIUS)
        before = text[start:index]
        match = text[index : index + len(term)]
        after = text[index + len(term) : end]
        prefix = "…" if start > 0 else ""
        suffix = "…" if end < len(text) else ""
        return f"{prefix}{before}{SNIPPET_OPEN}{match}{SNIPPET_CLOSE}{after}{suffix}"
    stripped = text.strip()
    return stripped[:160] + ("…" if len(stripped) > 160 else "")


class QueryParams(RpcModel):
    query: str
    limit: int = Field(default=40, ge=1, le=200)
    folder: str | None = None
    path: str | None = None
    modified_after: float | None = None
    modified_before: float | None = None
    min_pages: int | None = None
    max_pages: int | None = None


class PageHit(RpcModel):
    page: int
    snippet: str


class FileHit(RpcModel):
    path: str
    title: str
    pages: int
    folder: str
    matched_pages: list[PageHit]
    page_hits: int


class QueryResult(RpcModel):
    files: list[FileHit]
    total_files: int


@op("search.query", QueryParams)
def query(params: QueryParams, progress: Progress) -> QueryResult:
    match = build_match(params.query)
    if not match:
        return QueryResult(files=[], total_files=0)
    terms = positive_terms(params.query)
    match_cte = (
        "WITH matched AS (SELECT file_id, page, text, text_folded, bm25(pages) AS score"
        " FROM pages WHERE pages MATCH ?)"
    )
    conditions = ["f.status = 'ok'"]
    arguments: list[object] = [match]
    if params.folder:
        conditions.append("f.folder = ?")
        arguments.append(normalize_folder(params.folder))
    if params.path:
        conditions.append("f.path = ?")
        arguments.append(str(Path(params.path).resolve()))
    if params.modified_after is not None:
        conditions.append("f.mtime >= ?")
        arguments.append(params.modified_after)
    if params.modified_before is not None:
        conditions.append("f.mtime <= ?")
        arguments.append(params.modified_before)
    if params.min_pages is not None:
        conditions.append("f.pages >= ?")
        arguments.append(params.min_pages)
    if params.max_pages is not None:
        conditions.append("f.pages <= ?")
        arguments.append(params.max_pages)
    where = " AND ".join(conditions)
    with open_db() as connection:
        try:
            count_row = connection.execute(
                f"{match_cte} SELECT COUNT(DISTINCT matched.file_id) AS total FROM matched"
                f" JOIN files f ON f.id = matched.file_id WHERE {where}",
                arguments,
            ).fetchone()
        except sqlite3.OperationalError as error:
            raise OpError(ErrorCode.INVALID_PARAMS, f"invalid query: {error}") from error
        rows = connection.execute(
            f"{match_cte} SELECT matched.file_id, matched.page, matched.text, matched.text_folded"
            f" FROM matched JOIN files f ON f.id = matched.file_id WHERE {where}"
            f" ORDER BY matched.score LIMIT {QUERY_ROW_LIMIT}",
            arguments,
        ).fetchall()
        total_files = count_row["total"] or 0
        grouped: dict[int, list[sqlite3.Row]] = {}
        order: list[int] = []
        for row in rows:
            if row["file_id"] not in grouped:
                grouped[row["file_id"]] = []
                order.append(row["file_id"])
            grouped[row["file_id"]].append(row)
        files: list[FileHit] = []
        for file_id in order[: params.limit]:
            info = connection.execute(
                "SELECT path, title, pages, folder FROM files WHERE id = ?", (file_id,)
            ).fetchone()
            if info is None:
                continue
            hits = grouped[file_id]
            files.append(
                FileHit(
                    path=info["path"],
                    title=info["title"],
                    pages=info["pages"],
                    folder=info["folder"],
                    matched_pages=[
                        PageHit(
                            page=row["page"],
                            snippet=build_snippet(row["text"], row["text_folded"], terms),
                        )
                        for row in hits[:MAX_MATCHED_PAGES]
                    ],
                    page_hits=len(hits),
                )
            )
        return QueryResult(files=files, total_files=total_files)
