import contextlib
import itertools
import re
import uuid
import warnings
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import pymupdf
from PIL import Image
from pydantic import Field, model_validator
from pymupdf import mupdf

from vivepdf.ops._document import forget_document, open_document
from vivepdf.ops._image_files import (
    SIDEWAYS_ORIENTATIONS,
    exif_orientation,
    insert_image_file,
    picture_too_large,
    picture_unreadable,
)
from vivepdf.ops._naming import sanitize_file_name
from vivepdf.ops._output import (
    OutputResult,
    prepare_output,
    replace_patiently,
    save_document,
    unlink_patiently,
)
from vivepdf.ops._page_pruning import keep_only_present_pages
from vivepdf.ops._paper import PaperPattern, draw_paper
from vivepdf.ops._protection import Protection, SourceSeal, protection_source, save_protected
from vivepdf.ops._ranges import (
    PageScope,
    contiguous_runs,
    no_pages_selected,
    one_based_to_indices,
    parse_page_ranges,
    scope_indices,
)
from vivepdf.ops._toc import normalized_toc
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

Rotation = Literal[0, 90, 180, 270]
LabelStyle = Literal["D", "r", "R", "a", "A", ""]
MAX_PAGE_SIDE = 14400.0
MAX_IMAGE_PIXELS = 100_000_000


class SourceParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False


class AssembleSource(RpcModel):
    id: str
    path: str
    password: str | None = None


class AssemblePage(RpcModel):
    kind: Literal["page", "blank", "image"] = "page"
    source: str | None = None
    index: int | None = Field(default=None, ge=1)
    rotate: Rotation = 0
    width: float | None = Field(default=None, gt=0, le=MAX_PAGE_SIDE, allow_inf_nan=False)
    height: float | None = Field(default=None, gt=0, le=MAX_PAGE_SIDE, allow_inf_nan=False)
    path: str | None = None
    paper: PaperPattern | None = None


class PageLabelRule(RpcModel):
    start: int = Field(ge=0)
    style: LabelStyle = "D"
    prefix: str = Field(default="", max_length=64)
    first_number: int = Field(default=1, ge=1, le=100_000)


def _unique_source_ids(sources: list[AssembleSource]) -> None:
    ids = [source.id for source in sources]
    if len(ids) != len(set(ids)):
        raise ValueError("source ids must be unique")


class AssembleParams(RpcModel):
    sources: list[AssembleSource] = Field(min_length=1)
    pages: list[AssemblePage] = Field(min_length=1)
    output: str | None = None
    in_place: bool = False
    overwrite: bool = False
    labels: list[PageLabelRule] | None = None

    @model_validator(mode="after")
    def _distinct_sources(self) -> "AssembleParams":
        _unique_source_ids(self.sources)
        return self


MAX_IMAGE_PAGE = (595.0, 842.0)


DEFAULT_PAGE = (595.0, 842.0)


def _image_pixels(path: Path) -> tuple[int, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                width, height = image.size
                if exif_orientation(image) in SIDEWAYS_ORIENTATIONS:
                    width, height = height, width
    except Image.DecompressionBombError as error:
        raise picture_too_large(path) from error
    except Exception as error:  # noqa: BLE001
        raise picture_unreadable(path) from error
    if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
        raise picture_too_large(path, width, height)
    return (width, height)


def _image_page_size(path: Path, spec: AssemblePage) -> tuple[float, float]:
    if spec.width and spec.height:
        return (spec.width, spec.height)
    pixel_width, pixel_height = _image_pixels(path)
    width, height = float(pixel_width), float(pixel_height)
    max_w, max_h = MAX_IMAGE_PAGE
    if width > height:
        max_w, max_h = max_h, max_w
    scale = min(max_w / width, max_h / height, 1.0)
    return (width * scale, height * scale)


def _validate_pages(pages: list[AssemblePage], documents: dict[str, pymupdf.Document]) -> None:
    for position, spec in enumerate(pages):
        if spec.kind == "page":
            if spec.source not in documents or spec.index is None:
                raise OpError(
                    ErrorCode.INVALID_PARAMS, f"page {position + 1}: unknown source or index"
                )
            count = documents[spec.source].page_count
            if spec.index > count:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"page {position + 1}: index {spec.index} is outside 1..{count}",
                    {"page": spec.index, "pageCount": count},
                )
        elif spec.kind == "image":
            if not spec.path or not Path(spec.path).is_file():
                raise OpError(
                    ErrorCode.FILE_NOT_FOUND,
                    f"page {position + 1}: image not found",
                    {"path": spec.path},
                )
            _image_pixels(Path(spec.path))


