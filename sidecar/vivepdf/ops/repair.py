import io
import uuid
from contextlib import suppress
from pathlib import Path
from typing import Literal

import pikepdf
import pymupdf

from vivepdf.ops._dedupe import merge_duplicate_streams
from vivepdf.ops._document import forget_document, open_document
from vivepdf.ops._output import DEDUPLICATE_OBJECT_LIMIT, prepare_output
from vivepdf.ops._passwords import authenticate_password
from vivepdf.ops._protection import is_protected, open_seal, protection_of
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

SAVE_ATTEMPTS = (
    {
        "garbage": 4,
        "clean": True,
        "deflate": True,
        "use_objstms": True,
        "encryption": pymupdf.PDF_ENCRYPT_KEEP,
    },
    {"garbage": 3, "deflate": True, "encryption": pymupdf.PDF_ENCRYPT_KEEP},
    {"encryption": pymupdf.PDF_ENCRYPT_KEEP},
    {},
)
ISSUE_LIMIT = 500
RepairEngine = Literal["mupdf", "qpdf", "scavenged"]
IssueKind = Literal["damaged", "empty", "dropped"]
LARGE_SAVE_ATTEMPTS = (
    {**SAVE_ATTEMPTS[0], "garbage": 2, "clean": False},
    {"garbage": 2, "deflate": True, "encryption": pymupdf.PDF_ENCRYPT_KEEP},
    *SAVE_ATTEMPTS[2:],
)


class RepairParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False


class RepairIssue(RpcModel):
    page: int
    kind: IssueKind


class RepairResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    was_repaired: bool
    xref_count: int
    damaged_pages: int = 0
    empty_pages: int = 0
    dropped_pages: int = 0
    rebuilt: bool = False
    signed: bool = False
    recovered_by: RepairEngine = "mupdf"
    issues: list[RepairIssue] = []
    issues_truncated: bool = False


def _opened(params: RepairParams, source: Path):
    try:
        return open_document(params.path, params.password)
    except OpError as error:
        if error.code != ErrorCode.INVALID_PDF:
            raise
        return _rebuilt_from_bytes(source, params.password)


def _rebuilt_from_bytes(source: Path, password: str | None = None) -> pymupdf.Document:
    try:
        document = pymupdf.open(stream=source.read_bytes(), filetype="pdf")
    except Exception as error:  # noqa: BLE001
        raise OpError(ErrorCode.INVALID_PDF, f"cannot repair: {source.name}") from error
    if not document.is_pdf:
        document.close()
        raise OpError(ErrorCode.INVALID_PDF, f"not a PDF: {source.name}")
    if document.needs_pass and password:
        authenticate_password(document, password)
    return document


def _page_total(document: pymupdf.Document) -> int | None:
    try:
        total = document.page_count
    except Exception:  # noqa: BLE001
        return None
    return total or None


def _tree_page_count(source: Path, password: str | None) -> int | None:
    try:
        with pikepdf.open(source, password=password or "") as pdf:
            return len(pdf.pages) or None
    except Exception:  # noqa: BLE001
        return None


def _recount(node: pikepdf.Dictionary, visited: set[tuple[int, int]]) -> int:
    if node.is_indirect:
        if node.objgen in visited:
            return 0
        visited.add(node.objgen)
    if node.get("/Type") == pikepdf.Name.Page or "/Kids" not in node:
        return 1
    total = 0
    for kid in node.Kids:
        if isinstance(kid, pikepdf.Dictionary):
            total += _recount(kid, visited)
    node.Count = total
    return total


def _repaged(source: Path, password: str | None) -> pymupdf.Document | None:
    try:
        with pikepdf.open(source, password=password or "") as pdf:
            _recount(pdf.Root.Pages, set())
            buffer = io.BytesIO()
            pdf.save(buffer, encryption=False)
        document = pymupdf.open(stream=buffer.getvalue(), filetype="pdf")
    except Exception:  # noqa: BLE001
        return None
    if document.page_count == 0:
        document.close()
        return None
    return document


def _is_signed(document: pymupdf.Document) -> bool:
    with suppress(Exception):
        if document.get_sigflags() > 0:
            return True
    try:
        for page in document:
            for widget in page.widgets(types=[pymupdf.PDF_WIDGET_TYPE_SIGNATURE]):
                if widget.field_value:
                    return True
    except Exception:  # noqa: BLE001
        return False
    return False


def _is_large(document: pymupdf.Document) -> bool:
    try:
        return document.xref_length() > DEDUPLICATE_OBJECT_LIMIT
    except Exception:  # noqa: BLE001
        return False


