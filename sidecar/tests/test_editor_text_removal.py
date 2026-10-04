from collections.abc import Callable
from pathlib import Path

import numpy as np
import pymupdf
import pytest

from vivepdf.ops._redaction import clip_to_own_text
from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.editor_blocks import BlocksParams, TextBlock, blocks
from vivepdf.rpc.progress import silent_progress

PARAGRAPH = "BT /F1 11 Tf 1 0 0 1 40 120 Tm (The paragraph below stays.) Tj ET\n"
HEADING = "BT /FHB 36 Tf 1 0 0 1 40 220 Tm (Arduino) Tj ET"
SIDE_NOTES = (
    "BT /F1 9 Tf 1 0 0 1 150 270 Tm (Side note line one) Tj 0 -12 Td (Side note line two) Tj"
    " 0 -12 Td (line three) Tj 0 -12 Td (line four) Tj 0 -12 Td (line five) Tj"
    " 0 -12 Td (line six) Tj ET"
)
TO_UNICODE = (
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap"
    " /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def"
    " /CMapName /Adobe-Identity-UCS def /CMapType 2 def"
    " 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <41> <0041> <72> <0072>"
    " endbfchar endcmap CMapName currentdict /CMap defineresource pop end end"
)
MAX_CHANGED_PIXELS = 12