def _blank_size(
    spec: AssemblePage,
    result: pymupdf.Document,
    arrangement: list[AssemblePage],
    documents: dict[str, pymupdf.Document],
) -> tuple[float, float]:
    if spec.width and spec.height:
        return (spec.width, spec.height)
    if result.page_count:
        rect = result[result.page_count - 1].rect
        return (rect.width, rect.height)
    for other in arrangement:
        if other.kind == "page" and other.source in documents and other.index:
            rect = documents[other.source][other.index - 1].rect
            return (rect.width, rect.height)
    return DEFAULT_PAGE


def _run_end(pages: list[AssemblePage], start: int) -> int:
    end = start
    while (
        end + 1 < len(pages)
        and pages[end + 1].kind == "page"
        and pages[end + 1].source == pages[start].source
        and pages[end + 1].index == (pages[end].index or 0) + 1
    ):
        end += 1
    return end


def _assembled(
    pages: list[AssemblePage],
    arrangement: list[AssemblePage],
    sources: list[AssembleSource],
    documents: dict[str, pymupdf.Document],
    progress: Progress,
    report: Callable[[float], None],
    label_parts: "list[LabelParts] | None" = None,
) -> pymupdf.Document:
    result = pymupdf.open()
    try:
        first_position: dict[tuple[str, int], int] = {}
        origins: list[tuple[str, int] | None] = []
        cursor = 0
        while cursor < len(pages):
            progress.check_cancelled()
            spec = pages[cursor]
            if spec.kind == "page" and spec.source is not None and spec.index is not None:
                end = _run_end(pages, cursor)
                last_index = pages[end].index or spec.index
                result.insert_pdf(
                    documents[spec.source],
                    from_page=spec.index - 1,
                    to_page=last_index - 1,
                    final=False,
                )
                for offset, item in enumerate(pages[cursor : end + 1]):
                    position = result.page_count - (end - cursor) - 1 + offset
                    first_position.setdefault((spec.source, (item.index or 1) - 1), position)
                    origins.append((spec.source, (item.index or 1) - 1))
                    if item.rotate:
                        page = result[position]
                        page.set_rotation((page.rotation + item.rotate) % 360)
                cursor = end + 1
                report(cursor / len(pages))
                continue
            if spec.kind == "blank":
                width, height = _blank_size(spec, result, arrangement, documents)
                page = result.new_page(width=width, height=height)
                if spec.paper is not None:
                    draw_paper(page, spec.paper)
            else:
                image_path = Path(spec.path or "")
                width, height = _image_page_size(image_path, spec)
                page = result.new_page(width=width, height=height)
                insert_image_file(page, page.rect, image_path, keep_proportion=True)
            if spec.rotate:
                page.set_rotation(spec.rotate)
            origins.append(None)
            cursor += 1
            if cursor % 25 == 0:
                report(cursor / len(pages))
        _rebuild_internal_links(result, documents, origins, first_position)
        _carry_bookmarks(result, sources, documents, first_position)
        _carry_document_extras(result, documents[sources[0].id])
        labels = (
            _assembled_labels(documents, origins)
            if label_parts is None
            else _explicit_labels(label_parts)
        )
        if labels:
            result.set_page_labels(labels)
        return result
    except BaseException:
        result.close()
        raise


DESTINATION_ARRAY = re.compile(r"\[\s*\d+\s+\d+\s+R\s*([^\[\]]*)\]")
METADATA_SKIPPED = frozenset({"format", "encryption"})
BOOKMARK_STYLE_KEYS = ("color", "bold", "italic", "collapse")


def _named_destination(document: pymupdf.Document, kind: str, value: str) -> str:
    try:
        needle = (
            mupdf.pdf_new_name(value.lstrip("/"))
            if kind == "name"
            else mupdf.pdf_new_text_string(value)
        )
        found = mupdf.pdf_lookup_dest(pymupdf._as_pdf_document(document), needle)
        if not found.m_internal:
            return ""
        resolved = mupdf.pdf_resolve_indirect(found)
        if resolved.pdf_is_dict():
            resolved = mupdf.pdf_resolve_indirect(mupdf.pdf_dict_gets(resolved, "D"))
        printed = pymupdf.JM_object_to_buffer(resolved, 1, 0)
        return printed.fz_buffer_extract().decode("latin-1")
    except Exception:  # noqa: BLE001
        return ""


