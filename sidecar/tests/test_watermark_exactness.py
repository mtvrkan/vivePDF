import math
from collections import Counter
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._watermark_style import WatermarkParams
from vivepdf.ops.fonts import family_key
from vivepdf.ops.security_watermark import watermark
from vivepdf.ops.watermark_detection import DetectWatermarkParams, detect_watermark
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
BODY = "Bu satır kalmalı ve hiç değişmemeli"


@pytest.fixture
def rotated_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for rotation in (0, 90, 180, 270):
        page = document.new_page(width=595, height=842)
        page.insert_text((60, 300), BODY, fontsize=12, fontname="dv", fontfile=str(FONT))
        page.set_rotation(rotation)
    path = tmp_path / "döndürülmüş sayfalar.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def logo(tmp_path: Path) -> Path:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 40), 0)
    pixmap.clear_with(80)
    path = tmp_path / "logo.png"
    pixmap.save(path)
    return path


def _words(path: Path) -> list[Counter]:
    with pymupdf.open(path) as document:
        return [Counter(word[4] for word in page.get_text("words")) for page in document]


def test_the_watermark_is_marked_as_a_watermark_and_comes_off_exactly(
    tmp_path: Path, rotated_pdf: Path
) -> None:
    marked = tmp_path / "marked.pdf"
    watermark(
        WatermarkParams(path=str(rotated_pdf), output=str(marked), text="TASLAK", position="tile"),
        silent_progress(),
    )
    with pymupdf.open(marked) as document:
        for page in document:
            assert b"/Subtype/Watermark" in page.read_contents()
    found = detect_watermark(DetectWatermarkParams(path=str(marked)), silent_progress())
    assert any(candidate.kind == "artifact" for candidate in found.candidates)
    cleaned = tmp_path / "cleaned.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(marked),
            output=str(cleaned),
            artifacts=True,
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_marks > 0
    assert result.removed_text == 0
    assert _words(cleaned) == _words(rotated_pdf)


@pytest.mark.parametrize("position", ["top-left", "bottom-right", "top-center", "middle-left"])
def test_a_rotated_mark_in_a_corner_stays_on_the_page(
    tmp_path: Path, rotated_pdf: Path, position: str
) -> None:
    marked = tmp_path / "corner.pdf"
    watermark(
        WatermarkParams(
            path=str(rotated_pdf),
            output=str(marked),
            text="TASLAK ÇİZİM",
            position=position,
            rotation=30,
            font_size=60,
        ),
        silent_progress(),
    )
    with pymupdf.open(marked) as document:
        for page in document:
            assert "TASLAK ÇİZİM" in page.get_text()
            for hit in page.search_for("TASLAK"):
                assert page.cropbox.contains(hit)


@pytest.mark.parametrize("kind", ["image", "pdf"])
@pytest.mark.parametrize("rotation", [45, -90, 30])
def test_a_picture_mark_takes_any_angle_on_any_page_rotation(
    tmp_path: Path, rotated_pdf: Path, logo: Path, kind: str, rotation: int
) -> None:
    template = tmp_path / "template.pdf"
    with pymupdf.open() as source:
        source.new_page(width=300, height=100).insert_text((20, 60), "ARROW", fontsize=40)
        source.save(template)
    marked = tmp_path / f"{kind}.pdf"
    extra = {"image_path": str(logo)} if kind == "image" else {"template_path": str(template)}
    watermark(
        WatermarkParams(
            path=str(rotated_pdf), output=str(marked), kind=kind, rotation=rotation, **extra
        ),
        silent_progress(),
    )
    with pymupdf.open(marked) as document:
        for page in document:
            infos = page.get_image_info()
            assert infos
            matrix = pymupdf.Matrix(infos[0]["transform"]) * page.rotation_matrix
            angle = math.degrees(math.atan2(-matrix.b, matrix.a))
            assert (angle - rotation + 180) % 360 - 180 == pytest.approx(0, abs=1)