def _loaded_pages(
    document: pymupdf.Document, total: int, progress: Progress
) -> list[pymupdf.Page | None]:
    pages: list[pymupdf.Page | None] = []
    for index in range(total):
        progress.check_cancelled()
        try:
            pages.append(document[index])
        except Exception:  # noqa: BLE001
            pages.append(None)
    return pages


def _tidy_pages(
    document: pymupdf.Document, total: int, progress: Progress
) -> tuple[list[int], list[int]]:
    damaged: list[int] = []
    empty: list[int] = []
    large = _is_large(document)
    for index, page in enumerate(_loaded_pages(document, total, progress)):
        progress.check_cancelled()
        if page is None:
            damaged.append(index)
            continue
        try:
            page.clean_contents()
        except Exception:  # noqa: BLE001
            damaged.append(index)
        if not large:
            with suppress(Exception):
                for annot in page.annots():
                    annot.clean_contents()
        try:
            if not page.read_contents().strip():
                empty.append(index)
        except Exception:  # noqa: BLE001
            empty.append(index)
    return damaged, empty


def _write(
    document: pymupdf.Document,
    target: Path,
    password: str | None = None,
    encryption: dict[str, object] | None = None,
    progress: Progress | None = None,
) -> bool:
    attempts = SAVE_ATTEMPTS
    if _is_large(document):
        attempts = LARGE_SAVE_ATTEMPTS
        if progress is not None:
            _merge_duplicates(document, progress)
    for options in attempts:
        try:
            document.save(target, **{**options, **(encryption or {})})
        except Exception:  # noqa: BLE001
            continue
        if _readable_pages(target, password) is not None:
            return True
    return False


def _merge_duplicates(document: pymupdf.Document, progress: Progress) -> None:
    try:
        merge_duplicate_streams(document, progress)
    except OpError as error:
        if error.code == ErrorCode.CANCELLED:
            raise
    except Exception:  # noqa: BLE001
        return


def _readable_pages(target: Path, password: str | None = None) -> int | None:
    if not target.exists():
        return None
    try:
        with pymupdf.open(target) as check:
            if check.needs_pass and not authenticate_password(check, password):
                return None
            if check.page_count == 0:
                return None
            for index in range(check.page_count):
                check.load_page(index)
            return check.page_count
    except Exception:  # noqa: BLE001
        return None


def _kept_outline(document: pymupdf.Document, moved: dict[int, int]) -> list[list]:
    try:
        outline = document.get_toc(simple=True)
    except Exception:  # noqa: BLE001
        return []
    kept: list[list] = []
    for level, title, page in outline:
        landing = moved.get(page - 1)
        if landing is not None:
            kept.append([level, title, landing + 1])
    return kept


def _write_like_source(
    rescued: pymupdf.Document, target: Path, source: Path, password: str | None
) -> bool:
    seal = open_seal(str(source), password)
    if seal is None:
        return False
    try:
        seal.write(rescued.tobytes(garbage=3, deflate=True), target)
    except Exception:  # noqa: BLE001
        return False
    finally:
        seal.close()
    return _readable_pages(target, password) is not None


def _carry_over(document: pymupdf.Document, rescued: pymupdf.Document) -> None:
    with suppress(Exception):
        metadata = {key: value for key, value in (document.metadata or {}).items() if value}
        metadata.pop("format", None)
        metadata.pop("encryption", None)
        rescued.set_metadata(metadata)
    try:
        names = document.embfile_names()
    except Exception:  # noqa: BLE001
        return
    for name in names:
        with suppress(Exception):
            info = document.embfile_info(name)
            rescued.embfile_add(
                name,
                document.embfile_get(name),
                filename=info.get("filename") or name,
                desc=info.get("description") or "",
            )


def _salvage(
    document: pymupdf.Document,
    total: int,
    target: Path,
    progress: Progress,
    source: Path,
    password: str | None,
    original: pymupdf.Document | None = None,
) -> tuple[int, list[int]]:
    sealed_source = original or document
    protected = is_protected(sealed_source)
    protection = protection_of(sealed_source, str(source), password) if protected else None
    encryption = protection.save_options() if protection else None
    rescued = pymupdf.open()
    moved: dict[int, int] = {}
    dropped: list[int] = []
    try:
        for index in range(total):
            progress.check_cancelled()
            try:
                rescued.insert_pdf(document, from_page=index, to_page=index)
                moved[index] = rescued.page_count - 1
            except Exception:  # noqa: BLE001
                dropped.append(index)
        if rescued.page_count == 0:
            raise OpError(ErrorCode.INVALID_PDF, "no page of this file could be recovered")
        _carry_over(document, rescued)
        outline = _kept_outline(document, moved)
        if outline:
            with suppress(Exception):
                rescued.set_toc(outline)
        sealed = protected and _write_like_source(rescued, target, source, password)
        if not sealed and not _write(rescued, target, password, encryption, progress):
            raise OpError(ErrorCode.INVALID_PDF, "the recovered pages could not be written")
        return rescued.page_count, dropped
    finally:
        rescued.close()


