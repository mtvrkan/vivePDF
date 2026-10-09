import pymupdf

from vivepdf.ops._studio_models import StudioBox, StudioPlate, StudioPrintOptions
from vivepdf.ops._studio_vector import mirror, place

MARK_LENGTH = 14.0
MARK_GAP = 6.0
MARK_SLUG = 8.0
MARK_WIDTH = 0.25
DIE_WIDTH = 0.5
LABEL_SIZE = 6.0
KAPPA = 0.5523
DIE_CUT = "DieCut"
REGISTRATION = "All"

PLATE_NAMES: dict[StudioPlate, str] = {
    "emboss": "Emboss",
    "deboss": "Deboss",
    "letterpress": "Letterpress",
    "foil": "Foil",
    "spotUv": "SpotUV",
}
PLATE_TINTS: dict[str, tuple[float, float, float, float]] = {
    "Emboss": (0.0, 0.5, 1.0, 0.0),
    "Deboss": (0.5, 0.0, 1.0, 0.0),
    "Letterpress": (1.0, 0.5, 0.0, 0.0),
    "Foil": (0.0, 0.25, 0.75, 0.15),
    "SpotUV": (0.0, 1.0, 0.0, 0.0),
    DIE_CUT: (0.0, 1.0, 1.0, 0.0),
    REGISTRATION: (1.0, 1.0, 1.0, 1.0),
}


def _number(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in {"", "-0"} else text


def _stream(document: pymupdf.Document, body: str, content: str | bytes) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, body)
    document.update_stream(xref, content.encode("latin-1") if isinstance(content, str) else content)
    return xref


def _separation(name: str) -> str:
    tint = " ".join(_number(value) for value in PLATE_TINTS[name])
    return (
        f"[/Separation/{name}/DeviceCMYK<</FunctionType 2/Domain[0 1]/C0[0 0 0 0]/C1[{tint}]/N 1>>]"
    )


def sheet_margin(options: StudioPrintOptions) -> float:
    if not options.marks:
        return options.bleed
    return max(options.bleed, MARK_GAP) + MARK_LENGTH + MARK_SLUG


def _ocg(document: pymupdf.Document, name: str) -> int:
    for xref, info in document.get_ocgs().items():
        if info.get("name") == name:
            return xref
    return document.add_ocg(name, on=True)


def _paint(
    page: pymupdf.Page, content: str, colour: str | None, overprint: bool, oc: int = 0
) -> None:
    width, height = page.rect.width, page.rect.height
    resources = ["/ColorSpace<</P " + _separation(colour) + ">>"] if colour else []
    if overprint:
        resources.append("/ExtGState<</O<</Type/ExtGState/OP true/op true/OPM 1>>>>")
    prefix = ("/O gs\n" if overprint else "") + ("/P CS /P cs 1 SCN 1 scn\n" if colour else "")
    stamp = pymupdf.open()
    try:
        sheet = stamp.new_page(width=width, height=height)
        stream = _stream(stamp, "<<>>", "q\n" + prefix + content + "\nQ\n")
        stamp.xref_set_key(sheet.xref, "Contents", f"{stream} 0 R")
        stamp.xref_set_key(sheet.xref, "Resources", "<<" + "".join(resources) + ">>")
        page.show_pdf_page(page.rect, stamp, 0, overlay=True, oc=oc)
    finally:
        stamp.close()


def _crop_marks(trim: pymupdf.Rect, height: float, offset: float) -> str:
    n = _number
    lines: list[str] = []
    for x, sign_x in ((trim.x0, -1), (trim.x1, 1)):
        for y, sign_y in ((trim.y0, -1), (trim.y1, 1)):
            near_x, far_x = x + sign_x * offset, x + sign_x * (offset + MARK_LENGTH)
            near_y, far_y = y + sign_y * offset, y + sign_y * (offset + MARK_LENGTH)
            lines.append(f"{n(near_x)} {n(height - y)} m {n(far_x)} {n(height - y)} l")
            lines.append(f"{n(x)} {n(height - near_y)} m {n(x)} {n(height - far_y)} l")
    return f"{n(MARK_WIDTH)} w\n" + "\n".join(lines) + "\nS"


