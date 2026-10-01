import base64
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.editor_blocks import FontPlanParams, font_plan
from vivepdf.ops.fonts import FONT_DIR, FontFileParams, font_catalogue, font_file
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def blank_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=400, height=400)
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    return path


def _span_fonts(path: Path) -> list[tuple[str, str, bool]]:
    document = pymupdf.open(path)
    found = [
        (span["text"], span["font"], bool(span["flags"] & 16))
        for block in document[0].get_text("dict")["blocks"]
        if block.get("type") == 0
        for line in block["lines"]
        for span in line["spans"]
    ]
    document.close()
    return found


def _system_choice():
    return next((choice for choice in font_catalogue() if choice.source == "system"), None)


def _text_object(**extra) -> dict:
    return {
        "kind": "text",
        "page": 1,
        "x0": 40,
        "y0": 40,
        "x1": 300,
        "y1": 120,
        "text": "Merhaba dünya",
        "fontSize": 16,
        **extra,
    }


def test_text_without_a_font_choice_keeps_dejavu(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "default.pdf"
    apply(
        EditorApplyParams(path=str(blank_pdf), output=str(output), objects=[_text_object()]),
        silent_progress(),
    )
    fonts = {font for _text, font, _bold in _span_fonts(output)}
    assert fonts
    assert all("DejaVu" in font for font in fonts)


def test_text_is_written_in_the_chosen_catalogue_font(blank_pdf: Path, tmp_path: Path):
    choice = _system_choice()
    if choice is None:
        pytest.skip("no system fonts on this machine")
    output = tmp_path / "chosen.pdf"
    result = apply(
        EditorApplyParams(
            path=str(blank_pdf), output=str(output), objects=[_text_object(fontId=choice.id)]
        ),
        silent_progress(),
    )
    fonts = {font for _text, font, _bold in _span_fonts(output)}
    assert fonts
    assert not any("DejaVu" in font for font in fonts)
    assert result.applied == 1


def test_an_unknown_font_id_falls_back_to_the_bundled_font(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "unknown.pdf"
    apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[_text_object(fontId="system:no-such-family-anywhere")],
        ),
        silent_progress(),
    )
    fonts = {font for _text, font, _bold in _span_fonts(output)}
    assert fonts
    assert all("DejaVu" in font for font in fonts)


def test_missing_glyphs_of_the_chosen_font_are_reported(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "missing.pdf"
    result = apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[_text_object(id="t1", text="abc 中文", fontId="bundled:dejavu-sans")],
        ),
        silent_progress(),
    )
    codes = {(warning.object_id, warning.code) for warning in result.warnings}
    assert ("t1", "glyphsMissing") in codes


def test_text_runs_keep_their_own_styles(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "runs.pdf"
    runs = [
        {"text": "Kalin ", "size": 14, "color": "#111111", "bold": True},
        {"text": "normal", "size": 14, "color": "#cc0000", "bold": False},
    ]
    apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[_text_object(text="Kalin normal", runs=runs)],
        ),
        silent_progress(),
    )
    spans = _span_fonts(output)
    bold_words = {text.strip() for text, _font, bold in spans if bold}
    plain_words = {text.strip() for text, _font, bold in spans if not bold}
    assert "Kalin" in bold_words
    assert "normal" in plain_words


def test_blank_runs_fall_back_to_the_plain_text(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "blank-runs.pdf"
    apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[_text_object(text="Tek", runs=[{"text": "   ", "size": 12}])],
        ),
        silent_progress(),
    )
    assert any(text.strip() == "Tek" for text, _font, _bold in _span_fonts(output))


def test_new_text_too_long_for_its_box_is_reported_instead_of_vanishing_quietly(
    blank_pdf: Path, tmp_path: Path
):
    output = tmp_path / "overflow.pdf"
    text = "Bu cümle o daracık kutuya hiçbir boyutta sığmayacak kadar uzun"

    result = apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[_text_object(x1=48, y1=46, text=text)],
        ),
        silent_progress(),
    )

    assert [(warning.code, warning.detail) for warning in result.warnings] == [
        ("textOverflow", text[:40])
    ]