def _destination_view(document: pymupdf.Document, xref: int) -> str:
    for key in ("Dest", "A/D"):
        kind, value = document.xref_get_key(xref, key)
        if kind == "array":
            text = value
        elif kind == "xref":
            text = document.xref_object(int(value.split()[0]), compressed=True)
        elif kind in ("string", "name"):
            text = _named_destination(document, kind, value)
        else:
            continue
        found = DESTINATION_ARRAY.search(text)
        if found:
            return found.group(1).strip() or "/Fit"
    return "/Fit"


def _goto_action(result: pymupdf.Document, position: int, view: str) -> str:
    return f"<</S/GoTo/D[{result.page_xref(position)} 0 R {view}]>>"


def _is_internal_link(link: dict) -> bool:
    if link.get("page", -1) < 0 or not link.get("xref"):
        return False
    return link["kind"] == pymupdf.LINK_GOTO or (
        link["kind"] == pymupdf.LINK_NAMED and "nameddest" in link
    )


def _rebuild_internal_links(
    result: pymupdf.Document,
    documents: dict[str, pymupdf.Document],
    origins: list[tuple[str, int] | None],
    first_position: dict[tuple[str, int], int],
) -> None:
    for position, origin in enumerate(origins):
        if origin is None:
            continue
        source = documents[origin[0]]
        wanted = [
            (link, first_position[(origin[0], link["page"])])
            for link in source[origin[1]].get_links()
            if _is_internal_link(link) and (origin[0], link["page"]) in first_position
        ]
        page = result[position]
        for link in page.get_links():
            if link["kind"] == pymupdf.LINK_GOTO:
                page.delete_link(link)
        if not wanted:
            continue
        page = result.reload_page(page)
        before = {link["xref"] for link in page.get_links()}
        for _link, target in wanted:
            page.insert_link(
                {
                    "kind": pymupdf.LINK_GOTO,
                    "from": pymupdf.Rect(0, 0, 1, 1),
                    "page": target,
                    "to": pymupdf.Point(0, 0),
                }
            )
        page = result.reload_page(page)
        created = [link["xref"] for link in page.get_links() if link["xref"] not in before]
        for xref, (link, target) in zip(created, wanted, strict=True):
            kind, rect = source.xref_get_key(link["xref"], "Rect")
            if kind == "array":
                result.xref_set_key(xref, "Rect", rect)
            view = _destination_view(source, link["xref"])
            result.xref_set_key(xref, "A", _goto_action(result, target, view))
            result.xref_set_key(xref, "Dest", "null")


def _carry_bookmarks(
    result: pymupdf.Document,
    sources: list[AssembleSource],
    documents: dict[str, pymupdf.Document],
    first_position: dict[tuple[str, int], int],
) -> None:
    entries: list[tuple[list, pymupdf.Document, int]] = []
    for source in sources:
        document = documents[source.id]
        for level, title, page_number, *rest in document.get_toc(simple=False):
            position = first_position.get((source.id, page_number - 1))
            if position is None:
                continue
            dest = rest[0] if rest and isinstance(rest[0], dict) else {}
            style = {key: dest[key] for key in BOOKMARK_STYLE_KEYS if key in dest}
            style["kind"] = pymupdf.LINK_GOTO
            entries.append(([level, title, position + 1, style], document, dest.get("xref", 0)))
    if not entries:
        return
    entries.sort(key=lambda entry: entry[0][2])
    result.set_toc(normalized_toc([entry[0] for entry in entries]))
    outline = result.get_outline_xrefs()
    if len(outline) != len(entries):
        return
    for xref, (toc_entry, document, source_xref) in zip(outline, entries, strict=True):
        if not source_xref:
            continue
        view = _destination_view(document, source_xref)
        result.xref_set_key(xref, "A", _goto_action(result, toc_entry[2] - 1, view))
        result.xref_set_key(xref, "Dest", "null")


def _carry_document_extras(result: pymupdf.Document, main: pymupdf.Document) -> None:
    metadata = {
        key: value for key, value in (main.metadata or {}).items() if key not in METADATA_SKIPPED
    }
    if any(metadata.values()):
        result.set_metadata(metadata)
    for name in main.embfile_names():
        info = main.embfile_info(name)
        result.embfile_add(
            name,
            main.embfile_get(name),
            filename=info.get("filename") or name,
            ufilename=info.get("ufilename") or name,
            desc=info.get("description") or "",
        )


def _main_protection(
    sources: list[AssembleSource], documents: dict[str, pymupdf.Document]
) -> tuple[SourceSeal | None, Protection | None]:
    main = sources[0]
    return protection_source(documents[main.id], main.path, main.password)


def _open_sources(sources: list[AssembleSource], documents: dict[str, pymupdf.Document]) -> None:
    for source in sources:
        documents[source.id] = open_document(source.path, source.password)