def _die_line(trim: pymupdf.Rect, height: float, radius: float) -> str:
    left, right = trim.x0, trim.x1
    top, bottom = height - trim.y0, height - trim.y1
    r = min(radius, trim.width / 2, trim.height / 2)
    k = r * (1 - KAPPA)
    n = _number
    return (
        f"{n(DIE_WIDTH)} w\n"
        f"{n(left + r)} {n(top)} m {n(right - r)} {n(top)} l\n"
        f"{n(right - k)} {n(top)} {n(right)} {n(top - k)} {n(right)} {n(top - r)} c\n"
        f"{n(right)} {n(bottom + r)} l\n"
        f"{n(right)} {n(bottom + k)} {n(right - k)} {n(bottom)} {n(right - r)} {n(bottom)} c\n"
        f"{n(left + r)} {n(bottom)} l\n"
        f"{n(left + k)} {n(bottom)} {n(left)} {n(bottom + k)} {n(left)} {n(bottom + r)} c\n"
        f"{n(left)} {n(top - r)} l\n"
        f"{n(left)} {n(top - k)} {n(left + k)} {n(top)} {n(left + r)} {n(top)} c\n"
        "h S"
    )


def plate_document(shape: pymupdf.Document, colour: str | None) -> pymupdf.Document:
    page = shape[0]
    width, height = page.rect.width, page.rect.height
    box = f"[0 0 {_number(width)} {_number(height)}]"
    kind, resources = shape.xref_get_key(page.xref, "Resources")
    if kind not in {"dict", "xref"}:
        resources = "<<>>"
    form = _stream(
        shape,
        f"<</Type/XObject/Subtype/Form/BBox{box}/Resources {resources}"
        "/Group<</Type/Group/S/Transparency>>>>",
        page.read_contents(),
    )
    state = f"/M<</Type/ExtGState/SMask<</Type/Mask/S/Alpha/G {form} 0 R>>"
    state += "/OP true/op true/OPM 1>>" if colour else ">>"
    space = f"/ColorSpace<</P {_separation(colour)}>>" if colour else ""
    paint = "/P cs 1 scn" if colour else "0 g"
    content = f"q\n/M gs\n{paint}\n0 0 {_number(width)} {_number(height)} re f\nQ\n"
    stream = _stream(shape, "<<>>", content)
    shape.xref_set_key(page.xref, "Contents", f"{stream} 0 R")
    shape.xref_set_key(page.xref, "Resources", f"<<{space}/ExtGState<<{state}>>>>")
    return shape


class PrintSheet:
    def __init__(
        self,
        document: pymupdf.Document,
        options: StudioPrintOptions,
        width: float,
        height: float,
        number: int,
    ) -> None:
        self.document = document
        self.options = options
        self.number = number
        self.area = sheet_margin(options)
        self.size = (width + 2 * self.area, height + 2 * self.area)
        self.trim = pymupdf.Rect(self.area, self.area, self.area + width, self.area + height)
        bleed = options.bleed
        self.bleed = pymupdf.Rect(
            self.trim.x0 - bleed, self.trim.y0 - bleed, self.trim.x1 + bleed, self.trim.y1 + bleed
        )
        self.page = self._sheet()
        self.plate_pages: dict[str, pymupdf.Page] = {}

    def _sheet(self, label: str = "") -> pymupdf.Page:
        page = self.document.new_page(width=self.size[0], height=self.size[1])
        page.set_bleedbox(self.bleed)
        page.set_trimbox(self.trim)
        if self.options.marks:
            offset = max(self.options.bleed, MARK_GAP)
            _paint(page, _crop_marks(self.trim, self.size[1], offset), REGISTRATION, False)
            if label:
                page.insert_text(
                    (self.trim.x0, self.size[1] - MARK_SLUG / 2),
                    label,
                    fontsize=LABEL_SIZE,
                    fontname="helv",
                )
        return page

    def add_art(self, art: pymupdf.Document) -> None:
        self.page.show_pdf_page(self.bleed, art, 0, keep_proportion=False, overlay=True)

    def _target(self, name: str) -> tuple[pymupdf.Page, str | None, int]:
        if self.options.plates == "spot":
            return self.page, name, _ocg(self.document, name)
        if name not in self.plate_pages:
            self.plate_pages[name] = self._sheet(f"{name} · {self.number}")
        return self.plate_pages[name], None, 0

    def add_plate(
        self,
        plate: StudioPlate,
        box: StudioBox,
        shape: pymupdf.Document,
        margin: float,
    ) -> None:
        page, colour, oc = self._target(PLATE_NAMES[plate])
        drawn = mirror(plate_document(shape, colour), box.flip_x, box.flip_y)
        moved = box.model_copy(update={"x": box.x + self.area, "y": box.y + self.area})
        place(page, drawn, moved, margin, oc)

    def add_die_cut(self) -> None:
        if self.options.corner <= 0:
            return
        page, colour, oc = self._target(DIE_CUT)
        line = _die_line(self.trim, self.size[1], self.options.corner)
        _paint(page, line, colour, colour is not None, oc)
