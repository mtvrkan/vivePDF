import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._contents_page import ContentsEntry, contents_page_count, draw_contents
from vivepdf.ops._document import open_document
from vivepdf.ops._mail import MailLabels
from vivepdf.ops._merge_fields import separate_field_names, top_field_names
from vivepdf.ops._naming import render_name, sanitize_file_name, unique_name
from vivepdf.ops._output import (
    OutputResult,
    prepare_output,
    save_document,
)
from vivepdf.ops._protection import (
    Protection,
    SourceSeal,
    is_protected,
    protection_source,
    save_protected,
)
from vivepdf.ops._ranges import (
    contiguous_runs,
    parse_page_ranges,
    parse_split_groups,
)
from vivepdf.ops._text_match import compile_text_pattern, text_label
from vivepdf.ops._toc import normalized_toc
from vivepdf.ops.pages import (
    LabelParts,
    _remapped_toc,
    label_rules,
    page_label_parts,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

TITLE_IN_NAME = 48

BookmarkStyle = Literal["nested", "files", "originals", "none"]


class MergeInput(RpcModel):
    path: str
    password: str | None = None
    ranges: str | None = None
    reverse: bool = False


class MergeParams(RpcModel):
    inputs: list[MergeInput] = Field(min_length=1)
    output: str
    overwrite: bool = False
    add_bookmarks: bool = True
    bookmarks: BookmarkStyle | None = None
    contents_page: bool = False
    contents_title: str = Field(default="Contents", min_length=1, max_length=120)
    interleave: bool = False
    pad_odd: bool = False
    keep_protection: bool = True
    mail_labels: MailLabels = MailLabels()

    def bookmark_style(self) -> BookmarkStyle:
        if self.bookmarks is not None:
            return self.bookmarks
        return "nested" if self.add_bookmarks else "none"


class MergeResult(OutputResult):
    protected_from: str | None = None
    renamed_fields: int = 0


Placement = tuple[int, int | None]


def _merge_placements(
    selections: list[list[int]], interleave: bool, pad_odd: bool
) -> list[Placement]:
    placements: list[Placement] = []
    if interleave:
        longest = max(len(indices) for indices in selections)
        for step in range(longest):
            for position, indices in enumerate(selections):
                if step < len(indices):
                    placements.append((position, indices[step]))
        return placements
    for position, indices in enumerate(selections):
        placements.extend((position, index) for index in indices)
        if pad_odd and len(indices) % 2 == 1 and position < len(selections) - 1:
            placements.append((position, None))
    return placements


def _insert_placements(
    merged: pymupdf.Document,
    documents: list[pymupdf.Document],
    placements: list[Placement],
    progress: Progress,
    reopen: Callable[[int], pymupdf.Document] | None = None,
) -> None:
    placed: dict[int, set[int]] = {}
    forms = [bool(document.is_form_pdf) for document in documents]
    cursor = 0
    while cursor < len(placements):
        progress.check_cancelled()
        position, index = placements[cursor]
        if index is None:
            neighbour = documents[position][placements[cursor - 1][1] or 0].rect
            merged.new_page(width=neighbour.width, height=neighbour.height)
            cursor += 1
            continue
        end = cursor
        while (
            end + 1 < len(placements)
            and placements[end + 1][0] == position
            and placements[end + 1][1] == (placements[end][1] or 0) + 1
        ):
            end += 1
        source = documents[position]
        run = set(range(index, (placements[end][1] or 0) + 1))
        seen = placed.setdefault(id(source), set())
        if reopen is not None and forms[position] and seen & run:
            source = reopen(position)
            seen = placed.setdefault(id(source), set())
        seen |= run
        merged.insert_pdf(source, from_page=index, to_page=placements[end][1], final=False)
        cursor = end + 1
        progress.report(0.5 + 0.4 * cursor / len(placements), "progress.merging")


def _merged_labels(
    documents: list[pymupdf.Document], placements: list[Placement], lead: int = 0
) -> list[dict] | None:
    sources = [page_label_parts(document) for document in documents]
    if not any(sources):
        return None
    parts: list[LabelParts] = [("r", "", number + 1) for number in range(lead)]
    for merged_position, (position, index) in enumerate(placements):
        source = sources[position]
        if index is None or source is None:
            parts.append(("D", "", merged_position + 1))
        else:
            parts.append(source[index])
    return label_rules(parts)


def _first_positions(placements: list[Placement]) -> dict[tuple[int, int], int]:
    first_position: dict[tuple[int, int], int] = {}
    for merged_position, (position, index) in enumerate(placements):
        if index is not None:
            first_position.setdefault((position, index), merged_position)
    return first_position


def _file_starts(
    selections: list[list[int]], first_position: dict[tuple[int, int], int]
) -> list[int | None]:
    return [
        first_position.get((position, selection[0])) if selection else None
        for position, selection in enumerate(selections)
    ]


def _merged_toc(
    params: MergeParams,
    style: BookmarkStyle,
    documents: list[pymupdf.Document],
    selections: list[list[int]],
    first_position: dict[tuple[int, int], int],
) -> list[list]:
    toc: list[list] = []
    if style == "files":
        starts = _file_starts(selections, first_position)
        for item, start in zip(params.inputs, starts, strict=True):
            if start is not None:
                toc.append([1, Path(item.path).stem, start + 1])
        return toc
    if params.interleave:
        for position, document in enumerate(documents):
            for level, title, page in document.get_toc(simple=True):
                found = first_position.get((position, page - 1))
                if found is not None:
                    toc.append([level, title, found + 1])
        toc.sort(key=lambda entry: entry[2])
        return toc
    multiple = style == "nested" and len(documents) > 1
    for position, document in enumerate(documents):
        offset = first_position[(position, selections[position][0])]
        if multiple:
            toc.append([1, Path(params.inputs[position].path).stem, offset + 1])
        toc.extend(_remapped_toc(document, selections[position], offset, 1 if multiple else 0))
    return toc


def _converted_input(
    item: MergeInput, temp_dir: str, position: int, progress: Progress, labels: MailLabels
) -> str:
    from vivepdf.ops.convert_to_pdf import FileToPdfParams, file_to_pdf

    converted = str(Path(temp_dir) / f"input-{position:03d}.pdf")
    file_to_pdf(
        FileToPdfParams(path=item.path, output=converted, overwrite=True, mail_labels=labels),
        progress,
    )
    return converted


def _first_protected(
    params: MergeParams, documents: list[pymupdf.Document]
) -> tuple[MergeInput, pymupdf.Document] | None:
    if not params.keep_protection:
        return None
    for item, document in zip(params.inputs, documents, strict=True):
        if is_protected(document):
            return item, document
    return None


def _contents_entries(
    params: MergeParams,
    selections: list[list[int]],
    first_position: dict[tuple[int, int], int],
    lead: int,
) -> list[ContentsEntry]:
    return [
        ContentsEntry(Path(item.path).stem, start + lead)
        for item, start in zip(params.inputs, _file_starts(selections, first_position), strict=True)
        if start is not None
    ]


def _add_contents_pages(
    merged: pymupdf.Document,
    params: MergeParams,
    selections: list[list[int]],
    first_position: dict[tuple[int, int], int],
) -> int:
    if not params.contents_page or merged.page_count == 0:
        return 0
    size = merged[0].rect
    count = contents_page_count(
        len(_contents_entries(params, selections, first_position, 0)), size.height
    )
    for _ in range(count):
        merged.new_page(pno=0, width=size.width, height=size.height)
    return count


def _draw_contents(
    merged: pymupdf.Document,
    params: MergeParams,
    selections: list[list[int]],
    first_position: dict[tuple[int, int], int],
    lead: int,
    labelled: bool,
) -> None:
    entries = _contents_entries(params, selections, first_position, lead)
    labels = {entry.target: merged[entry.target].get_label() for entry in entries if labelled}
    draw_contents(
        merged,
        lead,
        params.contents_title,
        entries,
        {target: label for target, label in labels.items() if label},
    )


@op("pages.merge", MergeParams)
def merge(params: MergeParams, progress: Progress) -> MergeResult:
    target = prepare_output(params.output, [item.path for item in params.inputs], params.overwrite)
    merged = pymupdf.open()
    documents: list[pymupdf.Document] = []
    opened: dict[tuple[str, str | None], pymupdf.Document] = {}
    handles: list[pymupdf.Document] = []
    temp_dir = tempfile.mkdtemp(prefix="vivepdf-merge-")
    try:
        selections: list[list[int]] = []
        source_paths: list[str] = []
        for position, item in enumerate(params.inputs):
            progress.check_cancelled()
            progress.report(
                0.5 * position / len(params.inputs),
                "progress.merging",
                {"current": position + 1, "total": len(params.inputs)},
            )
            source_path = item.path
            if Path(item.path).suffix.lower() != ".pdf":
                share = progress.within(
                    0.5 * position / len(params.inputs), 0.5 * (position + 1) / len(params.inputs)
                )
                source_path = _converted_input(item, temp_dir, position, share, params.mail_labels)
            key = (str(Path(source_path).resolve()), item.password)
            source = opened.get(key)
            if source is None or source.is_form_pdf:
                source = open_document(source_path, item.password)
                handles.append(source)
                opened.setdefault(key, source)
            documents.append(source)
            source_paths.append(source_path)
            indices = parse_page_ranges(item.ranges, source.page_count)
            selections.append(list(reversed(indices)) if item.reverse else indices)
        placements = _merge_placements(selections, params.interleave, params.pad_odd)

        def reopen(position: int) -> pymupdf.Document:
            fresh = open_document(source_paths[position], params.inputs[position].password)
            handles.append(fresh)
            return fresh

        _insert_placements(merged, documents, placements, progress, reopen)
        renamed_fields = separate_field_names(
            merged, set().union(*(top_field_names(document) for document in handles))
        )
        first_position = _first_positions(placements)
        lead = _add_contents_pages(merged, params, selections, first_position)
        style = params.bookmark_style()
        if style != "none":
            toc = [
                [level, title, page + lead]
                for level, title, page in _merged_toc(
                    params, style, documents, selections, first_position
                )
            ]
            if lead:
                toc.insert(0, [1, params.contents_title, 1])
            if toc:
                merged.set_toc(normalized_toc(toc))
        labels = _merged_labels(documents, placements, lead)
        if labels:
            merged.set_page_labels(labels)
        if lead:
            _draw_contents(merged, params, selections, first_position, lead, bool(labels))
        progress.report(0.9, "progress.saving")
        first = _first_protected(params, documents)
        if first is None:
            saved = save_document(merged, target)
            return MergeResult(**saved.model_dump(), renamed_fields=renamed_fields)
        item, document = first
        seal, protection = protection_source(document, item.path, item.password)
        try:
            saved = save_protected(merged, target, seal, protection)
        finally:
            if seal is not None:
                seal.close()
        return MergeResult(
            **saved.model_dump(),
            protected_from=Path(item.path).name,
            renamed_fields=renamed_fields,
        )
    finally:
        merged.close()
        for document in handles:
            document.close()
        shutil.rmtree(temp_dir, ignore_errors=True)


class SplitOutput(RpcModel):
    output: str
    page_count: int
    bytes: int
    first_page: int
    last_page: int


class SplitResult(RpcModel):
    outputs: list[SplitOutput]
    protected: bool = False
    oversized_parts: list[int] = Field(default_factory=list)


class SplitParams(RpcModel):
    path: str
    password: str | None = None
    mode: Literal["ranges", "every", "count", "single", "size", "bookmarks", "odd_even", "text"]
    ranges: str | None = None
    every: int | None = Field(default=None, ge=1)
    parts: int | None = Field(default=None, ge=1, le=10000)
    bookmark_level: int = Field(default=1, ge=1, le=9)
    max_bytes: int | None = Field(default=None, ge=1024)
    text_pattern: str | None = Field(default=None, max_length=500)
    output_dir: str
    base_name: str | None = None
    pattern: str | None = None
    overwrite: bool = False


def _page_weight(document: pymupdf.Document, index: int) -> int:
    page = document[index]
    weight = sum(len(document.xref_stream_raw(xref)) for xref in page.get_contents())
    for image in page.get_images(full=True):
        weight += len(document.xref_stream_raw(image[0]) or b"")
    return weight


def _page_weights(document: pymupdf.Document, progress: Progress) -> list[float]:
    weights: list[float] = []
    for index in range(document.page_count):
        progress.check_cancelled()
        if index % 25 == 0:
            progress.report(
                0.2 * index / max(1, document.page_count),
                "progress.analyzing",
                {"current": index + 1, "total": document.page_count},
            )
        weights.append(float(_page_weight(document, index)))
    file_bytes = Path(document.name).stat().st_size if document.name else 0
    shared = max(0.0, file_bytes - sum(weights)) / max(1, document.page_count)
    return [weight + shared for weight in weights]


MAX_SIZE_PROBES = 6


def _part_bytes(document: pymupdf.Document, first: int, last: int) -> int:
    part = pymupdf.open()
    try:
        part.insert_pdf(document, from_page=first, to_page=last)
        return len(part.tobytes(garbage=3, deflate=True, use_objstms=True))
    finally:
        part.close()


def _size_groups(document: pymupdf.Document, max_bytes: int, progress: Progress) -> list[list[int]]:
    weights = _page_weights(document, progress)
    total = document.page_count
    groups: list[list[int]] = []
    start = 0
    while start < total:
        progress.check_cancelled()
        progress.report(
            0.2 + 0.3 * start / total, "progress.analyzing", {"current": start + 1, "total": total}
        )
        end = start + 1
        estimate = weights[start]
        while end < total and estimate + weights[end] <= max_bytes:
            estimate += weights[end]
            end += 1
        for _ in range(MAX_SIZE_PROBES):
            progress.check_cancelled()
            if end - start <= 1:
                break
            measured = _part_bytes(document, start, end - 1)
            if measured <= max_bytes:
                break
            pages = end - start
            drop = max(1, min(pages - 1, int(pages * (1 - max_bytes / measured)) + 1))
            end -= drop
        groups.append(list(range(start, end)))
        start = end
    return groups


def _bookmark_groups(
    document: pymupdf.Document, max_level: int
) -> list[tuple[list[int], str | None]]:
    titles: dict[int, str] = {}
    for level, title, page in document.get_toc(simple=True):
        if level <= max_level and page >= 1:
            titles.setdefault(page - 1, title)
    if not titles:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "document has no top-level bookmarks",
            {"reason": "noBookmarks"},
        )
    starts = sorted(titles)
    if starts[0] != 0:
        starts.insert(0, 0)
    groups: list[tuple[list[int], str | None]] = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else document.page_count
        groups.append((list(range(start, end)), titles.get(start)))
    return groups


