import io
import tempfile
from pathlib import Path
from typing import Literal

import pymupdf
from PIL import Image, ImageOps
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._page_html import (
    COLOUR,
    checked_picture,
    colour_rgb,
    content_height,
    copy_picture,
    gap,
    insert_centered,
    text_block,
)
from vivepdf.ops._story import FONT_DIR
from vivepdf.ops.create import DEFAULT_ACCENT, FAMILIES, LOGO_EXTENSIONS, FontChoice
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

CoverStyle = Literal["classic", "band", "frame", "minimal", "photo"]
PHOTO_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
PHOTO_SHARE = 0.56
PHOTO_MAX_PIXELS = 2400
PHOTO_QUALITY = 88
REFERENCE_WIDTH = 595.0
WHITE = (1.0, 1.0, 1.0)


class CoverParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    style: CoverStyle = "classic"
    title: str = Field(default="", max_length=300)
    subtitle: str = Field(default="", max_length=300)
    author: str = Field(default="", max_length=300)
    organisation: str = Field(default="", max_length=500)
    date: str = Field(default="", max_length=80)
    details: str = Field(default="", max_length=1000)
    logo: str | None = None
    image: str | None = None
    accent: str = DEFAULT_ACCENT
    font: FontChoice = "sans"
    replace_first: bool = False


class Cover:
    def __init__(self, page: pymupdf.Page, params: CoverParams, logo: str | None, archive):
        self.page = page
        self.params = params
        self.logo = logo
        self.archive = archive
        self.rect = page.rect
        self.scale = min(self.rect.width, self.rect.height) / REFERENCE_WIDTH
        self.accent = colour_rgb(params.accent, DEFAULT_ACCENT)
        self.accent_hex = params.accent if COLOUR.match(params.accent) else DEFAULT_ACCENT

    def size(self, points: float) -> float:
        return round(points * self.scale, 1)

    def css(self, align: str = "center", colour: str = "#1a1a1a") -> str:
        family = FAMILIES[self.params.font]
        return "".join(
            [
                f"*{{font-family:{family};color:{colour};}}",
                f"p{{margin:0;text-align:{align};line-height:1.25;}}",
                f".title{{font-weight:bold;color:{self.accent_hex};}}",
                f".plain-title{{font-weight:bold;color:{colour};}}",
                ".muted{color:#555555;}",
                ".strong{font-weight:bold;}",
                f".logo{{max-height:{self.size(54)}pt;max-width:{self.size(170)}pt;}}",
                f".caps{{letter-spacing:{self.size(1.5)}pt;}}",
            ]
        )

    def area(self, left: float, top: float, right: float, bottom: float) -> pymupdf.Rect:
        width, height = self.rect.width, self.rect.height
        return pymupdf.Rect(width * left, height * top, width * right, height * bottom)

    def logo_html(self) -> str:
        return f'<p><img class="logo" src="{self.logo}"/></p>' if self.logo else ""

    def title_html(self, size: float, css_class: str = "title") -> str:
        return text_block(self.params.title, self.size(size), css_class)

    def people_html(self, size: float = 13) -> str:
        params = self.params
        return (
            text_block(params.author, self.size(size), "strong")
            + text_block(params.details, self.size(size - 2), "muted")
            + text_block(params.date, self.size(size - 2), "muted")
        )

    def put(self, rect: pymupdf.Rect, content: str, css: str, centred: bool = True) -> None:
        if not content:
            return
        if centred:
            insert_centered(self.page, rect, content, css, self.archive)
        else:
            self.page.insert_htmlbox(rect, content, css=css, archive=self.archive)

    def put_bottom(self, rect: pymupdf.Rect, content: str, css: str) -> None:
        if not content:
            return
        used = min(rect.height, content_height(rect, content, css, self.archive))
        lowered = pymupdf.Rect(rect.x0, rect.y1 - used, rect.x1, rect.y1)
        self.page.insert_htmlbox(lowered, content, css=css, archive=self.archive)


def _classic(cover: Cover) -> None:
    params = cover.params
    cover.put(cover.area(0.12, 0.06, 0.88, 0.2), cover.logo_html(), cover.css())
    heading = (
        text_block(params.organisation, cover.size(12), "muted caps")
        + gap(cover.size(18))
        + cover.title_html(32)
        + gap(cover.size(8))
        + text_block(params.subtitle, cover.size(16), "muted")
    )
    cover.put(cover.area(0.12, 0.24, 0.88, 0.62), heading, cover.css())
    middle = cover.rect.width / 2
    rule_y = cover.rect.height * 0.66
    cover.page.draw_line(
        (middle - cover.size(60), rule_y),
        (middle + cover.size(60), rule_y),
        color=cover.accent,
        width=cover.size(2),
    )
    cover.put(cover.area(0.12, 0.7, 0.88, 0.92), cover.people_html(), cover.css())


def _band(cover: Cover) -> None:
    params = cover.params
    band = cover.area(0, 0, 1, 0.42)
    cover.page.draw_rect(band, color=None, fill=cover.accent)
    white = cover.css("left", "#ffffff")
    heading = (
        text_block(params.organisation, cover.size(11), "caps")
        + gap(cover.size(10))
        + cover.title_html(34, "plain-title")
        + gap(cover.size(6))
        + text_block(params.subtitle, cover.size(15))
    )
    cover.put_bottom(cover.area(0.1, 0.06, 0.9, 0.38), heading, white)
    cover.put(cover.area(0.1, 0.47, 0.9, 0.6), cover.logo_html(), cover.css("left"), False)
    cover.put_bottom(cover.area(0.1, 0.62, 0.9, 0.92), cover.people_html(), cover.css("left"))


