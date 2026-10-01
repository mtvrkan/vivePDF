import math
import tempfile
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import write_atomically
from vivepdf.ops._pptx_layout import (
    SlideFrame,
    add_line_box,
    line_boxes,
    slide_text,
    text_free_pixmap,
)
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops.convert import PagedFileResult, PdfSourceParams, _prepare_file
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op


class PptxParams(PdfSourceParams):
    dpi: int = Field(default=150, ge=50, le=300)
    mode: Literal["editable", "image"] = "editable"


EMU_PER_POINT = 12700
MAX_SLIDE_EMU = 51206400
MIN_SLIDE_EMU = 914400
MAX_SLIDE_PIXELS = 50_000_000
NOTES_LIMIT = 20000


def slide_dpi(rect: pymupdf.Rect, dpi: int) -> int:
    area = abs(rect.width * rect.height)
    if area <= 0:
        return dpi
    ceiling = int(72 * math.sqrt(MAX_SLIDE_PIXELS / area))
    return max(1, min(dpi, ceiling))


def slide_size(rect: pymupdf.Rect) -> tuple[int, int]:
    width = rect.width * EMU_PER_POINT
    height = rect.height * EMU_PER_POINT
    scale = max(1.0, MIN_SLIDE_EMU / max(1.0, min(width, height)))
    scale = min(scale, MAX_SLIDE_EMU / max(width, height))
    return round(width * scale), round(height * scale)


def fitted_box(
    page: pymupdf.Rect, slide_width: int, slide_height: int
) -> tuple[int, int, int, int]:
    ratio = min(slide_width / page.width, slide_height / page.height)
    width = round(page.width * ratio)
    height = round(page.height * ratio)
    return (slide_width - width) // 2, (slide_height - height) // 2, width, height


@op("convert.to_pptx", PptxParams)
def to_pptx(params: PptxParams, progress: Progress) -> PagedFileResult:
    from pptx import Presentation

    target = _prepare_file(params.output, [params.path], params.overwrite, ".pptx")
    presentation = Presentation()
    blank_layout = presentation.slide_layouts[6]
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        slide_width, slide_height = slide_size(document[indices[0]].rect)
        presentation.slide_width = slide_width
        presentation.slide_height = slide_height
        editable = params.mode == "editable"
        with tempfile.TemporaryDirectory(prefix="vivepdf-pptx-") as temp_dir:
            for position, index in enumerate(indices):
                progress.check_cancelled()
                page = document[index]
                image_path = Path(temp_dir) / f"page-{index + 1}.png"
                dpi = slide_dpi(page.rect, params.dpi)
                if editable:
                    text_free_pixmap(document, index, dpi).save(str(image_path))
                else:
                    page.get_pixmap(dpi=dpi).save(str(image_path))
                slide = presentation.slides.add_slide(blank_layout)
                left, top, width, height = fitted_box(page.rect, slide_width, slide_height)
                slide.shapes.add_picture(str(image_path), left, top, width=width, height=height)
                if editable:
                    frame = SlideFrame(left=left, top=top, ratio=width / page.rect.width)
                    for box in line_boxes(page):
                        add_line_box(slide, box, frame)
                else:
                    text = slide_text(page.get_text()).strip()
                    if text:
                        slide.notes_slide.notes_text_frame.text = text[:NOTES_LIMIT]
                progress.report(
                    position / len(indices),
                    "progress.convertingPages",
                    {"current": position + 1, "total": len(indices)},
                )
            write_atomically(target, lambda partial: presentation.save(str(partial)))
        return PagedFileResult(
            output=str(target), bytes=target.stat().st_size, page_count=len(indices)
        )