def _text_groups(
    document: pymupdf.Document, pattern: str | None, progress: Progress
) -> list[tuple[list[int], str | None]]:
    if not pattern or not pattern.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "textPattern is required for mode 'text'")
    compiled = compile_text_pattern(pattern)
    groups: list[tuple[list[int], str | None]] = []
    found = False
    total = document.page_count
    for index in range(total):
        progress.check_cancelled()
        if index % 10 == 0:
            progress.report(
                0.3 * index / total, "progress.analyzing", {"current": index + 1, "total": total}
            )
        label = text_label(document[index].get_text(), compiled)
        if label is not None:
            found = True
            groups.append(([], label))
        elif not groups:
            groups.append(([], None))
        groups[-1][0].append(index)
    if not found:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "the search text was not found", {"reason": "noMatches"}
        )
    return groups


def _count_groups(page_count: int, parts: int) -> list[list[int]]:
    parts = min(parts, page_count)
    size, extra = divmod(page_count, parts)
    groups: list[list[int]] = []
    start = 0
    for position in range(parts):
        length = size + (1 if position < extra else 0)
        groups.append(list(range(start, start + length)))
        start += length
    return groups


def _split_groups(
    params: SplitParams, document: pymupdf.Document, progress: Progress
) -> list[tuple[list[int], str | None]]:
    count = document.page_count
    if params.mode == "bookmarks":
        return _bookmark_groups(document, params.bookmark_level)
    if params.mode == "text":
        return _text_groups(document, params.text_pattern, progress)
    if params.mode == "ranges":
        if not params.ranges:
            raise OpError(ErrorCode.INVALID_PARAMS, "ranges are required for mode 'ranges'")
        groups = parse_split_groups(params.ranges, count)
    elif params.mode == "every":
        every = params.every or 1
        groups = [list(range(start, min(start + every, count))) for start in range(0, count, every)]
    elif params.mode == "count":
        if not params.parts:
            raise OpError(ErrorCode.INVALID_PARAMS, "parts is required for mode 'count'")
        groups = _count_groups(count, params.parts)
    elif params.mode == "single":
        groups = [[index] for index in range(count)]
    elif params.mode == "odd_even":
        groups = [list(range(0, count, 2)), list(range(1, count, 2))]
    else:
        if not params.max_bytes:
            raise OpError(ErrorCode.INVALID_PARAMS, "maxBytes is required for mode 'size'")
        groups = _size_groups(document, params.max_bytes, progress)
    return [(group, None) for group in groups]