class Page:
    def __init__(self, crop: pymupdf.Rect | None = None, rotation: int = 0) -> None:
        self.document = pymupdf.open()
        self.page = self.document.new_page(width=400, height=300)
        self.crop = crop
        self.rotation = rotation
        regular = self._object(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
        )
        bold = self._object(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
        )
        self.fonts = {"F1": regular, "FHB": bold}
        self.xobjects: dict[str, int] = {}
        self.properties: dict[str, int] = {}

    def _object(self, body: str) -> int:
        xref = self.document.get_new_xref()
        self.document.update_object(xref, body)
        return xref

    def stream(self, data: str | bytes, body: str = "<<>>") -> int:
        xref = self._object(body)
        self.document.update_stream(xref, data.encode("latin-1") if isinstance(data, str) else data)
        return xref

    def form(self, data: str, resources: str) -> int:
        return self.stream(
            data,
            f"<< /Type /XObject /Subtype /Form /BBox [0 0 400 300] /Resources {resources} >>",
        )

    def image(self, width: int, height: int, fill: tuple[int, int, int]) -> int:
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, width, height), False)
        pixmap.set_rect(pixmap.irect, fill)
        for x in range(0, width, 7):
            for y in range(height // 4, height - height // 4):
                pixmap.set_pixel(x, y, (40, 40, 40))
        return self.page.insert_image(pymupdf.Rect(0, 0, 10, 10), stream=pixmap.tobytes("png"))

    def save(self, path: Path, content: str) -> Path:
        entries = [
            "/Font << "
            + " ".join(f"/{name} {xref} 0 R" for name, xref in self.fonts.items())
            + " >>"
        ]
        if self.xobjects:
            entries.append(
                "/XObject << "
                + " ".join(f"/{name} {xref} 0 R" for name, xref in self.xobjects.items())
                + " >>"
            )
        if self.properties:
            entries.append(
                "/Properties << "
                + " ".join(f"/{name} {xref} 0 R" for name, xref in self.properties.items())
                + " >>"
            )
        self.document.xref_set_key(self.page.xref, "Resources", "<< " + " ".join(entries) + " >>")
        contents = self.stream(PARAGRAPH + content)
        self.document.xref_set_key(self.page.xref, "Contents", f"{contents} 0 R")
        if self.crop is not None:
            self.page.set_cropbox(self.crop)
        if self.rotation:
            self.page.set_rotation(self.rotation)
        self.document.save(path)
        self.document.close()
        return path


Build = Callable[[Page, bool], str]


def _plain(heading: str, rest: str = "") -> Build:
    def build(_page: Page, with_heading: bool) -> str:
        return (heading if with_heading else "") + "\n" + rest + "\n"

    return build


def _form(page: Page, with_heading: bool) -> str:
    body = f"q 0.1 0.3 0.7 rg {HEADING} Q" if with_heading else ""
    page.xobjects["Fm1"] = page.form(
        body + " 0.5 g 300 20 40 40 re f", f"<< /Font << /FHB {page.fonts['FHB']} 0 R >> >>"
    )
    return "q /Fm1 Do Q\n"


def _nested_form(page: Page, with_heading: bool) -> str:
    inner = page.form(
        HEADING if with_heading else "", f"<< /Font << /FHB {page.fonts['FHB']} 0 R >> >>"
    )
    page.xobjects["Fm1"] = page.form("q /In Do Q", f"<< /XObject << /In {inner} 0 R >> >>")
    return "q /Fm1 Do Q\n"


def _type3(height: int) -> Build:
    def build(page: Page, with_heading: bool) -> str:
        glyph_a = page.stream(
            f"700 0 d0 0 0 m 350 {height} l 700 0 l 560 0 l 350 {height - 200} l 140 0 l f"
        )
        glyph_r = page.stream(
            f"450 0 d0 0 0 m 0 {height - 200} l 420 {height - 200} l 420 {height - 330} l"
            f" 130 {height - 330} l 130 0 l f"
        )
        to_unicode = page.stream(TO_UNICODE)
        widths = " ".join(
            "700" if code == 65 else ("450" if code == 114 else "0") for code in range(65, 115)
        )
        page.fonts["T3"] = page._object(
            "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 0 0] /FontMatrix [0.001 0 0 0.001 0 0]"
            f" /CharProcs << /A {glyph_a} 0 R /r {glyph_r} 0 R >>"
            " /Encoding << /Type /Encoding /Differences [65 /A 114 /r] >>"
            f" /FirstChar 65 /LastChar 114 /Widths [{widths}] /Resources << >>"
            f" /ToUnicode {to_unicode} 0 R >>"
        )
        if not with_heading:
            return ""
        return "q 0.8 0.1 0.1 rg BT /T3 40 Tf 1 0 0 1 40 220 Tm (ArArArA) Tj ET Q\n"

    return build


def _optional_content(page: Page, with_heading: bool) -> str:
    page.properties["OC1"] = page.document.add_ocg("Titles", on=True)
    return f"/OC /OC1 BDC q {HEADING} Q EMC\n" if with_heading else ""


def _effect_image(box: tuple[float, float, float, float], fill: tuple[int, int, int]) -> Build:
    def build(page: Page, with_heading: bool) -> str:
        page.xobjects["Fx"] = page.image(276, 92, fill)
        x, y, width, height = box
        if not with_heading:
            return ""
        return f"q {width} 0 0 {height} {x} {y} cm /Fx Do Q q {HEADING} Q\n"

    return build


CASES: dict[str, Build] = {
    "plain": _plain(f"q 0.8 0.1 0.1 rg {HEADING} Q"),
    "fakeBoldOffset": _plain(
        f"q 0 0 0.6 rg {HEADING} BT /FHB 36 Tf 1 0 0 1 40.8 220 Tm (Arduino) Tj ET Q"
    ),
    "fillAndStroke": _plain(
        "q 0 0 0.6 rg 0 0 0.6 RG 2.5 w BT 2 Tr /FHB 36 Tf 1 0 0 1 40 220 Tm (Arduino) Tj ET Q"
    ),
    "kernedPerGlyph": _plain(
        "q BT /FHB 36 Tf 1 0 0 1 40 220 Tm"
        " [(A) -30 (r) 20 (d) -10 (u) 5 (i) -40 (n) 10 (o)] TJ ET Q"
    ),
    "glyphPerTextObject": _plain(
        "q "
        + " ".join(
            f"BT /FHB 36 Tf 1 0 0 1 {x} 220 Tm ({char}) Tj ET"
            for char, x in zip("Arduino", (40, 66, 80, 102, 124, 134, 156), strict=True)
        )
        + " Q"
    ),
    "horizontalScale": _plain("q BT /FHB 30 Tf 140 Tz 1 0 0 1 40 220 Tm (Arduino) Tj ET Q"),
    "rotatedMatrix": _plain(
        "q BT /FHB 30 Tf 0.9962 0.0872 -0.0872 0.9962 40 220 Tm (Arduino) Tj ET Q"
    ),
    "scaledMatrix": _plain("q 2 0 0 2 0 0 cm BT /FHB 18 Tf 1 0 0 1 20 110 Tm (Arduino) Tj ET Q"),
    "textRise": _plain("q BT /FHB 36 Tf 1 0 0 1 40 220 Tm 6 Ts (Arduino) Tj ET Q"),
    "shadowCopy": _plain(
        f"q 0.7 g BT /FHB 36 Tf 1 0 0 1 42 218 Tm (Arduino) Tj ET 0 g {HEADING} Q"
    ),
    "markedContent": _plain(f"/Span <</MCID 0>> BDC q {HEADING} Q EMC"),
    "clippingText": _plain(
        "q BT 7 Tr /FHB 36 Tf 1 0 0 1 40 220 Tm (Arduino) Tj ET 0.1 0.4 0.8 rg 30 200 300 60 re f Q"
    ),
    "invisibleCopy": _plain(
        f"q BT 3 Tr /FHB 36 Tf 1 0 0 1 40 220 Tm (Arduino) Tj ET Q q {HEADING} Q"
    ),
    "formXObject": _form,
    "nestedFormXObject": _nested_form,
    "type3": _type3(750),
    "type3TallerThanEm": _type3(1500),
    "optionalContent": _optional_content,
    "shadowImage": _effect_image((43, 206, 138, 46), (230, 230, 230)),
    "glowImage": _effect_image((30, 200, 160, 66), (240, 240, 200)),
}


def _pair(tmp_path: Path, name: str, build: Build, **page_options) -> tuple[Path, Path]:
    source = Page(**page_options)
    original = source.save(tmp_path / f"{name}.pdf", build(source, True))
    control = Page(**page_options)
    expected = control.save(tmp_path / f"{name}-control.pdf", build(control, False))
    return original, expected


def _heading(path: Path) -> TextBlock:
    found = blocks(BlocksParams(path=str(path), page=0), silent_progress())
    return next(
        block
        for block in found.blocks
        if block.kind == "text" and ("Arduino" in block.text or "ArAr" in block.text)
    )


def _apply_block(source: Path, block: TextBlock, output: Path, text: str = "") -> None:
    x0, y0, x1, y1 = block.bbox
    width = max(x1 - x0, 12)
    height = max(y1 - y0, block.size * block.line_height)
    apply(
        EditorApplyParams(
            path=str(source),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": x0,
                    "y0": y0,
                    "x1": x0 + width,
                    "y1": y0 + height,
                    "text": text,
                    "fontSize": block.size,
                    "color": block.color,
                    "bold": block.bold,
                    "font": block.font,
                    "original": [x0, y0, x0 + width, y0 + height],
                }
            ],
        ),
        silent_progress(),
    )