def _issues(groups: dict[IssueKind, list[int]]) -> tuple[list[RepairIssue], bool]:
    issues = sorted(
        (
            RepairIssue(page=index + 1, kind=kind)
            for kind, indices in groups.items()
            for index in indices
        ),
        key=lambda issue: (issue.page, issue.kind),
    )
    return issues[:ISSUE_LIMIT], len(issues) > ISSUE_LIMIT


def _reopened(data: bytes, password: str | None) -> pymupdf.Document | None:
    document = pymupdf.open(stream=data, filetype="pdf")
    if document.needs_pass and not authenticate_password(document, password):
        document.close()
        return None
    if document.page_count == 0:
        document.close()
        return None
    return document


def _qpdf_rebuilt(
    source: Path, password: str | None, progress: Progress
) -> pymupdf.Document | None:
    try:
        with pikepdf.open(source, password=password or "", attempt_recovery=True) as pdf:
            with suppress(Exception):
                _recount(pdf.Root.Pages, set())
            buffer = io.BytesIO()
            pdf.save(buffer, encryption=pdf.is_encrypted)
        return _reopened(buffer.getvalue(), password)
    except Exception:  # noqa: BLE001
        return None


def _page_objects(document: pymupdf.Document, progress: Progress) -> list[int]:
    found: list[int] = []
    for xref in range(1, document.xref_length()):
        if xref % 1000 == 0:
            progress.check_cancelled()
        with suppress(Exception):
            if document.xref_get_key(xref, "Type") == ("name", "/Page"):
                found.append(xref)
    return found