def _part_name(
    base_name: str,
    position: int,
    width: int,
    group: list[int],
    title: str | None,
    pattern: str | None = None,
) -> str:
    first, last = group[0] + 1, group[-1] + 1
    if pattern and pattern.strip():
        rendered = render_name(
            pattern,
            {
                "name": base_name,
                "n": f"{position + 1:0{width}d}",
                "first": first,
                "last": last,
                "pages": len(group),
                "title": sanitize_file_name(title)[:TITLE_IN_NAME] if title else "",
            },
        )
        return f"{rendered}.pdf"
    label = f"{first}" if first == last else f"{first}-{last}"
    named = sanitize_file_name(title)[:TITLE_IN_NAME] if title else ""
    tail = named or f"p{label}"
    return f"{base_name}-{position + 1:0{width}d}-{tail}.pdf"


def _write_part(
    document: pymupdf.Document,
    group: list[int],
    labels: list[LabelParts] | None,
    target: Path,
    seal: SourceSeal | None = None,
    protection: Protection | None = None,
) -> OutputResult:
    part = pymupdf.open()
    try:
        for run_first, run_last in contiguous_runs(group):
            part.insert_pdf(document, from_page=run_first, to_page=run_last, final=False)
        toc = _remapped_toc(document, group, 0, 0)
        if toc:
            part.set_toc(normalized_toc(toc))
        if labels:
            part.set_page_labels(label_rules([labels[index] for index in group]))
        return save_protected(part, target, seal, protection)
    finally:
        part.close()


