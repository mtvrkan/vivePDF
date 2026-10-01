import contextlib
import io
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import pymupdf
from fontTools.ttLib import TTFont
from pydantic import Field

from vivepdf.ops import _image_parallel
from vivepdf.ops._compress_cleanup import Cleanup, CleanupChoice, clean_up
from vivepdf.ops._dedupe import merge_duplicate_streams
from vivepdf.ops._document import forget_document, open_document
from vivepdf.ops._metadata import clear_metadata
from vivepdf.ops._output import DEDUPLICATE_OBJECT_LIMIT, prepare_output
from vivepdf.ops._pool_watch import WorkerLost
from vivepdf.ops._scrub import ScrubOptions, clean_page_contents, load_pages, scrub_document
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

PresetProfile = Literal["light", "balanced", "strong", "extreme"]
Profile = PresetProfile | Literal["custom"]
CUSTOM_PROFILE = "custom"
CUSTOM_DPI_DEFAULT = 150
CUSTOM_QUALITY_DEFAULT = 75


@dataclass(frozen=True)
class ImageSettings:
    dpi_threshold: int
    dpi_target: int
    quality: int


IMAGE_PROFILES: dict[PresetProfile, ImageSettings | None] = {
    "light": None,
    "balanced": ImageSettings(dpi_threshold=200, dpi_target=150, quality=75),
    "strong": ImageSettings(dpi_threshold=130, dpi_target=100, quality=60),
    "extreme": ImageSettings(dpi_threshold=90, dpi_target=72, quality=40),
}


