import contextlib
import datetime
import os
import re
import shutil
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._naming import FALLBACK_NAME, TOKEN, sanitize_file_name, unique_name
from vivepdf.ops.ocr import _language_string
from vivepdf.ops.tessdata import writable_tessdata_dir
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

TITLE_MAX_CHARS = 60
MAX_FOLDER_DEPTH = 5
OCR_DPI = 200
OCR_TEXT_THRESHOLD = 20
NameCase = Literal["keep", "lower", "upper", "title"]
MONTHS: dict[str, int] = {}
for language_months in (
    "ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık",
    "ocak subat mart nisan mayis haziran temmuz agustos eylul ekim kasim aralik",
    "january february march april may june july august september october november december",
    "januar februar märz april mai juni juli august september oktober november dezember",
    "janvier février mars avril mai juin juillet août septembre octobre novembre décembre",
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre",
    "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre",
    "jan feb mar apr may jun jul aug sep oct nov dec",
    "oca şub mar nis may haz tem ağu eyl eki kas ara",
):
    for number, name in enumerate(language_months.split(), start=1):
        MONTHS.setdefault(name, number)

DATE_DMY = re.compile(r"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)")
DATE_YMD = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")
DATE_DAY_MONTH = re.compile(r"(?<!\d)(\d{1,2})\.?\s+([^\W\d_]{3,})\.?\s+(\d{4})(?!\d)", re.UNICODE)
DATE_MONTH_DAY = re.compile(r"\b([^\W\d_]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)", re.UNICODE)
INVOICE = re.compile(
    r"(?:fatura|invoice|fi[şs]|receipt|belge|sipari[şs]|order|rechnung|facture|factura|fattura)"
    r"\s*(?:no|number|nr|numaras[ıi]|#|n°|num)?\s*[:.\-]?\s*([A-Z]{0,4}[-/]?\d{3,}[A-Z0-9-/]*)",
    re.IGNORECASE,
)
AMOUNT_SUFFIX = re.compile(
    r"(?<![\d.,])(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(TL|₺|TRY|€|EUR|\$|USD|£|GBP)",
    re.IGNORECASE,
)
AMOUNT_PREFIX = re.compile(
    r"(₺|€|\$|£)\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d.,])",
)
PDF_DATE = re.compile(r"D:(\d{4})(\d{2})(\d{2})")
OFFICE_PREFIX = re.compile(
    r"^(?:Microsoft\s+(?:Office\s+)?(?:Word|PowerPoint|Excel)|PowerPoint|Word)\s*-\s*",
    re.IGNORECASE,
)
SOURCE_EXTENSION = re.compile(
    r"\.(?:docx?|pptx?|xlsx?|odt|odp|ods|rtf|txt|pdf|indd|pages|key)$", re.IGNORECASE
)
PLACEHOLDER_TITLES = {
    "untitled",
    "untitled document",
    "document",
    "document1",
    "presentation",
    "powerpoint presentation",
    "slide 1",
    "adsız",
    "başlıksız",
    "belge1",
}


def _valid_date(year: int, month: int, day: int) -> datetime.date | None:
    try:
        return datetime.date(year, month, day)
    except ValueError:
        return None


DateOrder = Literal["dmy", "mdy"]


def find_date(text: str, order: DateOrder = "dmy") -> datetime.date | None:
    for match in DATE_YMD.finditer(text):
        found = _valid_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if found:
            return found
    day_group, month_group = (1, 2) if order == "dmy" else (2, 1)
    for match in DATE_DMY.finditer(text):
        found = _valid_date(
            int(match.group(3)), int(match.group(month_group)), int(match.group(day_group))
        )
        if found:
            return found
    for match in DATE_DAY_MONTH.finditer(text):
        month = MONTHS.get(match.group(2).lower())
        if month:
            found = _valid_date(int(match.group(3)), month, int(match.group(1)))
            if found:
                return found
    for match in DATE_MONTH_DAY.finditer(text):
        month = MONTHS.get(match.group(1).lower())
        if month:
            found = _valid_date(int(match.group(3)), month, int(match.group(2)))
            if found:
                return found
    return None