@op("pages.split", SplitParams)
def split(params: SplitParams, progress: Progress) -> SplitResult:
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    base_name = sanitize_file_name(params.base_name or Path(params.path).stem)
    outputs: list[SplitOutput] = []
    with open_document(params.path, params.password) as document:
        groups = [entry for entry in _split_groups(params, document, progress) if entry[0]]
        width = len(str(len(groups)))
        taken: set[str] = set()
        targets = [
            prepare_output(
                str(
                    output_dir
                    / (
                        unique_name(
                            _part_name(
                                base_name, position, width, group, title, params.pattern
                            ).removesuffix(".pdf"),
                            taken,
                        )
                        + ".pdf"
                    )
                ),
                [params.path],
                params.overwrite,
            )
            for position, (group, title) in enumerate(groups)
        ]
        written_share = {"size": 0.5, "text": 0.3}.get(params.mode, 0.0)
        labels = page_label_parts(document)
        protected = is_protected(document)
        seal, protection = protection_source(document, params.path, params.password)
        try:
            for position, (group, _title) in enumerate(groups):
                progress.check_cancelled()
                progress.report(
                    written_share + (1 - written_share) * position / len(groups),
                    "progress.splitting",
                    {"current": position + 1, "total": len(groups)},
                )
                saved = _write_part(document, group, labels, targets[position], seal, protection)
                outputs.append(
                    SplitOutput(
                        output=saved.output,
                        page_count=saved.page_count,
                        bytes=saved.bytes,
                        first_page=group[0] + 1,
                        last_page=group[-1] + 1,
                    )
                )
        except BaseException:
            for written in outputs:
                Path(written.output).unlink(missing_ok=True)
            raise
        finally:
            if seal is not None:
                seal.close()
    oversized = (
        [
            position + 1
            for position, part in enumerate(outputs)
            if part.bytes > (params.max_bytes or 0)
        ]
        if params.mode == "size"
        else []
    )
    return SplitResult(outputs=outputs, protected=protected, oversized_parts=oversized)