def image_settings(profile: Profile, dpi: int, quality: int) -> ImageSettings | None:
    if profile == CUSTOM_PROFILE:
        return ImageSettings(dpi_threshold=dpi + dpi // 3, dpi_target=dpi, quality=quality)
    return IMAGE_PROFILES[profile]


TARGET_LADDER: list[tuple[str, ImageSettings | None, bool]] = [
    ("light", None, False),
    ("balanced", IMAGE_PROFILES["balanced"], False),
    ("strong", IMAGE_PROFILES["strong"], False),
    ("extreme", IMAGE_PROFILES["extreme"], False),
    ("minimal", ImageSettings(dpi_threshold=72, dpi_target=60, quality=30), False),
    ("minimalGray", ImageSettings(dpi_threshold=60, dpi_target=50, quality=25), True),
]
TARGET_ATTEMPTS = len(TARGET_LADDER).bit_length()
ORIGINAL_PROFILE = "original"

SAVE_OPTIONS = {
    "garbage": 4,
    "clean": True,
    "deflate": True,
    "deflate_images": True,
    "deflate_fonts": True,
    "use_objstms": True,
    "encryption": pymupdf.PDF_ENCRYPT_KEEP,
}

UNRENDERED_FONT_TABLES = frozenset(
    {
        "COLR",
        "CPAL",
        "SVG ",
        "MATH",
        "DSIG",
        "GSUB",
        "GPOS",
        "GDEF",
        "BASE",
        "JSTF",
        "kern",
        "hdmx",
        "VDMX",
        "LTSH",
        "PCLT",
        "FFTM",
        "meta",
        "morx",
        "mort",
        "feat",
        "trak",
        "prop",
        "STAT",
        "Zapf",
    }
)
EXTRA_KEYS = ("PieceInfo", "Thumb")
IMAGE_BATCH_PAGES = 8
PRIVACY_SAVE_OPTIONS = {
    "garbage": 1,
    "deflate": True,
    "use_objstms": True,
    "encryption": pymupdf.PDF_ENCRYPT_KEEP,
}
PRIVACY_PROFILE = "privacyOnly"
LARGE_SAVE_OPTIONS = {**SAVE_OPTIONS, "garbage": 2, "clean": False}
METADATA_SCRUB = ScrubOptions(
    attached_files=False,
    embedded_files=False,
    hidden_text=False,
    remove_links=False,
    reset_fields=False,
    reset_responses=False,
)


class CompressParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    profile: Profile = "balanced"
    grayscale: bool = False
    strip_metadata: bool = False
    discard_extras: bool = False
    linearize: bool = False
    target_bytes: int | None = Field(default=None, ge=10_000)
    custom_dpi: int = Field(default=CUSTOM_DPI_DEFAULT, ge=36, le=600)
    custom_quality: int = Field(default=CUSTOM_QUALITY_DEFAULT, ge=10, le=95)
    remove_attachments: bool = False
    remove_comments: bool = False
    remove_scripts: bool = False

    @property
    def cleanup(self) -> CleanupChoice:
        return CleanupChoice(
            attachments=self.remove_attachments,
            comments=self.remove_comments,
            scripts=self.remove_scripts,
        )


class CompressResult(RpcModel):
    output: str
    page_count: int
    bytes_before: int
    bytes_after: int
    profile_used: str
    target_bytes: int | None = None
    target_met: bool | None = None
    kept_original: bool = False
    font_bytes_saved: int = 0
    extras_removed: int = 0
    linearized: bool = False
    privacy_only: bool = False
    grew: bool = False
    attachments_removed: int = 0
    comments_removed: int = 0
    scripts_removed: int = 0


@dataclass
class Shrunk:
    data: bytes
    font_bytes_saved: int
    extras_removed: int
    cleanup: Cleanup = field(default_factory=Cleanup)


def _page_tree_root(document: pymupdf.Document) -> tuple[int, str] | None:
    if document.page_count <= IMAGE_BATCH_PAGES:
        return None
    catalog = document.pdf_catalog()
    kind, value = document.xref_get_key(catalog, "Pages")
    if kind != "xref":
        return None
    return catalog, value


def rewrite_options(settings: ImageSettings) -> dict[str, object]:
    return {
        "dpi_threshold": settings.dpi_threshold,
        "dpi_target": settings.dpi_target,
        "quality": settings.quality,
        "lossy": True,
        "lossless": True,
        "bitonal": True,
        "color": True,
        "gray": True,
    }


def _rewrite_images(
    document: pymupdf.Document,
    settings: ImageSettings,
    grayscale: bool,
    progress: Progress,
    band: tuple[float, float],
) -> None:
    if grayscale:
        document.recolor(1)
    options = rewrite_options(settings)
    root = _page_tree_root(document)
    if root is None:
        document.rewrite_images(**options)
        return
    page_xrefs = [document.page_xref(index) for index in range(document.page_count)]
    if _rewrite_in_parallel(document, page_xrefs, options, progress, band):
        return
    _rewrite_in_batches(document, root, page_xrefs, options, progress, band)


def _rewrite_in_parallel(
    document: pymupdf.Document,
    page_xrefs: list[int],
    options: dict[str, object],
    progress: Progress,
    band: tuple[float, float],
) -> bool:
    workers = _image_parallel.worker_count(len(page_xrefs), IMAGE_BATCH_PAGES)
    if workers < 2:
        return False
    batches = [
        page_xrefs[first : first + IMAGE_BATCH_PAGES]
        for first in range(0, len(page_xrefs), IMAGE_BATCH_PAGES)
    ]
    start, span = band
    total = len(page_xrefs)

    def on_batch(done: int) -> None:
        current = min(total, done * IMAGE_BATCH_PAGES)
        progress.report(
            start + span * current / total,
            "progress.rewritingImagesPages",
            {"current": current, "total": total},
        )

    try:
        _image_parallel.ParallelRewrite(on_batch, progress.check_cancelled).run(
            document, batches, options, workers
        )
    except (_image_parallel.UnsafeMerge, WorkerLost):
        return False
    return True


def _rewrite_in_batches(
    document: pymupdf.Document,
    root: tuple[int, str],
    page_xrefs: list[int],
    options: dict[str, object],
    progress: Progress,
    band: tuple[float, float],
) -> None:
    catalog, original = root
    total = len(page_xrefs)
    start, span = band
    holder = document.get_new_xref()
    try:
        for first in range(0, total, IMAGE_BATCH_PAGES):
            progress.check_cancelled()
            progress.report(
                start + span * first / total,
                "progress.rewritingImagesPages",
                {"current": first + 1, "total": total},
            )
            batch = page_xrefs[first : first + IMAGE_BATCH_PAGES]
            kids = " ".join(f"{xref} 0 R" for xref in batch)
            document.update_object(holder, f"<</Type/Pages/Kids[{kids}]/Count {len(batch)}>>")
            document.xref_set_key(catalog, "Pages", f"{holder} 0 R")
            try:
                document.rewrite_images(**options)
            finally:
                document.xref_set_key(catalog, "Pages", original)
    finally:
        document.update_object(holder, "<<>>")


def _strip_metadata(document: pymupdf.Document, progress: Progress) -> None:
    if not document.is_encrypted:
        try:
            scrub_document(document, load_pages(document), METADATA_SCRUB, progress)
        except OpError as error:
            if error.code == ErrorCode.CANCELLED:
                raise
        except Exception:  # noqa: BLE001
            pass
    clear_metadata(document)


def _slim_font(data: bytes) -> bytes | None:
    try:
        font = TTFont(io.BytesIO(data), lazy=False)
    except Exception:  # noqa: BLE001
        return None
    dropped = sorted(set(font.keys()) & UNRENDERED_FONT_TABLES)
    has_outlines = "glyf" in font or "CFF " in font
    if not dropped or not has_outlines:
        return None
    for tag in dropped:
        del font[tag]
    buffer = io.BytesIO()
    try:
        font.save(buffer, reorderTables=False)
    except Exception:  # noqa: BLE001
        return None
    slimmed = buffer.getvalue()
    return slimmed if len(slimmed) < len(data) else None


UNREADABLE_OBJECT_ERRORS = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)


