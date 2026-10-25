from pathlib import Path

import pymupdf
import pytest
from lxml import etree

from vivepdf.external import libreoffice
from vivepdf.ops._svg import MAX_SVG_BYTES, drawing_pdf, sanitized_svg
from vivepdf.ops.convert_to_pdf import FileToPdfParams, SvgToPdfParams, file_to_pdf, svg_to_pdf
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

BUNDLED_SOFFICE = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "desktop"
    / "src-tauri"
    / "resources"
    / "libreoffice"
    / "program"
    / "soffice.exe"
)

STYLED = (Path(__file__).parent / "fixtures" / "svg" / "styled.svg").read_text(encoding="utf-8")


def _svg(tmp_path: Path, name: str = "drawing.svg", text: str = STYLED) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def _clean(tmp_path: Path, text: str = STYLED) -> etree._Element:
    return etree.parse(str(sanitized_svg(_svg(tmp_path, text=text), tmp_path / "clean"))).getroot()


def test_the_clean_copy_keeps_the_drawing_but_no_outside_references(tmp_path: Path):
    root = _clean(tmp_path)
    serialized = etree.tostring(root, encoding="unicode")
    assert "example.com/theme.css" not in serialized
    assert "paint.svg" not in serialized and "example.com/x" not in serialized
    assert "win.ini" not in serialized and "track.png" not in serialized
    assert "<script" not in serialized and "foreignObject" not in serialized
    assert "steal()" not in serialized
    assert "data:image/png;base64" in serialized
    assert 'href="#star"' in serialized and "url(#g)" in serialized
    assert 'href="https://example.com/"' in serialized
    assert "Merhaba şğü" in serialized
    assert root.nsmap[None] == "http://www.w3.org/2000/svg"
    assert "inkscape:label" in serialized


@pytest.mark.parametrize(
    ("text", "reason"),
    [
        (
            '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
            "svgDoctype",
        ),
        ("<html><body/></html>", "notSvg"),
        ("<svg xmlns='http://www.w3.org/2000/svg'><rect></svg>", "notSvg"),
    ],
)
def test_unsafe_or_foreign_files_are_refused(tmp_path: Path, text: str, reason: str):
    with pytest.raises(OpError) as caught:
        sanitized_svg(_svg(tmp_path, text=text), tmp_path / "clean")
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data["reason"] == reason


def test_an_oversized_drawing_is_refused(tmp_path: Path):
    path = tmp_path / "huge.svg"
    with path.open("wb") as handle:
        handle.truncate(MAX_SVG_BYTES + 1)
    with pytest.raises(OpError) as caught:
        sanitized_svg(path, tmp_path / "clean")
    assert caught.value.data == {"reason": "svgTooLarge", "limitMb": 50}


def test_libreoffice_receives_only_the_clean_copy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    received: list[str] = []

    def fake_convert(source: Path, output_dir: Path, _infilter, _check) -> Path:
        received.append(source.read_text(encoding="utf-8"))
        output_dir.mkdir(parents=True, exist_ok=True)
        produced = output_dir / f"{source.stem}.pdf"
        document = pymupdf.open()
        document.new_page(width=300, height=225)
        document.save(produced)
        return produced

    monkeypatch.setattr(libreoffice, "find_soffice", lambda: tmp_path / "soffice.exe")
    monkeypatch.setattr(libreoffice, "convert_to_pdf", fake_convert)
    result = file_to_pdf(
        FileToPdfParams(path=str(_svg(tmp_path)), output=str(tmp_path / "out.pdf")),
        silent_progress(),
    )
    assert result.page_count == 1
    assert len(received) == 1 and "win.ini" not in received[0] and "<script" not in received[0]