def _frame(cover: Cover) -> None:
    params = cover.params
    inset = cover.size(28)
    outer = cover.rect + (inset, inset, -inset, -inset)
    cover.page.draw_rect(outer, color=cover.accent, width=cover.size(2.5))
    step = cover.size(6)
    cover.page.draw_rect(
        outer + (step, step, -step, -step), color=cover.accent, width=cover.size(0.7)
    )
    top = (
        cover.logo_html()
        + gap(cover.size(6))
        + text_block(params.organisation, cover.size(13), "strong caps")
    )
    cover.put(cover.area(0.14, 0.08, 0.86, 0.3), top, cover.css())
    heading = (
        cover.title_html(28) + gap(cover.size(8)) + text_block(params.subtitle, cover.size(15))
    )
    cover.put(cover.area(0.14, 0.34, 0.86, 0.62), heading, cover.css())
    cover.put(cover.area(0.14, 0.66, 0.86, 0.9), cover.people_html(), cover.css())


def _minimal(cover: Cover) -> None:
    params = cover.params
    left = cover.rect.width * 0.1
    cover.page.draw_line(
        (left - cover.size(14), cover.rect.height * 0.08),
        (left - cover.size(14), cover.rect.height * 0.92),
        color=cover.accent,
        width=cover.size(3),
    )
    cover.put(cover.area(0.1, 0.07, 0.5, 0.2), cover.logo_html(), cover.css("left"), False)
    cover.put(
        cover.area(0.55, 0.08, 0.9, 0.2),
        text_block(params.date, cover.size(11), "muted"),
        cover.css("right"),
        False,
    )
    heading = (
        text_block(params.organisation, cover.size(11), "muted caps")
        + gap(cover.size(8))
        + cover.title_html(40, "plain-title")
        + gap(cover.size(8))
        + text_block(params.subtitle, cover.size(16), "muted")
    )
    cover.put_bottom(cover.area(0.1, 0.3, 0.9, 0.7), heading, cover.css("left"))
    people = text_block(params.author, cover.size(13), "strong") + text_block(
        params.details, cover.size(11), "muted"
    )
    cover.put_bottom(cover.area(0.1, 0.74, 0.9, 0.92), people, cover.css("left"))


def cropped_photo_bytes(path: Path, width: float, height: float) -> bytes:
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    ratio = width / height
    if image.width / image.height > ratio:
        crop_width = round(image.height * ratio)
        left = (image.width - crop_width) // 2
        image = image.crop((left, 0, left + crop_width, image.height))
    else:
        crop_height = round(image.width / ratio)
        top = (image.height - crop_height) // 2
        image = image.crop((0, top, image.width, top + crop_height))
    image.thumbnail((PHOTO_MAX_PIXELS, PHOTO_MAX_PIXELS))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=PHOTO_QUALITY)
    return buffer.getvalue()


def _photo(cover: Cover, photo: Path) -> None:
    params = cover.params
    picture = cover.area(0, 0, 1, PHOTO_SHARE)
    cover.page.insert_image(
        picture,
        stream=cropped_photo_bytes(photo, picture.width, picture.height),
        keep_proportion=False,
    )
    strip = pymupdf.Rect(picture.x0, picture.y1, picture.x1, picture.y1 + cover.size(6))
    cover.page.draw_rect(strip, color=None, fill=cover.accent)
    heading = (
        text_block(params.organisation, cover.size(11), "muted caps")
        + gap(cover.size(6))
        + cover.title_html(30)
        + gap(cover.size(6))
        + text_block(params.subtitle, cover.size(15), "muted")
    )
    cover.put(cover.area(0.1, PHOTO_SHARE + 0.05, 0.9, 0.84), heading, cover.css("left"), False)
    cover.put(cover.area(0.1, 0.82, 0.6, 0.94), cover.logo_html(), cover.css("left"), False)
    people = text_block(params.author, cover.size(12), "strong") + text_block(
        params.date, cover.size(11), "muted"
    )
    cover.put_bottom(cover.area(0.5, 0.84, 0.9, 0.94), people, cover.css("right"))


def draw_cover(page: pymupdf.Page, params: CoverParams, workdir: Path) -> None:
    logo = copy_picture(params.logo, LOGO_EXTENSIONS, "logo", workdir, "logo")
    archive = pymupdf.Archive(str(FONT_DIR))
    archive.add(str(workdir))
    cover = Cover(page, params, logo, archive)
    if params.style == "photo":
        photo = checked_picture(params.image, PHOTO_EXTENSIONS, "image")
        if photo is None:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "the photo cover needs a picture",
                {"reason": "noCoverImage"},
            )
        _photo(cover, photo)
        return
    {"classic": _classic, "band": _band, "frame": _frame, "minimal": _minimal}[params.style](cover)


@op("pages.cover", CoverParams)
def add_cover(params: CoverParams, progress: Progress) -> OutputResult:
    if not params.title.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "the cover needs a title", {"reason": "noTitle"})
    inputs = [params.path] + [path for path in (params.logo, params.image) if path]
    target = prepare_output(params.output, inputs, params.overwrite)
    with open_document(params.path, params.password) as document:
        first = document[0].rect
        with (
            pymupdf.open() as cover_document,
            tempfile.TemporaryDirectory(
                prefix="vivepdf-cover-", ignore_cleanup_errors=True
            ) as temp_dir,
        ):
            page = cover_document.new_page(width=first.width, height=first.height)
            progress.report(0.3, "progress.creatingPages", {"current": 1, "total": 1})
            draw_cover(page, params, Path(temp_dir))
            document.insert_pdf(cover_document, start_at=0)
        if params.replace_first and document.page_count > 1:
            document.delete_page(1)
        progress.report(0.8, "progress.saving")
        return save_document(document, target)