def _assemble_target(params: AssembleParams) -> Path | None:
    if params.in_place and params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "give either an output file or in-place, not both",
            {"reason": "outputAndInPlace"},
        )
    if params.in_place:
        return None
    if not params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "an output file or in-place is required",
            {"reason": "outputRequired"},
        )
    return prepare_output(
        params.output, [source.path for source in params.sources], params.overwrite
    )


def _save_assembled_in_place(
    result: pymupdf.Document,
    documents: dict[str, pymupdf.Document],
    seal: SourceSeal | None,
    protection: Protection | None,
    main_path: str,
) -> OutputResult:
    original = Path(main_path)
    staging = original.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"
    try:
        saved = save_protected(result, staging, seal, protection)
        result.close()
        if seal is not None:
            seal.close()
        for document in documents.values():
            document.close()
        forget_document(main_path)
        replace_patiently(staging, original)
    except BaseException:
        with contextlib.suppress(OSError):
            unlink_patiently(staging)
        raise
    return OutputResult(
        output=main_path, page_count=saved.page_count, bytes=original.stat().st_size
    )


@op("pages.assemble", AssembleParams)
def assemble(params: AssembleParams, progress: Progress) -> OutputResult:
    label_parts = (
        None if params.labels is None else explicit_label_parts(params.labels, len(params.pages))
    )
    target = _assemble_target(params)
    documents: dict[str, pymupdf.Document] = {}
    try:
        _open_sources(params.sources, documents)
        _validate_pages(params.pages, documents)
        result = _assembled(
            params.pages,
            params.pages,
            params.sources,
            documents,
            progress,
            lambda fraction: progress.report(fraction, "progress.assembling"),
            label_parts,
        )
        seal, protection = _main_protection(params.sources, documents)
        try:
            progress.report(0.9, "progress.saving")
            if target is None:
                return _save_assembled_in_place(
                    result, documents, seal, protection, params.sources[0].path
                )
            return save_protected(result, target, seal, protection)
        finally:
            if not result.is_closed:
                result.close()
            if seal is not None:
                seal.close()
    finally:
        for document in documents.values():
            if not document.is_closed:
                document.close()


class AssemblePartsParams(RpcModel):
    sources: list[AssembleSource] = Field(min_length=1)
    pages: list[AssemblePage] = Field(min_length=1)
    cuts: list[int] = Field(min_length=1)
    output_dir: str
    base_name: str | None = None
    overwrite: bool = False
    labels: list[PageLabelRule] | None = None

    @model_validator(mode="after")
    def _distinct_sources(self) -> "AssemblePartsParams":
        _unique_source_ids(self.sources)
        return self


class AssembledPart(OutputResult):
    first_page: int
    last_page: int


class AssemblePartsResult(RpcModel):
    outputs: list[AssembledPart]


def part_bounds(total: int, cuts: list[int]) -> list[tuple[int, int]]:
    starts = sorted(set(cuts))
    outside = [cut for cut in starts if cut < 1 or cut >= total]
    if outside:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cut {outside[0]} is outside 1..{total - 1}",
            {"cut": outside[0], "pageCount": total},
        )
    edges = [0, *starts, total]
    return list(itertools.pairwise(edges))


def _staging_path(target: Path) -> Path:
    return target.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.staged.pdf"


def _part_file_name(base_name: str, position: int, width: int, first: int, last: int) -> str:
    label = f"{first}" if first == last else f"{first}-{last}"
    return f"{base_name}-{position + 1:0{width}d}-p{label}.pdf"