def _pixels(path: Path) -> np.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(dpi=96, annots=False, colorspace=pymupdf.csRGB)
    return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)


def _changed_pixels(first: Path, second: Path) -> int:
    difference = np.abs(_pixels(first).astype(int) - _pixels(second).astype(int)).max(axis=2)
    return int((difference > 48).sum())


def _text(path: Path) -> str:
    with pymupdf.open(path) as document:
        return document[0].get_text()


@pytest.mark.parametrize("name", list(CASES))
def test_deleted_heading_leaves_nothing_behind(tmp_path: Path, name: str):
    original, expected = _pair(tmp_path, name, CASES[name])
    output = tmp_path / f"{name}-out.pdf"
    _apply_block(original, _heading(original), output)
    assert _changed_pixels(output, expected) <= MAX_CHANGED_PIXELS
    assert "The paragraph below stays." in _text(output)


@pytest.mark.parametrize("name", ["plain", "shadowCopy", "formXObject", "shadowImage"])
def test_replaced_heading_hides_the_original(tmp_path: Path, name: str):
    original, _expected = _pair(tmp_path, name, CASES[name])
    output = tmp_path / f"{name}-out.pdf"
    _apply_block(original, _heading(original), output, "Pico")
    text = _text(output)
    assert "Pico" in text
    assert "Arduino" not in text
    assert "The paragraph below stays." in text
    with pymupdf.open(output) as document:
        assert not [info for info in document[0].get_image_info() if info["bbox"][1] < 100]