def test_without_libreoffice_the_drawing_still_converts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(libreoffice, "find_soffice", lambda: None)
    result = file_to_pdf(
        FileToPdfParams(path=str(_svg(tmp_path)), output=str(tmp_path / "out.pdf")),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert document.page_count == 1
        assert round(document[0].rect.width) == 400


def test_several_drawings_become_one_pdf_in_order(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(libreoffice, "find_soffice", lambda: None)
    first = _svg(
        tmp_path, "a.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"/>'
    )
    second = _svg(
        tmp_path, "b.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"/>'
    )
    result = svg_to_pdf(
        SvgToPdfParams(paths=[str(second), str(first)], output=str(tmp_path / "both.pdf")),
        silent_progress(),
    )
    assert result.page_count == 2
    with pymupdf.open(result.output) as document:
        assert [round(page.rect.width) for page in document] == [200, 100]


def test_combining_refuses_files_that_are_not_drawings(tmp_path: Path):
    other = tmp_path / "notes.txt"
    other.write_text("x", encoding="utf-8")
    with pytest.raises(OpError) as caught:
        svg_to_pdf(
            SvgToPdfParams(paths=[str(other)], output=str(tmp_path / "x.pdf")), silent_progress()
        )
    assert caught.value.data == {"reason": "notSvg"}
    with pytest.raises(OpError) as caught:
        svg_to_pdf(
            SvgToPdfParams(paths=[str(tmp_path / "gone.svg")], output=str(tmp_path / "x.pdf")),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND


@pytest.mark.skipif(not BUNDLED_SOFFICE.is_file(), reason="bundled LibreOffice not present")
def test_the_bundled_libreoffice_keeps_styles_and_real_size(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(libreoffice, "find_soffice", lambda: BUNDLED_SOFFICE)
    result = file_to_pdf(
        FileToPdfParams(path=str(_svg(tmp_path)), output=str(tmp_path / "styled.pdf")),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        page = document[0]
        assert (round(page.rect.width), round(page.rect.height)) == (300, 225)
        assert "Merhaba şğü" in page.get_text()
        scale = 96 / 72
        pixmap = page.get_pixmap(dpi=96)
        red = pixmap.pixel(int(100 * 0.75 * scale), int(70 * 0.75 * scale))
        assert red[0] > 200 and red[1] < 100 and red[2] < 100


def _centre(markup: str) -> tuple[int, ...]:
    with drawing_pdf(markup.encode("utf-8"), "drawing") as document:
        return document[0].get_pixmap().pixel(50, 50)


def test_stylesheet_rules_are_applied_when_drawing():
    markup = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        "<style>/* theme */ @media print { rect { fill: #000 } } rect { fill: #00f }"
        " .box { fill: #e63946 }</style>"
        '<rect class="box" width="100" height="100"/></svg>'
    )
    assert _centre(markup) == (230, 57, 70)


def test_inline_style_wins_over_the_stylesheet():
    markup = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        "<style>#tile { fill: #e63946 }</style>"
        '<rect id="tile" style="fill: #00ff00" width="100" height="100"/></svg>'
    )
    assert _centre(markup) == (0, 255, 0)


def test_unsupported_selectors_and_broken_sheets_are_ignored():
    markup = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        "<style>g > rect { fill: #000 } rect:hover { fill: #000 } /* open"
        '</style><rect fill="#00ff00" width="100" height="100"/></svg>'
    )
    assert _centre(markup) == (0, 255, 0)


ILLUSTRATOR_DOCTYPE = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"\n'
    '  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n'
)


def test_a_standard_svg_doctype_is_dropped_and_the_drawing_converts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(libreoffice, "find_soffice", lambda: None)
    source = _svg(tmp_path, text=ILLUSTRATOR_DOCTYPE + STYLED.split("?>", 1)[-1])

    result = file_to_pdf(
        FileToPdfParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
    )

    assert result.page_count == 1
    assert b"DOCTYPE" not in sanitized_svg(source, tmp_path / "clean").read_bytes()


@pytest.mark.parametrize(
    "text",
    [
        ILLUSTRATOR_DOCTYPE + '<!ENTITY x "y"><svg xmlns="http://www.w3.org/2000/svg"/>',
        '<!DOCTYPE html PUBLIC "a" "b"><svg xmlns="http://www.w3.org/2000/svg"/>',
        '<!DOCTYPE svg PUBLIC "a" "b" [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
)
def test_entities_and_other_document_types_are_still_refused(tmp_path: Path, text: str):
    with pytest.raises(OpError) as caught:
        sanitized_svg(_svg(tmp_path, text=text), tmp_path / "clean")

    assert caught.value.data["reason"] == "svgDoctype"


SPRITE = (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    ' width="200" height="100" viewBox="0 0 200 100">'
    '<defs><symbol id="kare" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>'
    '<rect id="duz" width="5" height="5" fill="lime"/></defs>'
    '<use xlink:href="#kare" x="10" y="10" width="80" height="80" fill="red"/>'
    '<use href="#kare" x="110" y="10" width="40" height="80" fill="blue"/>'
    '<use href="#duz" x="170" y="80"/>'
    "</svg>"
)


def _boxes(document: pymupdf.Document) -> list[tuple[tuple[int, ...], tuple[float, ...]]]:
    return [
        (tuple(round(value) for value in drawing["rect"]), drawing["fill"])
        for drawing in document[0].get_drawings()
    ]


def test_a_symbol_is_scaled_into_the_box_its_use_asks_for():
    document = drawing_pdf(SPRITE.encode(), "sprite.svg")

    assert _boxes(document) == [
        ((10, 10, 90, 90), (1.0, 0.0, 0.0)),
        ((110, 30, 150, 70), (0.0, 0.0, 1.0)),
        ((170, 80, 175, 85), (0.0, 1.0, 0.0)),
    ]


def test_a_symbol_that_uses_itself_stops_expanding(tmp_path: Path):
    text = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
        '<symbol id="d" viewBox="0 0 10 10"><rect width="1" height="1"/>'
        + '<use href="#d"/>' * 4
        + '</symbol><use href="#d" width="10" height="10"/></svg>'
    )

    root = _clean(tmp_path, text)

    assert sum(1 for _ in root.iter()) < 300_000