@op("pages.assemble_parts", AssemblePartsParams)
def assemble_parts(params: AssemblePartsParams, progress: Progress) -> AssemblePartsResult:
    bounds = part_bounds(len(params.pages), params.cuts)
    label_parts = (
        None if params.labels is None else explicit_label_parts(params.labels, len(params.pages))
    )
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    base_name = sanitize_file_name(params.base_name or "part")
    width = len(str(len(bounds)))
    inputs = [source.path for source in params.sources]
    targets = [
        prepare_output(
            str(output_dir / _part_file_name(base_name, position, width, start + 1, end)),
            inputs,
            params.overwrite,
        )
        for position, (start, end) in enumerate(bounds)
    ]
    documents: dict[str, pymupdf.Document] = {}
    outputs: list[AssembledPart] = []
    staged: list[Path] = []
    seal: SourceSeal | None = None
    try:
        _open_sources(params.sources, documents)
        _validate_pages(params.pages, documents)
        seal, protection = _main_protection(params.sources, documents)
        for position, (start, end) in enumerate(bounds):
            progress.check_cancelled()
            progress.report(
                position / len(bounds),
                "progress.splitting",
                {"current": position + 1, "total": len(bounds)},
            )
            result = _assembled(
                params.pages[start:end],
                params.pages,
                params.sources,
                documents,
                progress,
                lambda _fraction: None,
                None
                if label_parts is None or params.labels is None
                else _part_labels(label_parts, params.labels, start, end),
            )
            stage = _staging_path(targets[position])
            staged.append(stage)
            try:
                saved = save_protected(result, stage, seal, protection)
            finally:
                result.close()
            outputs.append(
                AssembledPart(
                    output=str(targets[position]),
                    page_count=saved.page_count,
                    bytes=saved.bytes,
                    first_page=start + 1,
                    last_page=end,
                )
            )
        progress.check_cancelled()
        for stage, target in zip(staged, targets, strict=True):
            if target.exists():
                forget_document(str(target))
            stage.replace(target)
        staged.clear()
    except BaseException:
        for stage in staged:
            stage.unlink(missing_ok=True)
        raise
    finally:
        if seal is not None:
            seal.close()
        for document in documents.values():
            document.close()
    return AssemblePartsResult(outputs=outputs)


def _part_labels(
    parts: "list[LabelParts]", rules: list[PageLabelRule], start: int, end: int
) -> "list[LabelParts]":
    first_rule = min((rule.start for rule in rules), default=len(parts))
    return [
        ("D", "", position - start + 1) if position < first_rule else parts[position]
        for position in range(start, end)
    ]


def _assembled_labels(
    documents: dict[str, pymupdf.Document], origins: list[tuple[str, int] | None]
) -> list[dict] | None:
    sources = {key: page_label_parts(document) for key, document in documents.items()}
    if not any(sources.values()):
        return None
    parts: list[LabelParts] = []
    for position, origin in enumerate(origins):
        found = sources.get(origin[0]) if origin else None
        parts.append(found[origin[1]] if found and origin else ("D", "", position + 1))
    return label_rules(parts)


LabelParts = tuple[str, str, int]


def explicit_label_parts(rules: list[PageLabelRule], total: int) -> list[LabelParts]:
    ordered = sorted(rules, key=lambda rule: rule.start)
    starts = [rule.start for rule in ordered]
    if len(set(starts)) != len(starts):
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "two page label rules start on the same page",
            {"reason": "labels"},
        )
    if ordered and ordered[-1].start >= total:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"page label starts on page {ordered[-1].start + 1}, outside 1..{total}",
            {"reason": "labels", "page": ordered[-1].start + 1, "pageCount": total},
        )
    parts: list[LabelParts] = []
    current: PageLabelRule | None = None
    upcoming = iter(ordered)
    following = next(upcoming, None)
    for position in range(total):
        while following is not None and following.start <= position:
            current = following
            following = next(upcoming, None)
        if current is None:
            parts.append(("D", "", position + 1))
        else:
            parts.append(
                (current.style, current.prefix, current.first_number + position - current.start)
            )
    return parts


def _explicit_labels(parts: list[LabelParts]) -> list[dict] | None:
    if all(part == ("D", "", position + 1) for position, part in enumerate(parts)):
        return None
    return label_rules(parts)


def page_label_parts(document: pymupdf.Document) -> list[LabelParts] | None:
    rules = sorted(document.get_page_labels() or [], key=lambda rule: rule.get("startpage", 0))
    if not rules:
        return None
    parts: list[LabelParts] = []
    current = -1
    for index in range(document.page_count):
        while current + 1 < len(rules) and rules[current + 1].get("startpage", 0) <= index:
            current += 1
        if current < 0:
            parts.append(("D", "", index + 1))
            continue
        rule = rules[current]
        first = int(rule.get("firstpagenum", 1) or 1)
        parts.append(
            (
                str(rule.get("style", "") or ""),
                str(rule.get("prefix", "") or ""),
                first + index - int(rule.get("startpage", 0)),
            )
        )
    return parts


def label_rules(parts: list[LabelParts]) -> list[dict]:
    rules: list[dict] = []
    previous: LabelParts | None = None
    for position, (style, prefix, number) in enumerate(parts):
        continues = (
            previous is not None
            and previous[0] == style
            and previous[1] == prefix
            and (style == "" or number == previous[2] + 1)
        )
        if not continues:
            rules.append(
                {"startpage": position, "style": style, "prefix": prefix, "firstpagenum": number}
            )
        previous = (style, prefix, number)
    return rules