def test_heading_overlapped_by_another_block_is_still_removed(tmp_path: Path):
    original, _expected = _pair(tmp_path, "overlap", _plain(f"q {HEADING} Q", SIDE_NOTES))
    output = tmp_path / "overlap-out.pdf"
    _apply_block(original, _heading(original), output)
    text = _text(output)
    assert "Arduino" not in text
    assert "Side note line one" in text
    assert "Side note line two" in text
    assert "line six" in text


def test_background_and_neighbouring_images_survive(tmp_path: Path):
    def build(page: Page, with_heading: bool) -> str:
        page.xobjects["Bg"] = page.image(400, 300, (200, 220, 255))
        page.xobjects["Icon"] = page.image(40, 40, (250, 120, 0))
        icon = "q 30 0 0 30 4 212 cm /Icon Do Q\n"
        return "q 400 0 0 300 0 0 cm /Bg Do Q\n" + icon + (f"{HEADING}\n" if with_heading else "")

    original, expected = _pair(tmp_path, "images", build)
    output = tmp_path / "images-out.pdf"
    _apply_block(original, _heading(original), output)
    assert _changed_pixels(output, expected) <= MAX_CHANGED_PIXELS
    with pymupdf.open(output) as document:
        assert len(document[0].get_image_info()) == 2


@pytest.mark.parametrize(
    ("crop", "rotation"),
    [
        (pymupdf.Rect(20, 10, 390, 290), 0),
        (None, 90),
        (pymupdf.Rect(20, 10, 390, 290), 90),
    ],
)
def test_turned_or_cropped_heading_is_removed_with_its_effects(
    tmp_path: Path, crop: pymupdf.Rect | None, rotation: int
):
    build = _effect_image((43, 206, 138, 46), (230, 230, 230))
    original, expected = _pair(tmp_path, "turned", build, crop=crop, rotation=rotation)
    output = tmp_path / "turned-out.pdf"
    _apply_block(original, _heading(original), output)
    assert "Arduino" not in _text(output)
    assert "The paragraph below stays." in _text(output)
    assert _changed_pixels(output, expected) <= MAX_CHANGED_PIXELS


def test_turned_page_keeps_text_beside_the_heading(tmp_path: Path):
    stacked = "BT /F1 9 Tf 1 0 0 1 50 150 Tm (ab) Tj 0 -12 Td (cd) Tj 0 -12 Td (ef) Tj ET"
    original, _expected = _pair(tmp_path, "beside", _plain(f"q {HEADING} Q", stacked), rotation=90)
    output = tmp_path / "beside-out.pdf"
    _apply_block(original, _heading(original), output)
    text = _text(output)
    assert "Arduino" not in text
    assert all(word in text for word in ("ab", "cd", "ef"))


def test_clipping_keeps_the_largest_free_side():
    heading = pymupdf.Rect(40, 41.5, 178, 91)

    beside = clip_to_own_text(heading, [pymupdf.Rect(150, 22, 240, 92)])
    below = clip_to_own_text(heading, [pymupdf.Rect(30, 85, 300, 120)])
    covering = clip_to_own_text(heading, [pymupdf.Rect(0, 0, 400, 300)])

    assert beside == pymupdf.Rect(40, 41.5, 149, 91)
    assert below == pymupdf.Rect(40, 41.5, 178, 84)
    assert covering == heading
