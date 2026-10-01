import os
import sqlite3
import time
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.search import (
    SNIPPET_CLOSE,
    SNIPPET_OPEN,
    AddFolderParams,
    EmptyParams,
    IndexParams,
    QueryParams,
    RemoveFolderParams,
    add_folder,
    build_match,
    clear_all,
    fold_text,
    index,
    index_stats,
    list_folders,
    query,
    remove_folder,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

FONT_FILE = (
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _pdf(path: Path, pages: list[str], title: str = "") -> Path:
    document = pymupdf.open()
    for text in pages:
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), text, fontname="dejavu", fontfile=str(FONT_FILE))
    if title:
        document.set_metadata({"title": title})
    document.save(path)
    document.close()
    return path


@pytest.fixture
def library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path / "data"))
    folder = tmp_path / "docs"
    (folder / "sub").mkdir(parents=True)
    _pdf(folder / "elma.pdf", ["Kırmızı elma bahçesi", "İkinci sayfa armut"], title="Meyveler")
    _pdf(folder / "sub" / "rapor.pdf", ["Yıllık rapor 2026", "Elma ihracatı arttı"])
    _pdf(folder / "bos.pdf", [""])
    return folder


def test_build_match_quotes_terms_and_supports_prefix() -> None:
    assert build_match("elma bahçe*") == '"elma" "bahce"*'
    assert build_match('  "quoted"  ') == '"quoted"'
    assert build_match("***") == ""


def test_build_match_supports_or_and_exclusion() -> None:
    assert build_match("elma OR armut") == '"elma" OR "armut"'
    assert build_match("elma -armut") == '"elma" NOT "armut"'
    assert build_match('"kırmızı elma" -armut') == '"kirmizi elma" NOT "armut"'


def test_build_match_supports_near_shortcut() -> None:
    assert build_match("NEAR(elma armut, 5)") == 'NEAR("elma" "armut", 5)'
    assert build_match("NEAR(elma armut)") == 'NEAR("elma" "armut", 10)'


def test_fold_text_normalizes_turkish_casing() -> None:
    assert fold_text("KIRMIZI") == fold_text("kırmızı")
    assert fold_text("İSTANBUL") == fold_text("istanbul")
    assert fold_text("ŞĞÇÖÜ") == "sgcou"


def test_add_folder_indexes_and_query_groups_hits(library: Path) -> None:
    result = add_folder(AddFolderParams(path=str(library)), silent_progress())
    assert result.stats.indexed == 3
    assert result.folders[0].files == 3
    found = query(QueryParams(query="elma"), silent_progress())
    assert found.total_files == 2
    paths = {Path(item.path).name for item in found.files}
    assert paths == {"elma.pdf", "rapor.pdf"}
    meyveler = next(item for item in found.files if item.title == "Meyveler")
    assert meyveler.matched_pages[0].page == 1
    assert f"{SNIPPET_OPEN}elma{SNIPPET_CLOSE}" in meyveler.matched_pages[0].snippet.lower()
    assert query(QueryParams(query="ELMA"), silent_progress()).total_files == 2
    assert query(QueryParams(query="armut"), silent_progress()).total_files == 1
    assert query(QueryParams(query="portakal"), silent_progress()).total_files == 0


def test_query_folds_turkish_casing(library: Path) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    assert query(QueryParams(query="kirmizi"), silent_progress()).total_files == 1
    assert query(QueryParams(query="KIRMIZI"), silent_progress()).total_files == 1


def test_query_filters_by_pages_and_path(library: Path) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    target = str(library / "elma.pdf")
    assert query(QueryParams(query="elma", path=target), silent_progress()).total_files == 1
    assert query(QueryParams(query="elma", min_pages=5), silent_progress()).total_files == 0


