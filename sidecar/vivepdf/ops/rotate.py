from collections import Counter

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops.analyze import _analyze_page
from vivepdf.ops.ocr import _language_string
from vivepdf.ops.scan import best_rotation
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MIN_LINES = 3


def _direction_rotation(direction: tuple[float, float]) -> int:
    x, y = direction
    if abs(x) >= abs(y):
        return 0 if x > 0 else 180
    return 270 if y > 0 else 90


def text_rotation(page: pymupdf.Page) -> int | None:
    counts: Counter[int] = Counter()
    lines = 0
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            direction = line.get("dir")
            text = "".join(span.get("text", "") for span in line.get("spans", [])).strip()
            if not direction or len(text) < 2:
                continue
            lines += 1
            counts[_direction_rotation((float(direction[0]), float(direction[1])))] += len(text)
    if lines < MIN_LINES:
        return None
    unrotated = counts.most_common(1)[0][0]
    return (unrotated - page.rotation) % 360


class DetectRotationParams(RpcModel):
    path: str
    password: str | None = None
    pages: str | None = None
    ocr: bool = True
    languages: list[str] = Field(default_factory=lambda: ["eng"])


class PageRotation(RpcModel):
    page: int
    rotation: int
    method: str


class DetectRotationResult(RpcModel):
    items: list[PageRotation]
    upright: list[int] = Field(default_factory=list)
    checked: int


def detect_rotations(
    document: pymupdf.Document,
    indices: list[int],
    use_ocr: bool,
    language: str,
    progress: Progress | None,
    upright: list[int] | None = None,
) -> list[PageRotation]:
    items: list[PageRotation] = []
    for position, index in enumerate(indices):
        if progress:
            progress.check_cancelled()
            progress.report(
                position / max(1, len(indices)),
                "progress.inspecting",
                {"current": position + 1, "total": len(indices)},
            )
        page = document[index]
        rotation = text_rotation(page)
        method = "text"
        if rotation is None and use_ocr and _analyze_page(document, index).scanned:
            rotation = best_rotation(page, language)
            method = "ocr"
        if rotation:
            items.append(PageRotation(page=index + 1, rotation=rotation, method=method))
        elif rotation == 0 and method == "text" and upright is not None:
            upright.append(index + 1)
    return items


@op("pages.detect_rotation", DetectRotationParams)
def detect_rotation(params: DetectRotationParams, progress: Progress) -> DetectRotationResult:
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        upright: list[int] = []
        items = detect_rotations(
            document, indices, params.ocr, _language_string(params.languages), progress, upright
        )
        return DetectRotationResult(items=items, upright=upright, checked=len(indices))


class AutoRotateParams(DetectRotationParams):
    output: str
    overwrite: bool = False


class AutoRotateResult(OutputResult):
    rotated: int


@op("pages.auto_rotate", AutoRotateParams)
def auto_rotate(params: AutoRotateParams, progress: Progress) -> AutoRotateResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        items = detect_rotations(
            document, indices, params.ocr, _language_string(params.languages), progress
        )
        for item in items:
            page = document[item.page - 1]
            page.set_rotation((page.rotation + item.rotation) % 360)
        progress.report(0.95, "progress.saving")
        saved = save_document(document, target)
        return AutoRotateResult(**saved.model_dump(), rotated=len(items))