def parse_amount(raw: str) -> float:
    text = raw.strip()
    if "," in text and "." in text:
        decimal = "," if text.rfind(",") > text.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        text = text.replace(thousands, "").replace(decimal, ".")
    elif "," in text or "." in text:
        separator = "," if "," in text else "."
        head, tail = text.rsplit(separator, 1)
        text = (
            f"{head.replace(separator, '')}.{tail}"
            if len(tail) <= 2
            else text.replace(separator, "")
        )
    return float(text)


def find_amount(text: str) -> str:
    best: float | None = None
    for match in AMOUNT_SUFFIX.finditer(text):
        try:
            value = parse_amount(match.group(1))
        except ValueError:
            continue
        best = value if best is None or value > best else best
    for match in AMOUNT_PREFIX.finditer(text):
        try:
            value = parse_amount(match.group(2))
        except ValueError:
            continue
        best = value if best is None or value > best else best
    return f"{best:.2f}" if best is not None else ""


def find_invoice(text: str) -> str:
    match = INVOICE.search(text)
    return match.group(1).strip(" -/") if match else ""


def largest_text_line(page: pymupdf.Page, textpage: pymupdf.TextPage | None = None) -> str:
    best_size = 0.0
    best_text = ""
    layout = page.get_text("dict", textpage=textpage)
    for block in layout.get("blocks", []):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = "".join(span.get("text", "") for span in spans).strip()
            if len(text) < 3:
                continue
            size = max(float(span.get("size", 0)) for span in spans)
            if size > best_size:
                best_size, best_text = size, text
    return best_text[:TITLE_MAX_CHARS]


def formatted_date(value: datetime.date, date_format: str) -> str:
    try:
        return value.strftime(date_format)
    except ValueError as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"invalid date format: {date_format}",
            {"reason": "dateFormat"},
        ) from error


def clean_title(raw: str) -> str:
    title = OFFICE_PREFIX.sub("", raw.strip())
    title = SOURCE_EXTENSION.sub("", title).strip()
    return "" if title.lower() in PLACEHOLDER_TITLES else title


def _metadata_date(document: pymupdf.Document) -> datetime.date | None:
    raw = (document.metadata or {}).get("creationDate") or ""
    match = PDF_DATE.search(raw)
    if not match:
        return None
    return _valid_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))


@dataclass(frozen=True)
class DocumentFacts:
    text: str
    title: str
    author: str
    subject: str
    pages: int
    metadata_date: datetime.date | None
    recognised: bool = False


@dataclass(frozen=True)
class OcrSettings:
    language: str
    dpi: int = OCR_DPI


CacheKey = tuple[str, int, int, int, str]
FACTS_CACHE_CHARS = 8_000_000
_facts_cache: OrderedDict[CacheKey, DocumentFacts] = OrderedDict()
_facts_cache_chars = 0


def _recognised_pages(
    document: pymupdf.Document, count: int, ocr: OcrSettings
) -> list[tuple[pymupdf.Page, pymupdf.TextPage]]:
    pages: list[tuple[pymupdf.Page, pymupdf.TextPage]] = []
    for index in range(count):
        page = document[index]
        try:
            textpage = page.get_textpage_ocr(
                flags=0,
                language=ocr.language,
                dpi=ocr.dpi,
                full=True,
                tessdata=str(writable_tessdata_dir()),
            )
        except (RuntimeError, ValueError) as error:
            raise OpError(ErrorCode.EXTERNAL_TOOL_FAILED, f"OCR failed: {error}") from error
        pages.append((page, textpage))
    return pages


