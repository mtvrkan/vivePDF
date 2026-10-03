import contextlib
import html
import io
import re
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Literal

import pymupdf
from PIL import Image, ImageDraw
from pydantic import Field

from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._page_html import checked_picture, colour_rgb
from vivepdf.ops._story import FONT_DIR
from vivepdf.ops.cover import PHOTO_EXTENSIONS, cropped_photo_bytes
from vivepdf.ops.create import COLOUR, DEFAULT_ACCENT, FAMILIES, POINTS_PER_MM, FontChoice
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

CvTemplate = Literal["classic", "modern", "compact"]
ShortText = Annotated[str, Field(max_length=200)]
MAX_CV_PAGES = 20
PHOTO_PIXELS = 600
BULLET = re.compile(r"^\s*(?:[-*•–]|\d+[.)])\s+")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
WEB = re.compile(r"^(?:https?://)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:/\S*)?$", re.IGNORECASE)
MARGINS_MM: dict[CvTemplate, float] = {"classic": 18, "modern": 14, "compact": 13}
SIDEBAR_SHARE = 0.33


class CvEntry(RpcModel):
    title: str = Field(default="", max_length=200)
    organisation: str = Field(default="", max_length=200)
    location: str = Field(default="", max_length=120)
    period: str = Field(default="", max_length=80)
    details: str = Field(default="", max_length=4000)


class CvSection(RpcModel):
    heading: str = Field(default="", max_length=100)
    body: str = Field(default="", max_length=6000)


class CvLabels(RpcModel):
    summary: str = Field(default="Profile", max_length=60)
    experience: str = Field(default="Experience", max_length=60)
    education: str = Field(default="Education", max_length=60)
    skills: str = Field(default="Skills", max_length=60)
    languages: str = Field(default="Languages", max_length=60)
    contact: str = Field(default="Contact", max_length=60)


class CreateCvParams(RpcModel):
    template: CvTemplate = "classic"
    name: str = Field(default="", max_length=120)
    headline: str = Field(default="", max_length=200)
    contacts: list[ShortText] = Field(default_factory=list, max_length=8)
    photo: str | None = None
    summary: str = Field(default="", max_length=3000)
    experience: list[CvEntry] = Field(default_factory=list, max_length=30)
    education: list[CvEntry] = Field(default_factory=list, max_length=20)
    skills: list[ShortText] = Field(default_factory=list, max_length=60)
    languages: list[ShortText] = Field(default_factory=list, max_length=20)
    sections: list[CvSection] = Field(default_factory=list, max_length=10)
    labels: CvLabels = Field(default_factory=CvLabels)
    accent: str = DEFAULT_ACCENT
    font: FontChoice = "sans"
    paper: Literal["a4", "letter"] = "a4"
    output: str
    overwrite: bool = False


def _escape(value: str) -> str:
    return html.escape(value.strip())


def _filled(values: list[str]) -> list[str]:
    return [value.strip() for value in values if value.strip()]


def _text_html(text: str) -> str:
    lines = [line for line in text.strip().splitlines() if line.strip()]
    if not lines:
        return ""
    if len(lines) > 1 or BULLET.match(lines[0]):
        items = "".join(f"<li>{_escape(BULLET.sub('', line))}</li>" for line in lines)
        return f"<ul>{items}</ul>"
    return f"<p>{_escape(lines[0])}</p>"


def _paragraphs(text: str) -> str:
    blocks = [block for block in re.split(r"\n\s*\n", text.strip()) if block.strip()]
    return "".join(
        f"<p>{'<br/>'.join(_escape(line) for line in block.splitlines())}</p>" for block in blocks
    )


def _entry_filled(entry: CvEntry) -> bool:
    return any(
        value.strip()
        for value in (entry.title, entry.organisation, entry.location, entry.period, entry.details)
    )


def _entry_html(entry: CvEntry) -> str:
    title = f'<span class="role">{_escape(entry.title)}</span>' if entry.title.strip() else ""
    organisation = _escape(entry.organisation)
    heading = " · ".join(part for part in (title, organisation) if part)
    period = _escape(entry.period)
    head = (
        f'<table class="entry-head"><tr><td class="what">{heading}</td>'
        f'<td class="period">{period}</td></tr></table>'
    )
    location = (
        f'<p class="location">{_escape(entry.location)}</p>' if entry.location.strip() else ""
    )
    return f'<div class="entry">{head}{location}{_text_html(entry.details)}</div>'