def _remapped_toc(
    source: pymupdf.Document, indices: list[int], offset: int, level_shift: int
) -> list[list]:
    position_of = {index: position for position, index in enumerate(indices)}
    toc: list[list] = []
    for level, title, page in source.get_toc(simple=True):
        index = page - 1
        if index in position_of:
            toc.append([level + level_shift, title, position_of[index] + offset + 1])
    return toc


class PagesParams(SourceParams):
    pages: list[int] | None = Field(default=None, min_length=1)
    scope: PageScope | None = None

    @model_validator(mode="after")
    def _pages_or_scope(self) -> "PagesParams":
        if (self.pages is None) == (self.scope is None):
            raise ValueError("give either pages or scope")
        return self

    def indices(self, page_count: int) -> list[int]:
        if self.scope is not None:
            return scope_indices(self.scope, page_count)
        return one_based_to_indices(self.pages or [], page_count)


class PageTurn(RpcModel):
    page: int
    rotate: Literal[90, 180, 270]


class EditPagesParams(RpcModel):
    path: str
    password: str | None = None
    output: str | None = None
    in_place: bool = False
    overwrite: bool = False
    delete: list[int] = Field(default_factory=list)
    rotations: list[PageTurn] = Field(default_factory=list)


KIDS_ARRAY = re.compile(r"\[\s*(?:\d+\s+\d+\s+R\s*)*\]")
KID_REFERENCE = re.compile(r"\d+\s+\d+\s+R")


def page_xrefs(document: pymupdf.Document) -> list[int]:
    return [document.page_xref(index) for index in range(document.page_count)]


def _page_tree_nodes(document: pymupdf.Document) -> list[tuple[int, str]] | None:
    kind, value = document.xref_get_key(document.pdf_catalog(), "Pages")
    if kind != "xref":
        return None
    pending = [int(value.split()[0])]
    seen: set[int] = set()
    nodes: list[tuple[int, str]] = []
    while pending:
        node = pending.pop()
        if node in seen:
            return None
        seen.add(node)
        kind, kids = document.xref_get_key(node, "Kids")
        if kind != "array" or not KIDS_ARRAY.fullmatch(kids.strip()):
            return None
        nodes.append((node, kids))
        for reference in KID_REFERENCE.findall(kids):
            kid = int(reference.split()[0])
            if document.xref_get_key(kid, "Type")[1] == "/Pages":
                pending.append(kid)
    return nodes


def _refresh_pages(document: pymupdf.Document) -> None:
    document._reset_page_refs()
    pdf = pymupdf._as_pdf_document(document)
    if pdf.m_internal.rev_page_map:
        pymupdf.mupdf.ll_pdf_drop_page_tree(pdf.m_internal)


def _reverse_page_tree(document: pymupdf.Document, expected: list[int]) -> bool:
    nodes = _page_tree_nodes(document)
    if nodes is None:
        return False
    for node, kids in nodes:
        reversed_kids = " ".join(reversed(KID_REFERENCE.findall(kids)))
        document.xref_set_key(node, "Kids", f"[{reversed_kids}]")
    _refresh_pages(document)
    if page_xrefs(document) == expected:
        return True
    for node, kids in nodes:
        document.xref_set_key(node, "Kids", kids)
    _refresh_pages(document)
    return False


def _delete_complement(document: pymupdf.Document, indices: list[int]) -> None:
    kept = set(indices)
    removed = [index for index in range(document.page_count) if index not in kept]
    pdf = pymupdf._as_pdf_document(document)
    for first, last in reversed(contiguous_runs(removed)):
        pymupdf.mupdf.pdf_delete_page_range(pdf, first, last + 1)
    _refresh_pages(document)


def _is_pure_deletion(indices: list[int], count: int) -> bool:
    ascending = all(later > earlier for earlier, later in itertools.pairwise(indices))
    return ascending and count - len(indices) <= len(indices)


def _rearrange(document: pymupdf.Document, indices: list[int]) -> None:
    count = document.page_count
    if indices == list(range(count)):
        return
    before = page_xrefs(document)
    expected = [before[index] for index in indices]
    distinct = len(set(before)) == count
    if distinct and indices == list(range(count - 1, -1, -1)):
        if _reverse_page_tree(document, expected):
            return
    elif distinct and _is_pure_deletion(indices, count):
        _delete_complement(document, indices)
        current = page_xrefs(document)
        if current == expected:
            return
        position = {xref: index for index, xref in enumerate(current)}
        if not all(xref in position for xref in expected):
            raise OpError(ErrorCode.INVALID_PDF, "the page tree could not be rearranged")
        document.select([position[xref] for xref in expected])
        return
    document.select(indices)


