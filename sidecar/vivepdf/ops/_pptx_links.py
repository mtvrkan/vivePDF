from dataclasses import dataclass
from urllib.parse import quote

import pymupdf

from vivepdf.ops._markup import LINK_SAFE_CHARACTERS, LINK_SCHEMES

EMU_PER_POINT = 12700
SLIDE_JUMP = "ppaction://hlinksldjump"
CLEAR = "FFFFFF"


@dataclass(slots=True, eq=False)
class PageLink:
    area: pymupdf.Rect
    shown: pymupdf.Rect
    uri: str | None = None
    page: int | None = None


@dataclass(slots=True)
class SlideJumps:
    pending: list[tuple[object, int]]

    def add(self, holder, page: int) -> None:
        self.pending.append((holder, page))


def page_links(page: pymupdf.Page) -> list[PageLink]:
    links = []
    for link in page.get_links():
        shown = pymupdf.Rect(link["from"])
        if shown.is_empty:
            continue
        area = shown * page.derotation_matrix
        uri = (link.get("uri") or "").strip()
        target = link.get("page", -1)
        if link["kind"] == pymupdf.LINK_URI and uri.lower().startswith(LINK_SCHEMES):
            links.append(PageLink(area, shown, uri=quote(uri, safe=LINK_SAFE_CHARACTERS)))
        elif link["kind"] in (pymupdf.LINK_GOTO, pymupdf.LINK_NAMED) and target >= 0:
            links.append(PageLink(area, shown, page=target))
    return links


def link_at(links: list[PageLink], bbox) -> PageLink | None:
    rect = pymupdf.Rect(bbox)
    center = (rect.tl + rect.br) / 2
    return next((link for link in links if center in link.area), None)


def link_run(run, link: PageLink, jumps: SlideJumps) -> None:
    if link.uri:
        run.hyperlink.address = link.uri
    else:
        jumps.add(run, link.page)


def add_link_area(slide, link: PageLink, frame, jumps: SlideJumps) -> None:
    from lxml import etree
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.oxml.ns import qn
    from pptx.util import Emu

    shape = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Emu(round(frame.left + link.shown.x0 * frame.ratio)),
        Emu(round(frame.top + link.shown.y0 * frame.ratio)),
        Emu(max(1, round(link.shown.width * frame.ratio))),
        Emu(max(1, round(link.shown.height * frame.ratio))),
    )
    shape.name = "Link"
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(CLEAR)
    colour = shape.fill._xPr.find(qn("a:solidFill")).find(qn("a:srgbClr"))
    etree.SubElement(colour, qn("a:alpha")).set("val", "0")
    shape.line.fill.background()
    shape.shadow.inherit = False
    if link.uri:
        shape.click_action.hyperlink.address = link.uri
    else:
        jumps.add(shape, link.page)


def apply_jumps(jumps: SlideJumps, slides: dict[int, object]) -> None:
    from pptx.opc.constants import RELATIONSHIP_TYPE

    for holder, page in jumps.pending:
        target = slides.get(page)
        if target is None:
            continue
        if hasattr(holder, "click_action"):
            holder.click_action.target_slide = target
            continue
        relation = holder.part.relate_to(target.part, RELATIONSHIP_TYPE.SLIDE)
        click = holder._r.get_or_add_rPr().add_hlinkClick(relation)
        click.set("action", SLIDE_JUMP)