def read_facts(
    document: pymupdf.Document, max_pages: int, ocr: OcrSettings | None = None
) -> DocumentFacts:
    metadata = document.metadata or {}
    count = min(max_pages, document.page_count)
    text = "\n".join(document[i].get_text() for i in range(count))
    title = clean_title(metadata.get("title") or "")
    recognised = False
    if ocr is not None and count and len(text.strip()) < OCR_TEXT_THRESHOLD:
        pages = _recognised_pages(document, count, ocr)
        text = "\n".join(page.get_text(textpage=textpage) for page, textpage in pages)
        recognised = True
        if not title:
            title = largest_text_line(pages[0][0], pages[0][1])
    if not title and document.page_count:
        title = largest_text_line(document[0])
    return DocumentFacts(
        text=text,
        title=title,
        author=(metadata.get("author") or "").strip(),
        subject=(metadata.get("subject") or "").strip(),
        pages=document.page_count,
        metadata_date=_metadata_date(document),
        recognised=recognised,
    )


def _cache_key(path: Path, max_pages: int, ocr: OcrSettings | None) -> CacheKey | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return (
        os.path.normcase(str(path.resolve())),
        stat.st_mtime_ns,
        stat.st_size,
        max_pages,
        f"{ocr.language}@{ocr.dpi}" if ocr else "",
    )


def _remember(key: CacheKey, facts: DocumentFacts) -> None:
    global _facts_cache_chars
    if len(facts.text) > FACTS_CACHE_CHARS:
        return
    _facts_cache[key] = facts
    _facts_cache_chars += len(facts.text)
    while _facts_cache_chars > FACTS_CACHE_CHARS and _facts_cache:
        _, dropped = _facts_cache.popitem(last=False)
        _facts_cache_chars -= len(dropped.text)


def cached_facts(
    path: Path, password: str | None, max_pages: int, ocr: OcrSettings | None = None
) -> DocumentFacts:
    key = _cache_key(path, max_pages, ocr)
    if key is not None and key in _facts_cache:
        _facts_cache.move_to_end(key)
        return _facts_cache[key]
    with open_document(str(path), password) as document:
        facts = read_facts(document, max_pages, ocr)
    if key is not None:
        _remember(key, facts)
    return facts


def facts_fields(
    facts: DocumentFacts,
    path: Path,
    custom_patterns: dict[str, re.Pattern[str]],
    date_format: str,
    date_order: DateOrder = "dmy",
) -> dict[str, str]:
    found_date = find_date(facts.text, date_order) or facts.metadata_date
    fields: dict[str, str] = {
        "name": path.stem,
        "ext": path.suffix.lstrip("."),
        "pages": str(facts.pages),
        "title": facts.title,
        "author": facts.author,
        "subject": facts.subject,
        "date": formatted_date(found_date, date_format) if found_date else "",
        "year": str(found_date.year) if found_date else "",
        "invoice": find_invoice(facts.text),
        "amount": find_amount(facts.text),
    }
    for key, pattern in custom_patterns.items():
        match = pattern.search(facts.text)
        fields[key] = (
            match.group(1) if match and match.groups() else match.group(0) if match else ""
        ).strip()
    return fields


class RenameReplacement(RpcModel):
    find: str = Field(min_length=1, max_length=200)
    replace: str = Field(default="", max_length=200)
    regex: bool = False


class RenamePreviewParams(RpcModel):
    paths: list[str]
    password: str | None = None
    passwords: dict[str, str] = Field(default_factory=dict)
    pattern: str = "{date} {title}"
    custom_patterns: dict[str, str] = Field(default_factory=dict)
    max_pages: int = Field(default=2, ge=1, le=20)
    date_format: str = "%Y-%m-%d"
    date_order: DateOrder = "dmy"
    counter_start: int = Field(default=1, ge=0, le=1_000_000_000)
    counter_step: int = Field(default=1, ge=1, le=1_000_000)
    counter_digits: int = Field(default=0, ge=0, le=9)
    case: NameCase = "keep"
    turkish_case: bool = False
    replacements: list[RenameReplacement] = Field(default_factory=list, max_length=10)
    overrides: dict[str, str] = Field(default_factory=dict)
    ocr: bool = False
    ocr_languages: list[str] = Field(default_factory=lambda: ["tur", "eng"])