def _select_keeping_structure(document: pymupdf.Document, indices: list[int]) -> bool:
    every_page_kept = set(indices) == set(range(document.page_count))
    toc = _remapped_toc(document, indices, 0, 0)
    had_toc = bool(document.get_toc(simple=True))
    labels = page_label_parts(document)
    catalog = document.pdf_catalog()
    form_kind, form_value = document.xref_get_key(catalog, "AcroForm")
    _rearrange(document, indices)
    if form_kind in ("xref", "dict"):
        document.xref_set_key(catalog, "AcroForm", form_value)
    if had_toc:
        document.set_toc(normalized_toc(toc))
    if labels:
        document.set_page_labels(label_rules([labels[index] for index in indices]))
    return every_page_kept


def _save_selection(
    document: pymupdf.Document,
    target: Path,
    params: SourceParams | EditPagesParams,
    every_page_kept: bool,
) -> OutputResult:
    if every_page_kept:
        return save_document(document, target)
    path, password = params.path, params.password
    plain = keep_only_present_pages(document.tobytes(encryption=pymupdf.PDF_ENCRYPT_NONE))
    seal, protection = protection_source(document, path, password)
    try:
        with pymupdf.open(stream=plain, filetype="pdf") as result:
            return save_protected(result, target, seal, protection)
    finally:
        if seal is not None:
            seal.close()


@op("pages.delete", PagesParams)
def delete_pages(params: PagesParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        remove = set(params.indices(document.page_count))
        keep = [index for index in range(document.page_count) if index not in remove]
        if not keep:
            raise OpError(ErrorCode.INVALID_PARAMS, "cannot delete every page")
        complete = _select_keeping_structure(document, keep)
        progress.report(0.8, "progress.saving")
        return _save_selection(document, target, params, complete)


@op("pages.extract", PagesParams)
def extract_pages(params: PagesParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        complete = _select_keeping_structure(document, params.indices(document.page_count))
        progress.report(0.8, "progress.saving")
        return _save_selection(document, target, params, complete)


class RotateParams(SourceParams):
    pages: str | None = None
    scope: PageScope | None = None
    degrees: Literal[90, 180, 270]


@op("pages.rotate", RotateParams)
def rotate_pages(params: RotateParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        indices = dict.fromkeys(
            scope_indices(params.scope, document.page_count)
            if params.scope is not None
            else parse_page_ranges(params.pages, document.page_count)
        )
        pages = [document[index] for index in indices]
        for page in pages:
            page.set_rotation((page.rotation + params.degrees) % 360)
        progress.report(0.8, "progress.saving")
        return save_document(document, target)


def _edit_target(params: EditPagesParams) -> Path | None:
    if params.in_place and params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "give either an output file or in-place, not both",
            {"reason": "outputAndInPlace"},
        )
    if params.in_place:
        return None
    if not params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "an output file or in-place is required",
            {"reason": "outputRequired"},
        )
    return prepare_output(params.output, [params.path], params.overwrite)


def _checked_page(page: int, page_count: int) -> int:
    if 0 <= page < page_count:
        return page
    raise OpError(
        ErrorCode.INVALID_PARAMS,
        f"page index {page} is outside 0..{page_count - 1}",
        {"reason": "pageOutOfRange", "page": page + 1, "pageCount": page_count},
    )


def _page_turns(rotations: list[PageTurn], page_count: int) -> dict[int, int]:
    turns: dict[int, int] = {}
    for turn in rotations:
        index = _checked_page(turn.page, page_count)
        turns[index] = (turns.get(index, 0) + turn.rotate) % 360
    return {index: degrees for index, degrees in turns.items() if degrees}


def _replace_with_selection(
    document: pymupdf.Document, params: EditPagesParams, every_page_kept: bool
) -> OutputResult:
    original = Path(params.path)
    staging = original.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"
    try:
        _save_selection(document, staging, params, every_page_kept)
        page_count = document.page_count
        document.close()
        forget_document(params.path)
        replace_patiently(staging, original)
    except BaseException:
        with contextlib.suppress(OSError):
            unlink_patiently(staging)
        raise
    return OutputResult(output=params.path, page_count=page_count, bytes=original.stat().st_size)


@op("pages.edit", EditPagesParams)
def edit_pages(params: EditPagesParams, progress: Progress) -> OutputResult:
    from vivepdf.ops._inplace import save_in_place

    target = _edit_target(params)
    document = open_document(params.path, params.password)
    try:
        count = document.page_count
        remove = {_checked_page(page, count) for page in params.delete}
        turns = _page_turns(params.rotations, count)
        if not remove and not turns:
            raise no_pages_selected()
        keep = [index for index in range(count) if index not in remove]
        if not keep:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "cannot delete every page", {"reason": "allPagesDeleted"}
            )
        for index, degrees in turns.items():
            if index not in remove:
                page = document[index]
                page.set_rotation((page.rotation + degrees) % 360)
        progress.report(0.8, "progress.saving")
        if not remove:
            if target is None:
                return save_in_place(document, params.path)
            return save_document(document, target)
        complete = _select_keeping_structure(document, keep)
        if target is None:
            return _replace_with_selection(document, params, complete)
        return _save_selection(document, target, params, complete)
    finally:
        if not document.is_closed:
            document.close()