def test_new_text_that_fits_after_shrinking_gives_no_overflow_warning(
    blank_pdf: Path, tmp_path: Path
):
    output = tmp_path / "shrunk.pdf"

    result = apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[_text_object(x1=140, y1=60, fontSize=40)],
        ),
        silent_progress(),
    )

    assert "textOverflow" not in [warning.code for warning in result.warnings]
    assert "Merhaba" in pymupdf.open(output)[0].get_text()


@pytest.mark.parametrize("rotation", [0, 90])
def test_new_text_hanging_off_the_page_edge_is_fitted_onto_the_page(tmp_path: Path, rotation: int):
    source = tmp_path / "turned.pdf"
    document = pymupdf.open()
    document.new_page(width=400, height=300).set_rotation(rotation)
    document.save(source)
    document.close()
    output = tmp_path / "edge.pdf"
    with pymupdf.open(source) as opened:
        height = opened[0].rect.height
    text = "Kenara taşan not satırı"

    result = apply(
        EditorApplyParams(
            path=str(source),
            output=str(output),
            objects=[_text_object(x0=20, y0=height - 25, x1=140, y1=height + 60, text=text)],
        ),
        silent_progress(),
    )

    assert result.warnings == []
    with pymupdf.open(output) as edited:
        page = edited[0]
        spans = [
            span
            for block in page.get_text("dict")["blocks"]
            for line in block["lines"]
            for span in line["spans"]
        ]
        assert " ".join(" ".join(span["text"] for span in spans).split()) == text
        assert all(pymupdf.Rect(span["bbox"]) in page.mediabox for span in spans)


def test_new_text_placed_wholly_off_the_page_is_reported(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "off.pdf"

    result = apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[_text_object(x0=40, y0=420, x1=300, y1=480)],
        ),
        silent_progress(),
    )

    assert [warning.code for warning in result.warnings] == ["textOverflow"]


def test_font_file_returns_the_bundled_font_bytes():
    result = font_file(FontFileParams(id="bundled:dejavu-sans", bold=True), silent_progress())
    assert result.ext == "ttf"
    assert base64.b64decode(result.base64) == (FONT_DIR / "DejaVuSans-Bold.ttf").read_bytes()


def test_font_file_serves_an_installed_system_font():
    choice = _system_choice()
    if choice is None:
        pytest.skip("no system fonts on this machine")
    result = font_file(FontFileParams(id=choice.id), silent_progress())
    assert result.ext in {"ttf", "otf"}
    pymupdf.Font(fontbuffer=base64.b64decode(result.base64))


def test_font_file_refuses_a_path_that_is_not_an_installed_font(tmp_path: Path):
    fake = tmp_path / "secret.ttf"
    fake.write_bytes((FONT_DIR / "DejaVuSans.ttf").read_bytes())
    with pytest.raises(OpError) as caught:
        font_file(FontFileParams(id=f"file:{fake}"), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    with pytest.raises(OpError):
        font_file(FontFileParams(id=f"file:{tmp_path / 'notes.txt'}"), silent_progress())


def test_font_plan_offers_the_system_file_for_the_preview(tmp_path: Path):
    choice = next(
        (item for item in font_catalogue() if item.source == "system" and item.name == "Arial"),
        None,
    )
    if choice is None:
        pytest.skip("Arial is not installed on this machine")
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Arial", fontname="helv")
    source = tmp_path / "plan.pdf"
    document.save(source)
    document.close()
    plan = font_plan(
        FontPlanParams(path=str(source), page=0, font_family="Arial", text="Merhaba"),
        silent_progress(),
    )
    assert plan.source == "system"
    assert plan.font_id is not None and plan.font_id.startswith("file:")
    served = font_file(FontFileParams(id=plan.font_id), silent_progress())
    assert served.ext in {"ttf", "otf"}