def _font_programs_of(document: pymupdf.Document, xref: int) -> list[int]:
    try:
        if document.xref_get_key(xref, "Type")[1] != "/FontDescriptor":
            return []
        entries = [document.xref_get_key(xref, key) for key in ("FontFile2", "FontFile3")]
    except UNREADABLE_OBJECT_ERRORS:
        return []
    return [int(value.split()[0]) for kind, value in entries if kind == "xref"]


def _font_program_xrefs(document: pymupdf.Document) -> set[int]:
    found: set[int] = set()
    for xref in range(1, document.xref_length()):
        found.update(_font_programs_of(document, xref))
    return found


def _slim_fonts(document: pymupdf.Document) -> int:
    saved = 0
    for xref in _font_program_xrefs(document):
        try:
            is_open_type = document.xref_get_key(xref, "Subtype")[1] == "/OpenType"
            is_true_type = document.xref_get_key(xref, "Length1")[0] != "null"
        except UNREADABLE_OBJECT_ERRORS:
            continue
        if not (is_open_type or is_true_type):
            continue
        try:
            data = document.xref_stream(xref)
        except Exception:  # noqa: BLE001
            continue
        slimmed = _slim_font(data) if data else None
        if slimmed is None:
            continue
        document.update_stream(xref, slimmed)
        if is_true_type:
            document.xref_set_key(xref, "Length1", str(len(slimmed)))
        saved += len(data) - len(slimmed)
    return saved


def _discard_extras(document: pymupdf.Document) -> int:
    removed = 0
    for xref in range(1, document.xref_length()):
        try:
            keys = document.xref_get_keys(xref)
        except Exception:  # noqa: BLE001
            continue
        for key in EXTRA_KEYS:
            if key in keys:
                document.xref_set_key(xref, key, "null")
                removed += 1
        if "Alternates" in keys and document.xref_get_key(xref, "Subtype")[1] == "/Image":
            document.xref_set_key(xref, "Alternates", "null")
            removed += 1
    return removed