class RenameItem(RpcModel):
    path: str
    new_name: str
    fields: dict[str, str]
    conflict: bool
    error: str | None = None
    bytes: int = 0
    modified: float = 0
    recognised: bool = False


class RenamePreviewResult(RpcModel):
    items: list[RenameItem]


def _compile_custom(patterns: dict[str, str]) -> dict[str, re.Pattern[str]]:
    compiled: dict[str, re.Pattern[str]] = {}
    for key, value in patterns.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise OpError(ErrorCode.INVALID_PARAMS, f"invalid field name: {key}")
        try:
            compiled[key] = re.compile(value, re.IGNORECASE)
        except re.error as error:
            raise OpError(
                ErrorCode.INVALID_PARAMS, f"invalid pattern for {key}: {error}"
            ) from error
    return compiled


def _compile_replacements(
    replacements: list[RenameReplacement],
) -> list[tuple[re.Pattern[str], str]]:
    compiled: list[tuple[re.Pattern[str], str]] = []
    for replacement in replacements:
        try:
            pattern = re.compile(
                replacement.find if replacement.regex else re.escape(replacement.find)
            )
            pattern.sub(replacement.replace if replacement.regex else "", "")
        except (re.error, IndexError) as error:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"invalid replacement {replacement.find!r}: {error}",
                {"reason": "replacement"},
            ) from error
        literal = replacement.replace.replace("\\", "\\\\")
        compiled.append((pattern, replacement.replace if replacement.regex else literal))
    return compiled


def change_case(text: str, case: NameCase, turkish: bool = False) -> str:
    if case == "keep":
        return text
    if case == "upper":
        return (text.replace("i", "İ").replace("ı", "I") if turkish else text).upper()
    if case == "lower":
        return (text.replace("I", "ı").replace("İ", "i") if turkish else text).lower()
    return re.sub(
        r"[^\W\d_]+",
        lambda word: (
            change_case(word[0][0], "upper", turkish) + change_case(word[0][1:], "lower", turkish)
        ),
        text,
    )


@dataclass(frozen=True)
class NameRules:
    pattern: str
    replacements: list[tuple[re.Pattern[str], str]]
    case: NameCase
    turkish: bool


def _segments(pattern: str) -> list[str]:
    return [segment for segment in re.split(r"[/\\]", pattern) if segment.strip()]


def build_name(rules: NameRules, fields: dict[str, str], fallback: str) -> str:
    segments = _segments(rules.pattern)[-(MAX_FOLDER_DEPTH + 1) :]
    rendered: list[str] = []
    for position, segment in enumerate(segments):
        last = position == len(segments) - 1
        text = TOKEN.sub(lambda match: fields.get(match[1], match[0]), segment)
        for pattern, replacement in rules.replacements:
            text = pattern.sub(replacement, text)
        text = change_case(text, rules.case, rules.turkish)
        if not text.strip(" ._-"):
            if last:
                rendered.append(sanitize_file_name(fallback))
            continue
        rendered.append(sanitize_file_name(text))
    return "/".join(rendered) or sanitize_file_name(fallback)


def clean_override(value: str, fallback: str) -> str:
    segments = [sanitize_file_name(segment) for segment in _segments(value)]
    return "/".join(segments[-(MAX_FOLDER_DEPTH + 1) :]) or sanitize_file_name(fallback)


def _counter(params: RenamePreviewParams, position: int) -> str:
    last = params.counter_start + (len(params.paths) - 1) * params.counter_step
    width = max(params.counter_digits, len(str(last)) if params.counter_digits == 0 else 0)
    return f"{params.counter_start + position * params.counter_step:0{width}d}"


def _file_stat(path: Path) -> tuple[int, float]:
    try:
        stat = path.stat()
    except OSError:
        return 0, 0
    return stat.st_size, stat.st_mtime * 1000