def _scavenged(source: Path, password: str | None, progress: Progress) -> pymupdf.Document | None:
    try:
        document = pymupdf.open(stream=source.read_bytes(), filetype="pdf")
    except Exception:  # noqa: BLE001
        return None
    try:
        if document.needs_pass and not authenticate_password(document, password):
            return None
        pages = _page_objects(document, progress)
        if not pages:
            return None
        kids = " ".join(f"{xref} 0 R" for xref in pages)
        tree = document.get_new_xref()
        document.update_object(tree, f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>")
        for xref in pages:
            document.xref_set_key(xref, "Parent", f"{tree} 0 R")
        catalog = document.get_new_xref()
        document.update_object(catalog, f"<< /Type /Catalog /Pages {tree} 0 R >>")
        document.xref_set_key(-1, "Root", f"{catalog} 0 R")
        data = document.tobytes(garbage=3, encryption=pymupdf.PDF_ENCRYPT_KEEP)
    except OpError:
        raise
    except Exception:  # noqa: BLE001
        return None
    finally:
        document.close()
    try:
        return _reopened(data, password)
    except Exception:  # noqa: BLE001
        return None


RECOVERY_PATHS = (("qpdf", _qpdf_rebuilt), ("scavenged", _scavenged))


def _recovered(
    engine: RepairEngine,
    document: pymupdf.Document,
    params: RepairParams,
    source: Path,
    target: Path,
    progress: Progress,
) -> RepairResult | None:
    with document:
        total = document.page_count
        signed = _is_signed(document)
        try:
            kept, dropped = _salvage(document, total, target, progress, source, params.password)
        except OpError as error:
            if error.code == ErrorCode.CANCELLED:
                raise
            return None
    issues, truncated = _issues({"dropped": dropped})
    return RepairResult(
        output=str(target),
        page_count=kept,
        bytes=target.stat().st_size,
        was_repaired=True,
        xref_count=0,
        damaged_pages=len(dropped),
        dropped_pages=len(dropped),
        rebuilt=True,
        signed=signed,
        recovered_by=engine,
        issues=issues,
        issues_truncated=truncated,
    )


def _second_pass(
    params: RepairParams, source: Path, target: Path, progress: Progress, beat: int
) -> RepairResult | None:
    progress.report(0.5, "progress.repairing")
    best: tuple[RepairResult, Path] | None = None
    staged_files: list[Path] = []
    try:
        for engine, opener in RECOVERY_PATHS:
            progress.check_cancelled()
            document = opener(source, params.password, progress)
            if document is None:
                continue
            staged = target.with_name(f"{target.name}.{engine}")
            staged_files.append(staged)
            result = _recovered(engine, document, params, source, staged, progress)
            if result is None or result.page_count <= beat:
                continue
            best = (result, staged)
            beat = result.page_count
            if result.dropped_pages == 0:
                break
        if best is None:
            return None
        best[1].replace(target)
        return best[0].model_copy(update={"output": str(target)})
    finally:
        for staged in staged_files:
            staged.unlink(missing_ok=True)


@op("repair.run", RepairParams)
def repair(params: RepairParams, progress: Progress) -> RepairResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    staging = target.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"
    try:
        result = _repair(params, staging, progress)
        if target.exists():
            forget_document(str(target))
        staging.replace(target)
    finally:
        staging.unlink(missing_ok=True)
    return result.model_copy(update={"output": str(target)})


def _repair(params: RepairParams, target: Path, progress: Progress) -> RepairResult:
    source = Path(params.path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": params.path}
        )
    try:
        first = _repair_with_mupdf(params, source, target, progress)
    except OpError as error:
        if error.code != ErrorCode.INVALID_PDF:
            raise
        second = _second_pass(params, source, target, progress, 0)
        if second is None:
            raise
        return second
    if first.dropped_pages == 0:
        return first
    spare = target.with_name(f"{target.name}.alt")
    try:
        second = _second_pass(params, source, spare, progress, first.page_count)
        if second is None:
            return first
        spare.replace(target)
        return second.model_copy(update={"output": str(target)})
    finally:
        spare.unlink(missing_ok=True)


def _repair_with_mupdf(
    params: RepairParams, source: Path, target: Path, progress: Progress
) -> RepairResult:
    with _opened(params, source) as document:
        progress.report(0.3, "progress.repairing")
        was_repaired = bool(getattr(document, "is_repaired", False))
        total = _page_total(document)
        signed = _is_signed(document)
    tree_total = _tree_page_count(source, params.password)
    if tree_total is not None and tree_total != total:
        repaged = _repaged(source, params.password)
        if repaged is not None:
            with repaged, _opened(params, source) as original:
                kept, dropped = _salvage(
                    repaged,
                    repaged.page_count,
                    target,
                    progress,
                    source,
                    params.password,
                    original,
                )
            issues, truncated = _issues({"dropped": dropped})
            return RepairResult(
                output=str(target),
                page_count=kept,
                bytes=target.stat().st_size,
                was_repaired=True,
                xref_count=0,
                damaged_pages=len(dropped),
                dropped_pages=len(dropped),
                rebuilt=True,
                signed=signed,
                issues=issues,
                issues_truncated=truncated,
            )
    if total is None:
        with _rebuilt_from_bytes(source, params.password) as rebuilt_source:
            total = _page_total(rebuilt_source)
            if total is None:
                raise OpError(ErrorCode.INVALID_PDF, "document has no recoverable pages")
            kept, dropped = _salvage(
                rebuilt_source, total, target, progress, source, params.password
            )
        issues, truncated = _issues({"dropped": dropped})
        return RepairResult(
            output=str(target),
            page_count=kept,
            bytes=target.stat().st_size,
            was_repaired=True,
            xref_count=0,
            damaged_pages=total - kept,
            empty_pages=0,
            dropped_pages=len(dropped),
            rebuilt=True,
            signed=signed,
            issues=issues,
            issues_truncated=truncated,
        )
    with _opened(params, source) as document:
        damaged, empty = _tidy_pages(document, total, progress)
        progress.report(0.8, "progress.saving")
        rebuilt = not _write(document, target, params.password, progress=progress)
        try:
            xref_count = document.xref_length()
        except Exception:  # noqa: BLE001
            xref_count = 0
    kept = total
    dropped: list[int] = []
    if rebuilt:
        with _opened(params, source) as again:
            kept, dropped = _salvage(again, total, target, progress, source, params.password)
    issues, truncated = _issues({"damaged": damaged, "empty": empty, "dropped": dropped})
    return RepairResult(
        output=str(target),
        page_count=kept,
        bytes=target.stat().st_size,
        was_repaired=was_repaired or bool(damaged) or rebuilt,
        xref_count=xref_count,
        damaged_pages=len(damaged),
        empty_pages=len(empty),
        dropped_pages=len(dropped),
        rebuilt=rebuilt,
        signed=signed,
        issues=issues,
        issues_truncated=truncated,
    )
