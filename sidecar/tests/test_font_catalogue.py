import shutil
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import fonts
from vivepdf.ops._watermark_style import WatermarkParams, WatermarkPreviewParams
from vivepdf.ops.fonts import (
    FontAddParams,
    FontRemoveParams,
    add_font,
    font_catalogue,
    imported_font_dir,
    remove_font,
    resolve_choice,
    uncovered_glyphs,
)
from vivepdf.ops.security_watermark import watermark, watermark_preview
from vivepdf.ops.stamp import StampParams, stamp
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

TURKISH = "GİZLİ ŞİRKET ÇĞÜÖ"


@pytest.fixture
def blank_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=595, height=842).insert_text((60, 80), "govde", fontsize=11)
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    return path


def _fonts_in(path: Path) -> set[str]:
    reader = pymupdf.open(path)
    names = {
        span["font"]
        for block in reader[0].get_text("dict")["blocks"]
        if block.get("type") == 0
        for line in block["lines"]
        for span in line["spans"]
    }
    reader.close()
    return names


def _a_system_font(styles: str | None = None):
    for choice in font_catalogue():
        if choice.source != "system":
            continue
        if styles and styles not in choice.styles:
            continue
        return choice
    return None


def test_the_catalogue_always_offers_the_bundled_font():
    ids = [choice.id for choice in font_catalogue()]
    assert "bundled:dejavu-sans" in ids


def test_every_catalogue_entry_resolves_to_a_readable_file():
    for choice in font_catalogue()[:40]:
        path = resolve_choice(choice.id, False)
        assert path.is_file()
        pymupdf.Font(fontfile=str(path))


def test_an_unknown_font_id_falls_back_to_the_bundled_font():
    assert resolve_choice("system:there-is-no-such-family", False).name == "DejaVuSans.ttf"
    assert resolve_choice("nonsense", True).name == "DejaVuSans-Bold.ttf"
    assert resolve_choice(None, False).name == "DejaVuSans.ttf"


def test_a_chosen_family_is_the_one_embedded_in_the_watermark(blank_pdf: Path, tmp_path: Path):
    choice = _a_system_font("Regular")
    assert choice is not None
    target = tmp_path / "marked.pdf"
    watermark(
        WatermarkParams(path=str(blank_pdf), output=str(target), text="ONAY", font_id=choice.id),
        silent_progress(),
    )
    embedded = _fonts_in(target)
    assert embedded - {"Helvetica"}
    assert "DejaVuSans" not in embedded


def test_bold_picks_the_bold_face_of_the_same_family(blank_pdf: Path, tmp_path: Path):
    choice = next((item for item in font_catalogue() if item.name == "Arial"), None)
    if choice is None:
        pytest.skip("Arial is not installed on this machine")
    regular = tmp_path / "regular.pdf"
    bold = tmp_path / "bold.pdf"
    watermark(
        WatermarkParams(path=str(blank_pdf), output=str(regular), text="ONAY", font_id=choice.id),
        silent_progress(),
    )
    watermark(
        WatermarkParams(
            path=str(blank_pdf), output=str(bold), text="ONAY", font_id=choice.id, bold=True
        ),
        silent_progress(),
    )
    assert _fonts_in(regular) != _fonts_in(bold)


def test_the_preview_names_the_characters_the_font_cannot_draw(blank_pdf: Path):
    choice = next((item for item in font_catalogue() if item.name == "Wingdings"), None)
    if choice is None:
        pytest.skip("Wingdings is not installed on this machine")
    preview = watermark_preview(
        WatermarkPreviewParams(path=str(blank_pdf), text=TURKISH, font_id=choice.id),
        silent_progress(),
    )
    assert preview.missing_glyphs
    safe = watermark_preview(
        WatermarkPreviewParams(path=str(blank_pdf), text=TURKISH), silent_progress()
    )
    assert safe.missing_glyphs == ""


def test_the_stamp_uses_the_chosen_family_too(blank_pdf: Path, tmp_path: Path):
    choice = _a_system_font("Regular")
    assert choice is not None
    target = tmp_path / "stamped.pdf"
    stamp(
        StampParams(path=str(blank_pdf), output=str(target), text="ONAY", font_id=choice.id),
        silent_progress(),
    )
    assert "DejaVuSans-Bold" not in _fonts_in(target)


def test_a_font_file_can_be_added_and_removed(tmp_path: Path):
    source = Path(r"C:\Windows\Fonts\georgia.ttf")
    if not source.is_file():
        pytest.skip("no font file to import on this machine")
    copy = tmp_path / "My Custom Font!.ttf"
    shutil.copy(source, copy)

    choice = add_font(FontAddParams(path=str(copy)), silent_progress())
    try:
        assert choice.source == "imported"
        assert choice.id.startswith("imported:")
        assert resolve_choice(choice.id, False).parent == imported_font_dir()
        assert any(item.id == choice.id for item in font_catalogue())
    finally:
        assert remove_font(FontRemoveParams(id=choice.id), silent_progress()).removed
    assert not any(item.id == choice.id for item in font_catalogue())


def test_only_real_font_files_are_accepted(tmp_path: Path):
    wrong_kind = tmp_path / "picture.png"
    wrong_kind.write_bytes(b"\x89PNG")
    with pytest.raises(OpError) as caught:
        add_font(FontAddParams(path=str(wrong_kind)), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS

    not_a_font = tmp_path / "fake.ttf"
    not_a_font.write_bytes(b"this is not a font")
    with pytest.raises(OpError):
        add_font(FontAddParams(path=str(not_a_font)), silent_progress())

    with pytest.raises(OpError):
        add_font(FontAddParams(path=str(tmp_path / "missing.ttf")), silent_progress())


def test_a_system_font_cannot_be_deleted():
    with pytest.raises(OpError) as caught:
        remove_font(FontRemoveParams(id="system:arial"), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_glyph_coverage_reads_the_real_font(tmp_path: Path):
    assert uncovered_glyphs(resolve_choice(None, False), TURKISH) == ""


def test_imported_faces_group_into_one_family_with_a_working_bold(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = tmp_path / "fonts"
    store.mkdir()
    monkeypatch.setattr(fonts, "imported_font_dir", lambda: store)
    bundled = fonts.FONT_DIR
    for name in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf"):
        (store / name).write_bytes((bundled / name).read_bytes())
    imported = [choice for choice in fonts.font_catalogue() if choice.source == "imported"]
    assert len(imported) == 1
    assert sorted(imported[0].styles) == ["Bold", "Regular"]
    regular = fonts.resolve_choice(imported[0].id, False)
    bold = fonts.resolve_choice(imported[0].id, True)
    assert regular != bold
    assert "Bold" in bold.name
    fonts.remove_font(fonts.FontRemoveParams(id=imported[0].id), silent_progress())
    assert fonts.imported_fonts() == {}