@op("rename.preview", RenamePreviewParams)
def preview(params: RenamePreviewParams, progress: Progress) -> RenamePreviewResult:
    if not params.paths:
        raise OpError(ErrorCode.INVALID_PARAMS, "no files given")
    if not params.pattern.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "pattern is empty")
    custom = _compile_custom(params.custom_patterns)
    formatted_date(datetime.date(2000, 1, 31), params.date_format)
    rules = NameRules(
        pattern=params.pattern,
        replacements=_compile_replacements(params.replacements),
        case=params.case,
        turkish=params.turkish_case,
    )
    ocr = OcrSettings(language=_language_string(params.ocr_languages)) if params.ocr else None
    items: list[RenameItem] = []
    for position, raw_path in enumerate(params.paths):
        progress.check_cancelled()
        path = Path(raw_path)
        size, modified = _file_stat(path)
        try:
            facts = cached_facts(
                path, params.passwords.get(raw_path) or params.password, params.max_pages, ocr
            )
            fields = facts_fields(facts, path, custom, params.date_format, params.date_order)
            fields.setdefault("n", _counter(params, position))
            fields.setdefault("time", datetime.datetime.now().strftime("%H-%M-%S"))
            override = params.overrides.get(raw_path)
            new_name = (
                clean_override(override, path.stem)
                if override and override.strip()
                else build_name(rules, fields, path.stem)
            )
            items.append(
                RenameItem(
                    path=raw_path,
                    new_name=new_name,
                    fields=fields,
                    conflict=False,
                    bytes=size,
                    modified=modified,
                    recognised=facts.recognised,
                )
            )
        except OpError as error:
            if error.code in (ErrorCode.TESSDATA_MISSING, ErrorCode.CANCELLED):
                raise
            items.append(
                RenameItem(
                    path=raw_path,
                    new_name=path.stem,
                    fields={},
                    conflict=False,
                    error=error.code,
                    bytes=size,
                    modified=modified,
                )
            )
        progress.report(
            (position + 1) / len(params.paths),
            "progress.analyzing",
            {"current": position + 1, "total": len(params.paths)},
        )
    claimed: set[tuple[str, str]] = set()
    vacating = {
        os.path.normcase(str(Path(item.path)))
        for item in items
        if not item.error and item.new_name != Path(item.path).stem
    }
    for item in items:
        if item.error:
            continue
        source = Path(item.path)
        target = source.parent / f"{item.new_name}{source.suffix}"
        key = (os.path.normcase(str(target.parent.resolve())), target.name.lower())
        occupied = (
            target.exists()
            and os.path.normcase(str(target)) not in vacating
            and target.resolve() != source.resolve()
        )
        item.conflict = key in claimed or occupied
        claimed.add(key)
    return RenamePreviewResult(items=items)


class RenameApplyItem(RpcModel):
    path: str
    new_name: str


class RenameApplyParams(RpcModel):
    items: list[RenameApplyItem]
    mode: Literal["rename", "copy"] = "rename"
    output_dir: str | None = None
    overwrite: bool = False
    auto_unique: bool = True


class RenameOutcome(RpcModel):
    path: str
    output: str | None
    ok: bool
    error: str | None = None
    replaced: bool = False


class RenameApplyResult(RpcModel):
    results: list[RenameOutcome]
    renamed: int
    created_dirs: list[str] = Field(default_factory=list)


@dataclass
class _PlannedRename:
    position: int
    item: RenameApplyItem
    source: Path
    target: Path
    same_file: bool
    parked: Path | None = None


def _normalized(path: Path) -> str:
    return os.path.normcase(str(path.resolve()))


def _park_name(source: Path) -> Path:
    return source.with_name(f".{source.stem}.{uuid.uuid4().hex[:8]}.renaming{source.suffix}")


def _unpark(entry: _PlannedRename) -> None:
    if entry.parked is None or not entry.parked.exists():
        return
    try:
        os.replace(entry.parked, entry.source)
    except OSError:
        return
    entry.parked = None