def test_reindex_tracks_changes_and_removals(library: Path) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    target = library / "elma.pdf"
    time.sleep(0.01)
    _pdf(target, ["Şimdi sadece portakal var"])
    os.utime(target, (time.time() + 5, time.time() + 5))
    (library / "bos.pdf").unlink()
    stats = index(IndexParams(force=True), silent_progress()).stats
    assert stats.indexed == 1
    assert stats.unchanged == 1
    assert stats.removed == 1
    assert query(QueryParams(query="portakal"), silent_progress()).total_files == 1
    assert query(QueryParams(query="armut"), silent_progress()).total_files == 0


def test_index_skips_recently_indexed_folders_unless_forced(library: Path) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    stats = index(IndexParams(), silent_progress()).stats
    assert stats.indexed == 0
    assert stats.unchanged == 0


def test_unindexable_file_is_not_reparsed_until_mtime_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path / "data"))
    folder = tmp_path / "docs"
    folder.mkdir()
    (folder / "broken.pdf").write_bytes(b"not a pdf")
    result = add_folder(AddFolderParams(path=str(folder)), silent_progress())
    assert result.stats.skipped == 1
    second = index(IndexParams(force=True), silent_progress())
    assert second.stats.unchanged == 1
    assert second.stats.skipped == 0


def test_remove_folder_clears_index(library: Path) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    listed = remove_folder(RemoveFolderParams(path=str(library)), silent_progress())
    assert listed.folders == []
    assert query(QueryParams(query="elma"), silent_progress()).total_files == 0
    assert list_folders(EmptyParams(), silent_progress()).folders == []


def test_overlapping_folder_is_rejected(library: Path) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    with pytest.raises(OpError) as error:
        add_folder(AddFolderParams(path=str(library / "sub")), silent_progress())
    assert error.value.code == ErrorCode.INVALID_PARAMS
    assert error.value.data["reason"] == "overlap"


def test_clear_all_wipes_index(library: Path) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    result = clear_all(EmptyParams(), silent_progress())
    assert result.folders == []
    assert query(QueryParams(query="elma"), silent_progress()).total_files == 0
    assert list_folders(EmptyParams(), silent_progress()).folders == []


def test_stats_report_size_files_and_pages(library: Path) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    result = index_stats(EmptyParams(), silent_progress())
    assert result.files == 3
    assert result.pages == 5
    assert result.size_bytes > 0
    assert result.unindexable == 0


def test_stats_survive_journal_files_disappearing(
    library: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_folder(AddFolderParams(path=str(library)), silent_progress())
    original = Path.stat

    def vanishing(self: Path, *args: object, **kwargs: object) -> os.stat_result:
        if self.name.endswith(("-wal", "-shm")):
            raise FileNotFoundError(2, "gone", str(self))
        return original(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Path, "stat", vanishing)
    result = index_stats(EmptyParams(), silent_progress())
    assert result.files == 3
    assert result.size_bytes > 0


def test_connect_rebuilds_pre_status_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path))
    from vivepdf.ops import search as search_module

    legacy = sqlite3.connect(search_module.database_path())
    legacy.execute(
        "CREATE TABLE folders (path TEXT PRIMARY KEY, recursive INTEGER,"
        " added_at REAL, last_indexed REAL)"
    )
    legacy.execute("INSERT INTO folders VALUES ('C:/old', 1, 1.0, 2.0)")
    legacy.execute(
        "CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL,"
        " folder TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL,"
        " pages INTEGER NOT NULL, title TEXT, indexed_at REAL)"
    )
    legacy.execute("CREATE VIRTUAL TABLE pages USING fts5(text, file_id UNINDEXED, page UNINDEXED)")
    legacy.commit()
    legacy.close()

    with search_module.open_db() as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(files)")}
        assert "status" in columns
        assert (
            connection.execute("PRAGMA user_version").fetchone()[0] == search_module.SCHEMA_VERSION
        )
        assert connection.execute("SELECT last_indexed FROM folders").fetchone()[0] is None
        assert connection.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 0