def _shrink(
    document: pymupdf.Document,
    settings: ImageSettings | None,
    params: CompressParams,
    force_gray: bool,
    progress: Progress,
    band: tuple[float, float] = (0.0, 0.85),
) -> Shrunk:
    start, span = band
    grayscale = params.grayscale or force_gray
    if params.strip_metadata:
        _strip_metadata(document, progress)
    cleanup = clean_up(document, params.cleanup, progress)
    extras = _discard_extras(document) if params.discard_extras else 0
    if settings is not None:
        progress.report(start + span * 0.15, "progress.rewritingImages")
        _rewrite_images(document, settings, grayscale, progress, (start + span * 0.15, span * 0.45))
    elif grayscale:
        progress.report(start + span * 0.15, "progress.rewritingImages")
        document.recolor(1)
    progress.check_cancelled()
    progress.report(start + span * 0.6, "progress.subsettingFonts")
    with contextlib.suppress(Exception):
        document.subset_fonts(fallback=False)
    font_saved = _slim_fonts(document)
    progress.check_cancelled()
    return Shrunk(_serialized(document, progress), font_saved, extras, cleanup)


def _serialized(document: pymupdf.Document, progress: Progress) -> bytes:
    if document.xref_length() <= DEDUPLICATE_OBJECT_LIMIT:
        return document.tobytes(**SAVE_OPTIONS)
    clean_page_contents(load_pages(document), progress)
    merge_duplicate_streams(document, progress)
    progress.check_cancelled()
    return document.tobytes(**LARGE_SAVE_OPTIONS)


def _may_keep_original(params: CompressParams, shrunk: Shrunk) -> bool:
    if params.grayscale or params.strip_metadata or shrunk.cleanup.removed:
        return False
    return not params.discard_extras or shrunk.extras_removed == 0


def _privacy_only(params: CompressParams, progress: Progress) -> Shrunk:
    with open_document(params.path, params.password) as document:
        if params.strip_metadata:
            _strip_metadata(document, progress)
        cleanup = clean_up(document, params.cleanup, progress)
        extras = _discard_extras(document) if params.discard_extras else 0
        return Shrunk(document.tobytes(**PRIVACY_SAVE_OPTIONS), 0, extras, cleanup)


def _linearize_refused(encrypted: bool) -> OpError:
    if encrypted:
        return OpError(
            ErrorCode.UNSUPPORTED,
            "fast web view cannot keep this file's protection",
            {"reason": "linearizeEncrypted"},
        )
    return OpError(ErrorCode.INVALID_PDF, "fast web view could not be written")


def _check_linearizable(params: CompressParams) -> None:
    import pikepdf

    try:
        with pikepdf.open(params.path, password=params.password or ""):
            return
    except pikepdf.PasswordError as error:
        raise _linearize_refused(True) from error
    except Exception as error:  # noqa: BLE001
        with open_document(params.path, params.password) as document:
            encrypted = bool(document.is_encrypted or document.metadata.get("encryption"))
        raise _linearize_refused(encrypted) from error


def linearized(data: bytes, password: str | None) -> bytes:
    import pikepdf

    encrypted = False
    try:
        with pikepdf.open(io.BytesIO(data), password=password or "") as pdf:
            encrypted = pdf.is_encrypted
            buffer = io.BytesIO()
            pdf.save(buffer, linearize=True, encryption=True if encrypted else None)
            return buffer.getvalue()
    except pikepdf.PasswordError as error:
        raise _linearize_refused(True) from error
    except Exception as error:  # noqa: BLE001
        raise _linearize_refused(encrypted) from error


def _write_output(target: Path, data: bytes, params: CompressParams, progress: Progress) -> int:
    if params.linearize:
        progress.check_cancelled()
        progress.report(0.96, "progress.linearizing")
        data = linearized(data, params.password)
    _staged(target, lambda staging: staging.write_bytes(data))
    return len(data)


def _staged(target: Path, write) -> None:
    staging = target.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"
    try:
        write(staging)
        if target.exists():
            forget_document(str(target))
        staging.replace(target)
    finally:
        staging.unlink(missing_ok=True)


def _attempt(params: CompressParams, rung: int, progress: Progress, attempt: int) -> Shrunk:
    _, settings, force_gray = TARGET_LADDER[rung]
    start = attempt / TARGET_ATTEMPTS * 0.9
    progress.report(
        start,
        "progress.compressAttempt",
        {"current": attempt + 1, "total": TARGET_ATTEMPTS},
    )
    with open_document(params.path, params.password) as document:
        return _shrink(
            document, settings, params, force_gray, progress, (start, 0.9 / TARGET_ATTEMPTS)
        )