def _target_of(base: Path, new_name: str) -> tuple[Path, str]:
    segments = [sanitize_file_name(segment) for segment in _segments(new_name)]
    segments = segments[-(MAX_FOLDER_DEPTH + 1) :] or [FALLBACK_NAME]
    directory = base.joinpath(*segments[:-1])
    if not _normalized(directory).startswith(_normalized(base)):
        raise OpError(ErrorCode.INVALID_PARAMS, f"target leaves the folder: {new_name}")
    return directory, segments[-1]


def _missing_parents(directory: Path, base: Path) -> list[Path]:
    missing: list[Path] = []
    current = directory
    while not current.exists() and _normalized(current) != _normalized(base):
        missing.append(current)
        current = current.parent
    return missing


@op("rename.apply", RenameApplyParams)
def apply(params: RenameApplyParams, progress: Progress) -> RenameApplyResult:
    if not params.items:
        raise OpError(ErrorCode.INVALID_PARAMS, "no files given")
    output_dir = Path(params.output_dir) if params.output_dir else None
    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
    moving = params.mode == "rename"
    outcomes: dict[int, RenameOutcome] = {}
    listings: dict[tuple[str, str], set[str]] = {}
    sources_by_dir: dict[str, set[str]] = {}
    targets: dict[int, tuple[Path, str]] = {}
    for position, item in enumerate(params.items):
        source = Path(item.path)
        try:
            targets[position] = _target_of(output_dir or source.parent, item.new_name)
        except OpError as error:
            outcomes[position] = RenameOutcome(
                path=item.path, output=None, ok=False, error=error.code
            )
            continue
        if moving:
            directory, name = targets[position]
            wanted = directory / f"{name}{source.suffix}"
            if source.is_file() and _normalized(wanted) != _normalized(source):
                sources_by_dir.setdefault(_normalized(source.parent), set()).add(
                    source.name.lower()
                )

    def taken_stems(directory: Path, suffix: str) -> set[str]:
        key = (_normalized(directory), suffix.lower())
        if key not in listings:
            leaving = sources_by_dir.get(key[0], set())
            listings[key] = (
                {
                    entry.stem.lower()
                    for entry in directory.iterdir()
                    if entry.suffix.lower() == key[1] and entry.name.lower() not in leaving
                }
                if directory.is_dir()
                else set()
            )
        return listings[key]

    claimed: set[str] = set()
    plan: list[_PlannedRename] = []
    for position, item in enumerate(params.items):
        progress.check_cancelled()
        if position in outcomes:
            continue
        source = Path(item.path)
        if not source.is_file():
            outcomes[position] = RenameOutcome(
                path=item.path, output=None, ok=False, error="FILE_NOT_FOUND"
            )
            continue
        target_dir, name = targets[position]
        target = target_dir / f"{name}{source.suffix}"
        same_file = target.exists() and target.resolve() == source.resolve()
        taken = taken_stems(target_dir, source.suffix)
        claim = _normalized(target)
        if same_file:
            taken.add(name.lower())
        elif params.auto_unique:
            name = unique_name(name, taken)
            target = target_dir / f"{name}{source.suffix}"
        elif claim in claimed or (name.lower() in taken and not params.overwrite):
            outcomes[position] = RenameOutcome(
                path=item.path, output=str(target), ok=False, error="EXISTS"
            )
            continue
        else:
            taken.add(name.lower())
        claimed.add(_normalized(target))
        plan.append(_PlannedRename(position, item, source, target, same_file))

    if moving:
        planned_targets = {_normalized(entry.target) for entry in plan if not entry.same_file}
        for entry in plan:
            progress.check_cancelled()
            if entry.same_file or _normalized(entry.source) not in planned_targets:
                continue
            parked = _park_name(entry.source)
            try:
                os.replace(entry.source, parked)
            except OSError as error:
                outcomes[entry.position] = RenameOutcome(
                    path=entry.item.path, output=None, ok=False, error=str(error)
                )
                continue
            entry.parked = parked

    renamed = 0
    created: list[Path] = []
    base_of = {entry.position: output_dir or entry.source.parent for entry in plan}
    for done, entry in enumerate(plan, start=1):
        if entry.position in outcomes:
            continue
        current = entry.parked or entry.source
        replaced = False
        try:
            missing = _missing_parents(entry.target.parent, base_of[entry.position])
            if missing:
                entry.target.parent.mkdir(parents=True, exist_ok=True)
                created.extend(reversed(missing))
            if entry.same_file:
                if moving and entry.target.name != entry.source.name:
                    os.replace(current, entry.target)
                    renamed += 1
            elif entry.target.exists() and not params.overwrite:
                raise FileExistsError(entry.target)
            elif moving:
                replaced = entry.target.exists()
                os.replace(current, entry.target)
                renamed += 1
            else:
                replaced = entry.target.exists()
                shutil.copy2(current, entry.target)
                renamed += 1
        except FileExistsError:
            _unpark(entry)
            outcomes[entry.position] = RenameOutcome(
                path=entry.item.path, output=str(entry.target), ok=False, error="EXISTS"
            )
        except OSError as error:
            _unpark(entry)
            outcomes[entry.position] = RenameOutcome(
                path=entry.item.path, output=None, ok=False, error=str(error)
            )
        else:
            outcomes[entry.position] = RenameOutcome(
                path=entry.item.path, output=str(entry.target), ok=True, replaced=replaced
            )
        progress.report(
            done / len(plan), "progress.renaming", {"current": done, "total": len(plan)}
        )
    results = [outcomes[position] for position in sorted(outcomes)]
    return RenameApplyResult(
        results=results, renamed=renamed, created_dirs=[str(path) for path in created]
    )