def test_burning_the_mark_in_leaves_only_a_picture(tmp_path: Path, rotated_pdf: Path) -> None:
    burned = tmp_path / "burned.pdf"
    watermark(
        WatermarkParams(
            path=str(rotated_pdf), output=str(burned), text="GİZLİ", flatten=True, pages="1-2"
        ),
        silent_progress(),
    )
    with pymupdf.open(burned) as document, pymupdf.open(rotated_pdf) as original:
        for index in (0, 1):
            page = document[index]
            assert page.get_text().strip() == ""
            assert len(page.get_images()) == 1
            assert page.rotation == original[index].rotation
            assert page.rect == original[index].rect
        assert BODY.split()[0] in document[2].get_text()
        assert "GİZLİ" not in document[2].get_text()


def test_burn_in_resolution_is_bounded(tmp_path: Path, rotated_pdf: Path) -> None:
    with pytest.raises(ValueError):
        WatermarkParams(
            path=str(rotated_pdf), output=str(tmp_path / "x.pdf"), text="X", flatten_dpi=20
        )


def test_an_untagged_tiled_watermark_leaves_the_body_as_it_was(tmp_path: Path) -> None:
    plain = pymupdf.open()
    for _ in range(3):
        page = plain.new_page(width=595, height=842)
        page.insert_text((60, 120), BODY, fontsize=14, fontname="dv", fontfile=str(FONT))
    plain_path = tmp_path / "plain.pdf"
    plain.save(plain_path)
    for page in plain:
        y = 0.0
        while y < page.rect.height + 200:
            x = -100.0
            while x < page.rect.width + 200:
                page.insert_text(
                    (x, y),
                    "GİZLİ BELGE",
                    fontsize=28,
                    fontname="dv",
                    fontfile=str(FONT),
                    color=(0.6, 0.6, 0.6),
                    morph=(pymupdf.Point(x, y), pymupdf.Matrix(45)),
                )
                x += 220
            y += 220
    marked = tmp_path / "tiled.pdf"
    plain.save(marked)
    plain.close()
    cleaned = tmp_path / "cleaned.pdf"
    remove_watermark(
        RemoveWatermarkParams(
            path=str(marked),
            output=str(cleaned),
            texts=["GİZLİ BELGE"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert _words(cleaned) == _words(plain_path)


def test_a_postscript_font_name_finds_its_system_family() -> None:
    assert family_key("TimesNewRomanPS-BoldMT") == family_key("Times New Roman Bold")
    assert family_key("ArialMT") == "arial"


def test_empty_watermark_text_is_refused(tmp_path: Path, rotated_pdf: Path) -> None:
    with pytest.raises(OpError):
        watermark(
            WatermarkParams(path=str(rotated_pdf), output=str(tmp_path / "x.pdf"), text="  "),
            silent_progress(),
        )


def _ink(page: pymupdf.Page) -> int:
    pixmap = page.get_pixmap(dpi=40, alpha=False)
    return sum(1 for value in pixmap.samples[::3] if value < 250)


@pytest.mark.parametrize(("visibility", "shown"), [("print", False), ("screen", True)])
def test_a_mark_can_be_limited_to_print_or_screen(
    tmp_path: Path, rotated_pdf: Path, visibility: str, shown: bool
) -> None:
    marked = tmp_path / f"{visibility}.pdf"
    watermark(
        WatermarkParams(
            path=str(rotated_pdf),
            output=str(marked),
            text="KOPYA",
            opacity=1,
            font_size=120,
            visibility=visibility,
        ),
        silent_progress(),
    )
    with pymupdf.open(marked) as document, pymupdf.open(rotated_pdf) as original:
        layers = document.get_ocgs()
        assert len(layers) == 1
        layer = next(iter(layers))
        usage = document.xref_get_key(layer, "Usage")[1]
        assert ("/PrintState/ON" in usage) == (visibility == "print")
        assert ("/ViewState/ON" in usage) == shown
        catalog = document.pdf_catalog()
        assert "/Event/Print" in document.xref_get_key(catalog, "OCProperties/D/AS")[1]
        assert (_ink(document[0]) > _ink(original[0])) == shown
    cleaned = tmp_path / f"{visibility}-clean.pdf"
    remove_watermark(
        RemoveWatermarkParams(
            path=str(marked),
            output=str(cleaned),
            artifacts=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert _words(cleaned) == _words(rotated_pdf)