def _inline_list(values: list[str]) -> str:
    shown = _filled(values)
    return f'<p class="inline">{" · ".join(_escape(value) for value in shown)}</p>' if shown else ""


def _stacked_list(values: list[str]) -> str:
    shown = _filled(values)
    return "".join(f'<p class="item">{_escape(value)}</p>' for value in shown)


def _main_blocks(params: CreateCvParams, include_lists: bool) -> list[tuple[str, list[str]]]:
    labels = params.labels
    blocks: list[tuple[str, list[str]]] = []
    if params.summary.strip():
        blocks.append((labels.summary, [_paragraphs(params.summary)]))
    for label, entries in (
        (labels.experience, params.experience),
        (labels.education, params.education),
    ):
        shown = [_entry_html(entry) for entry in entries if _entry_filled(entry)]
        if shown:
            blocks.append((label, shown))
    if include_lists:
        for label, values in ((labels.skills, params.skills), (labels.languages, params.languages)):
            if _filled(values):
                blocks.append((label, [_inline_list(values)]))
    for section in params.sections:
        if section.heading.strip() and section.body.strip():
            blocks.append((section.heading, [_text_html(section.body)]))
    return blocks


def _identity(params: CreateCvParams, contacts: bool) -> str:
    parts = [f'<h1 class="name">{_escape(params.name)}</h1>']
    if params.headline.strip():
        parts.append(f'<p class="headline">{_escape(params.headline)}</p>')
    shown = _filled(params.contacts)
    if contacts and shown:
        items = " · ".join(f'<span class="contact">{_escape(value)}</span>' for value in shown)
        parts.append(f'<p class="contacts">{items}</p>')
    return "".join(parts)


def _photo_html(photo: str | None, css_class: str) -> str:
    return f'<img class="{css_class}" src="{photo}"/>' if photo else ""


def _classic_html(params: CreateCvParams, photo: str | None) -> str:
    identity = _identity(params, contacts=True)
    if photo:
        head = (
            f'<table class="top"><tr><td class="identity">{identity}</td>'
            f'<td class="photo-cell">{_photo_html(photo, "photo")}</td></tr></table>'
        )
    else:
        head = f'<div class="top">{identity}</div>'
    body = "".join(
        f"<h2>{_escape(label)}</h2>{''.join(items)}"
        for label, items in _main_blocks(params, include_lists=True)
    )
    return head + body


def _compact_html(params: CreateCvParams, photo: str | None) -> str:
    identity = _identity(params, contacts=True)
    if photo:
        picture = _photo_html(photo, "photo")
        head = (
            f'<table class="top"><tr><td class="photo-cell" width="14%">{picture}</td>'
            f'<td width="86%">{identity}</td></tr></table>'
        )
    else:
        head = f'<div class="top">{identity}</div>'
    rows: list[str] = []
    for label, items in _main_blocks(params, include_lists=True):
        for index, item in enumerate(items):
            heading = _escape(label) if index == 0 else ""
            rows.append(
                f'<tr><td class="label" width="21%">{heading}</td><td width="79%">{item}</td></tr>'
            )
    return head + f'<table class="grid">{"".join(rows)}</table>'


def _modern_side_html(params: CreateCvParams, photo: str | None) -> str:
    labels = params.labels
    parts = [f'<div class="photo-box">{_photo_html(photo, "photo")}</div>'] if photo else []
    for label, values in (
        (labels.contact, params.contacts),
        (labels.skills, params.skills),
        (labels.languages, params.languages),
    ):
        if _filled(values):
            parts.append(f"<h3>{_escape(label)}</h3>{_stacked_list(values)}")
    return "".join(parts)


def _modern_main_html(params: CreateCvParams) -> str:
    body = "".join(
        f"<h2>{_escape(label)}</h2>{''.join(items)}"
        for label, items in _main_blocks(params, include_lists=False)
    )
    return f'<div class="top">{_identity(params, contacts=False)}</div>{body}'