class RenameUndoItem(RpcModel):
    path: str
    original: str


class RenameUndoParams(RpcModel):
    items: list[RenameUndoItem]
    remove_dirs: list[str] = Field(default_factory=list)


class RenameUndoResult(RpcModel):
    results: list[RenameOutcome]
    restored: int


@op("rename.undo", RenameUndoParams)
def undo(params: RenameUndoParams, progress: Progress) -> RenameUndoResult:
    if not params.items:
        raise OpError(ErrorCode.INVALID_PARAMS, "no files given")
    outcomes: dict[int, RenameOutcome] = {}
    parked: dict[int, Path] = {}
    for position, item in enumerate(params.items):
        progress.check_cancelled()
        current = Path(item.path)
        if not current.is_file():
            outcomes[position] = RenameOutcome(
                path=item.path, output=None, ok=False, error="FILE_NOT_FOUND"
            )
            continue
        holding = _park_name(current)
        try:
            os.replace(current, holding)
        except OSError as error:
            outcomes[position] = RenameOutcome(
                path=item.path, output=None, ok=False, error=str(error)
            )
            continue
        parked[position] = holding
    restored = 0
    for done, (position, holding) in enumerate(parked.items(), start=1):
        item = params.items[position]
        original = Path(item.original)
        try:
            if original.exists():
                raise FileExistsError(original)
            original.parent.mkdir(parents=True, exist_ok=True)
            os.replace(holding, original)
        except OSError as error:
            with contextlib.suppress(OSError):
                os.replace(holding, item.path)
            outcomes[position] = RenameOutcome(
                path=item.path,
                output=str(original),
                ok=False,
                error="EXISTS" if isinstance(error, FileExistsError) else str(error),
            )
        else:
            restored += 1
            outcomes[position] = RenameOutcome(path=item.path, output=str(original), ok=True)
        progress.report(
            done / len(parked), "progress.renaming", {"current": done, "total": len(parked)}
        )
    for directory in sorted(params.remove_dirs, key=len, reverse=True):
        with contextlib.suppress(OSError):
            Path(directory).rmdir()
    results = [outcomes[position] for position in sorted(outcomes)]
    return RenameUndoResult(results=results, restored=restored)