def _target_met(params: CompressParams, size: int) -> bool | None:
    return None if params.target_bytes is None else size <= params.target_bytes


def _kept_original(
    params: CompressParams, target: Path, page_count: int, bytes_before: int, progress: Progress
) -> CompressResult:
    if params.linearize:
        bytes_after = _write_output(target, Path(params.path).read_bytes(), params, progress)
    else:
        _staged(target, lambda staging: shutil.copyfile(params.path, staging))
        bytes_after = bytes_before
    return CompressResult(
        output=str(target),
        page_count=page_count,
        bytes_before=bytes_before,
        bytes_after=bytes_after,
        profile_used=ORIGINAL_PROFILE,
        target_bytes=params.target_bytes,
        target_met=_target_met(params, bytes_after),
        kept_original=True,
        linearized=params.linearize,
        grew=bytes_after > bytes_before,
    )


def _finish(
    params: CompressParams,
    target: Path,
    best: Shrunk,
    profile_used: str,
    page_count: int,
    progress: Progress,
) -> CompressResult:
    bytes_before = Path(params.path).stat().st_size
    privacy_only = False
    if len(best.data) >= bytes_before:
        if _may_keep_original(params, best):
            return _kept_original(params, target, page_count, bytes_before, progress)
        if not params.grayscale:
            progress.check_cancelled()
            minimal = _privacy_only(params, progress)
            if len(minimal.data) < len(best.data):
                best, profile_used, privacy_only = minimal, PRIVACY_PROFILE, True
    bytes_after = _write_output(target, best.data, params, progress)
    return CompressResult(
        output=str(target),
        page_count=page_count,
        bytes_before=bytes_before,
        bytes_after=bytes_after,
        profile_used=profile_used,
        target_bytes=params.target_bytes,
        target_met=_target_met(params, bytes_after),
        font_bytes_saved=best.font_bytes_saved,
        extras_removed=best.extras_removed,
        linearized=params.linearize,
        privacy_only=privacy_only,
        grew=bytes_after > bytes_before,
        attachments_removed=best.cleanup.attachments,
        comments_removed=best.cleanup.comments,
        scripts_removed=best.cleanup.scripts,
    )


def _compress_to_target(params: CompressParams, target: Path, progress: Progress) -> CompressResult:
    assert params.target_bytes is not None
    if Path(params.path).stat().st_size <= params.target_bytes:
        light = _attempt(params, 0, progress, 0)
        with open_document(params.path, params.password) as document:
            page_count = document.page_count
        progress.report(0.95, "progress.saving")
        return _finish(params, target, light, TARGET_LADDER[0][0], page_count, progress)
    tried: dict[int, Shrunk] = {}
    low, high = 0, len(TARGET_LADDER) - 1
    fitting: int | None = None
    while low <= high:
        progress.check_cancelled()
        middle = (low + high) // 2
        tried[middle] = _attempt(params, middle, progress, len(tried))
        if len(tried[middle].data) <= params.target_bytes:
            fitting = middle
            high = middle - 1
        else:
            low = middle + 1
    chosen = fitting if fitting is not None else min(tried, key=lambda rung: len(tried[rung].data))
    with open_document(params.path, params.password) as document:
        page_count = document.page_count
    progress.report(0.95, "progress.saving")
    return _finish(params, target, tried[chosen], TARGET_LADDER[chosen][0], page_count, progress)


@op("compress.run", CompressParams)
def compress(params: CompressParams, progress: Progress) -> CompressResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    if params.linearize:
        _check_linearizable(params)
    if params.target_bytes is not None:
        return _compress_to_target(params, target, progress)
    with open_document(params.path, params.password) as document:
        settings = image_settings(params.profile, params.custom_dpi, params.custom_quality)
        shrunk = _shrink(document, settings, params, False, progress)
        page_count = document.page_count
    progress.report(0.9, "progress.saving")
    return _finish(params, target, shrunk, params.profile, page_count, progress)