def _base_css(params: CreateCvParams, size: float, accent: str) -> list[str]:
    return [
        f"body{{font-family:{FAMILIES[params.font]};font-size:{size}pt;line-height:1.4;"
        "color:#1f2328;}",
        f"p{{margin:0 0 {size * 0.4:.1f}pt 0;}}",
        f"ul{{margin:{size * 0.2:.1f}pt 0 {size * 0.3:.1f}pt 0;padding-left:{size * 1.1:.1f}pt;}}",
        "li{margin:0 0 1.5pt 0;}",
        "table{border-collapse:collapse;width:100%;}",
        "td{border:none;padding:0;vertical-align:top;}",
        f".name{{font-size:{size * 2.3:.1f}pt;margin:0;line-height:1.15;color:{accent};}}",
        f".headline{{font-size:{size * 1.2:.1f}pt;color:#444c56;margin:2pt 0 4pt 0;}}",
        f".contacts{{color:#57606a;font-size:{size * 0.92:.1f}pt;}}",
        ".contact{white-space:nowrap;}",
        f".entry{{margin:0 0 {size * 0.7:.1f}pt 0;}}",
        ".role{font-weight:bold;}",
        ".what{width:72%;}",
        f".period{{text-align:right;color:#57606a;width:28%;font-size:{size * 0.92:.1f}pt;}}",
        ".period{white-space:nowrap;}",
        f".location{{color:#57606a;font-size:{size * 0.92:.1f}pt;margin:0;}}",
        ".inline{margin:0 0 4pt 0;}",
    ]


def _classic_css(params: CreateCvParams, size: float, accent: str) -> str:
    return "".join(
        _base_css(params, size, accent)
        + [
            f".top{{margin-bottom:{size:.1f}pt;}}",
            ".identity{width:82%;}",
            ".photo-cell{width:18%;text-align:right;}",
            ".photo{width:76pt;height:76pt;}",
            f"h2{{font-size:{size * 1.05:.1f}pt;color:{accent};text-transform:uppercase;"
            f"letter-spacing:1pt;border-bottom:0.8pt solid {accent};padding-bottom:2pt;"
            f"margin:{size * 1.1:.1f}pt 0 {size * 0.5:.1f}pt 0;}}",
        ]
    )


def _compact_css(params: CreateCvParams, size: float, accent: str) -> str:
    return "".join(
        _base_css(params, size, accent)
        + [
            f".top{{margin-bottom:{size * 0.8:.1f}pt;padding-bottom:4pt;"
            f"border-bottom:1.2pt solid {accent};}}",
            ".photo-cell{padding-right:10pt;}",
            ".photo{width:56pt;height:56pt;}",
            f".name{{font-size:{size * 2:.1f}pt;}}",
            ".grid td{padding:4pt 0 0 0;}",
            f".grid .label{{color:{accent};font-weight:bold;text-transform:uppercase;"
            f"font-size:{size * 0.85:.1f}pt;letter-spacing:0.6pt;padding-right:8pt;}}",
        ]
    )


def _modern_css(params: CreateCvParams, size: float, accent: str) -> tuple[str, str]:
    main = "".join(
        _base_css(params, size, accent)
        + [
            f".top{{margin-bottom:{size * 1.2:.1f}pt;}}",
            f"h2{{font-size:{size * 1.15:.1f}pt;color:{accent};"
            f"margin:{size * 1.1:.1f}pt 0 {size * 0.5:.1f}pt 0;}}",
        ]
    )
    side = "".join(
        [
            f"body{{font-family:{FAMILIES[params.font]};font-size:{size * 0.95:.1f}pt;"
            "line-height:1.4;color:#ffffff;}",
            ".photo-box{text-align:center;margin-bottom:10pt;}",
            ".photo{width:110pt;height:110pt;}",
            f"h3{{font-size:{size * 0.9:.1f}pt;text-transform:uppercase;letter-spacing:1pt;"
            f"margin:{size * 1.1:.1f}pt 0 4pt 0;color:#ffffff;}}",
            ".item{margin:0 0 3pt 0;color:#ffffff;}",
        ]
    )
    return main, side


def _prepared_photo(path: Path, workdir: Path, round_mask: bool) -> str:
    payload = cropped_photo_bytes(path, PHOTO_PIXELS, PHOTO_PIXELS)
    if not round_mask:
        (workdir / "photo.jpg").write_bytes(payload)
        return "photo.jpg"
    with Image.open(io.BytesIO(payload)) as opened:
        picture = opened.convert("RGBA").resize((PHOTO_PIXELS, PHOTO_PIXELS))
    mask = Image.new("L", picture.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, *picture.size), fill=255)
    picture.putalpha(mask)
    picture.save(workdir / "photo.png", "PNG")
    return "photo.png"


