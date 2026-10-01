import pymupdf

from vivepdf.ops._document import open_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

SAMPLE_WIDTH = 96
DARK_PAGE_LUMINANCE = 0.4
MIN_PICTURE_SHARE = 0.01
PAPER_LUMINANCE = 0.8
PAPER_SATURATION = 0.12
MAX_PICTURES = 32


class PageTonesParams(RpcModel):
    path: str
    password: str | None = None
    pages: str | None = None


class PictureArea(RpcModel):
    x: float
    y: float
    width: float
    height: float


class PageTone(RpcModel):
    page: int
    dark: bool
    pictures: list[PictureArea]


class PageTonesResult(RpcModel):
    pages: list[PageTone]


def _region_tone(sample: pymupdf.Pixmap, area: pymupdf.IRect) -> tuple[float, float]:
    samples = sample.samples
    stride = sample.stride
    count = 0
    luminance = 0.0
    saturation = 0
    for row in range(area.y0, area.y1):
        start = row * stride + area.x0 * 3
        line = samples[start : start + (area.x1 - area.x0) * 3]
        reds, greens, blues = line[0::3], line[1::3], line[2::3]
        luminance += 0.2126 * sum(reds) + 0.7152 * sum(greens) + 0.0722 * sum(blues)
        saturation += sum(
            max(pixel) - min(pixel) for pixel in zip(reds, greens, blues, strict=True)
        )
        count += len(reds)
    if count == 0:
        return 1.0, 0.0
    return luminance / count / 255, saturation / count / 255


def _is_paper(tone: tuple[float, float]) -> bool:
    luminance, saturation = tone
    return luminance >= PAPER_LUMINANCE and saturation < PAPER_SATURATION


def _pictures(page: pymupdf.Page, sample: pymupdf.Pixmap, scale: float) -> list[PictureArea]:
    width, height = page.cropbox.width, page.cropbox.height
    if width <= 0 or height <= 0:
        return []
    bounds = pymupdf.Rect(0, 0, width, height)
    found: list[tuple[float, PictureArea]] = []
    for info in page.get_image_info():
        box = pymupdf.Rect(info["bbox"]) & bounds
        if box.is_empty or box.is_infinite:
            continue
        share = box.width * box.height / (width * height)
        if share < MIN_PICTURE_SHARE:
            continue
        visible = (box * page.rotation_matrix * pymupdf.Matrix(scale, scale)).irect
        visible &= pymupdf.IRect(0, 0, sample.width, sample.height)
        if visible.is_empty or _is_paper(_region_tone(sample, visible)):
            continue
        area = PictureArea(
            x=box.x0 / width, y=box.y0 / height, width=box.width / width, height=box.height / height
        )
        found.append((share, area))
    found.sort(key=lambda entry: entry[0], reverse=True)
    return [area for _share, area in found[:MAX_PICTURES]]


def page_tone(page: pymupdf.Page) -> tuple[bool, list[PictureArea]]:
    scale = SAMPLE_WIDTH / max(page.rect.width, 1.0)
    sample = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False
    )
    luminance, _saturation = _region_tone(sample, pymupdf.IRect(0, 0, sample.width, sample.height))
    if luminance < DARK_PAGE_LUMINANCE:
        return True, []
    return False, _pictures(page, sample, scale)


@op("viewer.pageTones", PageTonesParams)
def page_tones(params: PageTonesParams, progress: Progress) -> PageTonesResult:
    with open_document(params.path, params.password, mutable=False) as document:
        tones: list[PageTone] = []
        for index in parse_page_ranges(params.pages, document.page_count):
            progress.check_cancelled()
            dark, pictures = page_tone(document[index])
            tones.append(PageTone(page=index + 1, dark=dark, pictures=pictures))
        return PageTonesResult(pages=tones)