@op("pages.reverse", SourceParams)
def reverse_pages(params: SourceParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        complete = _select_keeping_structure(document, list(reversed(range(document.page_count))))
        progress.report(0.8, "progress.saving")
        return _save_selection(document, target, params, complete)


class InsertBlankParams(SourceParams):
    at: int = Field(ge=1)
    count: int = Field(default=1, ge=1, le=100)
    width: float | None = None
    height: float | None = None
    paper: PaperPattern | None = None


@op("pages.insert_blank", InsertBlankParams)
def insert_blank(params: InsertBlankParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        if params.at > document.page_count + 1:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"position {params.at} is outside 1..{document.page_count + 1}",
            )
        neighbour = document[min(params.at, document.page_count) - 1].rect
        width = params.width or neighbour.width
        height = params.height or neighbour.height
        for offset in range(params.count):
            page = document.new_page(params.at - 1 + offset, width=width, height=height)
            if params.paper is not None:
                draw_paper(page, params.paper)
        progress.report(0.8, "progress.saving")
        return save_document(document, target)


class InsertFromParams(RpcModel):
    path: str
    password: str | None = None
    source_path: str
    source_password: str | None = None
    source_pages: list[int] = Field(min_length=1)
    at: int = Field(default=0, ge=0)


class InsertFromResult(OutputResult):
    inserted: int


@op("pages.insert_from", InsertFromParams)
def insert_from(params: InsertFromParams, progress: Progress) -> InsertFromResult:
    from vivepdf.ops._inplace import rewrite_in_place

    if Path(params.path).resolve() == Path(params.source_path).resolve():
        raise OpError(
            ErrorCode.INVALID_PARAMS, "source and target are the same file", {"reason": "sameFile"}
        )
    document = open_document(params.path, params.password)
    try:
        with open_document(params.source_path, params.source_password) as source:
            wanted = sorted(
                {page for page in params.source_pages if 1 <= page <= source.page_count}
            )
            if not wanted:
                raise OpError(
                    ErrorCode.INVALID_PARAMS, "no valid source pages", {"reason": "empty"}
                )
            start = (
                document.page_count
                if params.at == 0 or params.at > document.page_count
                else params.at - 1
            )
            for first, last in contiguous_runs([page - 1 for page in wanted]):
                document.insert_pdf(
                    source, from_page=first, to_page=last, start_at=start, final=False
                )
                start += last - first + 1
        progress.report(0.9, "progress.saving")
        saved = rewrite_in_place(document, params.path)
        return InsertFromResult(**saved.model_dump(), inserted=len(wanted))
    finally:
        if not document.is_closed:
            document.close()


class FindTextParams(RpcModel):
    path: str
    password: str | None = None
    query: str = Field(min_length=1, max_length=500)
    match_case: bool = False
    whole_word: bool = False


class FindTextResult(RpcModel):
    pages: list[int]


def _squashed(text: str) -> str:
    return " ".join(text.replace("­", "").split())


def _find_pattern(query: str, match_case: bool, whole_word: bool) -> re.Pattern[str]:
    needle = query if match_case else query.casefold()
    escaped = re.escape(needle)
    if whole_word:
        escaped = rf"(?<!\w){escaped}(?!\w)"
    return re.compile(escaped, re.UNICODE)


@op("pages.find_text", FindTextParams)
def find_text(params: FindTextParams, progress: Progress) -> FindTextResult:
    query = _squashed(params.query)
    if not query:
        raise OpError(ErrorCode.INVALID_PARAMS, "the query is empty", {"reason": "emptyQuery"})
    pattern = _find_pattern(query, params.match_case, params.whole_word)
    found: list[int] = []
    with open_document(params.path, params.password) as document:
        count = document.page_count
        for index in range(count):
            progress.check_cancelled()
            text = _squashed(document[index].get_text("text"))
            if not params.match_case:
                text = text.casefold()
            if pattern.search(text):
                found.append(index + 1)
            progress.report((index + 1) / count, "progress.searching")
    return FindTextResult(pages=found)