def _write(
    mediabox: pymupdf.Rect,
    flows: list[tuple[pymupdf.Story, pymupdf.Rect]],
    check_cancelled: Callable[[], None],
) -> bytes:
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    pending = [True] * len(flows)
    pages = 0
    while any(pending):
        check_cancelled()
        if pages >= MAX_CV_PAGES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"the CV would have more than {MAX_CV_PAGES} pages",
                {"reason": "tooManyPages", "limit": MAX_CV_PAGES},
            )
        device = writer.begin_page(mediabox)
        for index, (story, rect) in enumerate(flows):
            if pending[index]:
                more, _ = story.place(rect)
                story.draw(device)
                pending[index] = bool(more)
        writer.end_page()
        pages += 1
    writer.close()
    return buffer.getvalue()


def _link_contacts(document: pymupdf.Document, contacts: list[str]) -> None:
    for value in _filled(contacts):
        if EMAIL.match(value):
            uri = f"mailto:{value}"
        elif WEB.match(value) and "." in value:
            uri = value if value.lower().startswith(("http://", "https://")) else f"https://{value}"
        else:
            continue
        for page in document:
            for rect in page.search_for(value):
                page.insert_link({"kind": pymupdf.LINK_URI, "from": rect, "uri": uri})


def build_cv(params: CreateCvParams, check_cancelled: Callable[[], None]) -> pymupdf.Document:
    accent = params.accent if COLOUR.match(params.accent) else DEFAULT_ACCENT
    size = {"classic": 10.5, "modern": 10.0, "compact": 9.5}[params.template]
    mediabox = pymupdf.paper_rect(params.paper)
    margin = MARGINS_MM[params.template] * POINTS_PER_MM
    picture = checked_picture(params.photo, PHOTO_EXTENSIONS, "photo")
    with tempfile.TemporaryDirectory(prefix="vivepdf-cv-", ignore_cleanup_errors=True) as temp:
        workdir = Path(temp)
        photo = _prepared_photo(picture, workdir, params.template == "modern") if picture else None
        archive = pymupdf.Archive(str(FONT_DIR))
        archive.add(str(workdir))
        if params.template == "modern":
            band = mediabox.width * SIDEBAR_SHARE
            main_css, side_css = _modern_css(params, size, accent)
            flows = [
                (
                    pymupdf.Story(_modern_side_html(params, photo), side_css, archive=archive),
                    pymupdf.Rect(margin, margin, band - margin * 0.8, mediabox.height - margin),
                ),
                (
                    pymupdf.Story(_modern_main_html(params), main_css, archive=archive),
                    pymupdf.Rect(
                        band + margin, margin, mediabox.width - margin, mediabox.height - margin
                    ),
                ),
            ]
        else:
            css_builder = _classic_css if params.template == "classic" else _compact_css
            builder = _classic_html if params.template == "classic" else _compact_html
            story = pymupdf.Story(
                builder(params, photo), css_builder(params, size, accent), archive=archive
            )
            flows = [(story, mediabox + (margin, margin, -margin, -margin))]
        payload = _write(mediabox, flows, check_cancelled)
    document = pymupdf.open("pdf", payload)
    if params.template == "modern":
        fill = colour_rgb(accent, DEFAULT_ACCENT)
        for page in document:
            band_rect = pymupdf.Rect(0, 0, page.rect.width * SIDEBAR_SHARE, page.rect.height)
            page.draw_rect(band_rect, color=None, fill=fill, overlay=False)
    _link_contacts(document, params.contacts)
    return document


@op("create.cv", CreateCvParams)
def create_cv(params: CreateCvParams, progress: Progress) -> OutputResult:
    if not params.name.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "the CV needs a name", {"reason": "noName"})
    target = prepare_output(params.output, [params.photo] if params.photo else [], params.overwrite)
    progress.report(0.2, "progress.converting")
    with build_cv(params, progress.check_cancelled) as document:
        progress.report(0.8, "progress.saving")
        metadata = dict(document.metadata or {})
        metadata.update(
            {
                "title": params.name.strip(),
                "subject": params.headline.strip(),
                "author": params.name.strip(),
                "creator": "vivePDF",
            }
        )
        document.set_metadata(metadata)
        with contextlib.suppress(Exception):
            document.subset_fonts(fallback=False)
        return save_document(document, target)
