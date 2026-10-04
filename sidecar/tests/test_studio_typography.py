from pathlib import Path

import numpy as np
import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops import fonts
from vivepdf.ops._studio_models import StudioRenderParams, StudioTextItem
from vivepdf.ops._studio_text import (
    TextFaces,
    case_texts,
    layout,
    list_markers,
    text_paragraphs,
)
from vivepdf.ops.fonts import (
    FONT_DIR,
    FontFileParams,
    ImportedFace,
    family_weights,
    font_file,
    nearest_weight,
    resolve_face,
    weight_family,
    weight_of_name,
)
from vivepdf.ops.studio import render
from vivepdf.rpc.progress import silent_progress

REGULAR = FONT_DIR / "DejaVuSans.ttf"
BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"
ARABIC = "مرحبا بالعالم"


def _render(folder: Path, items: list[dict], **extra) -> Path:
    payload = {
        "pages": [{"width": 300, "height": 300, "items": items}],
        "output": str(folder / "design.pdf"),
        "overwrite": True,
    }
    payload.update(extra)
    return Path(render(StudioRenderParams.model_validate(payload), silent_progress()).output)


def _text(runs: list[dict], **extra) -> dict:
    item = {
        "kind": "text",
        "x": 20,
        "y": 20,
        "width": 260,
        "height": 200,
        "runs": runs,
        "fontSize": 20,
    }
    item.update(extra)
    return item


def _item(runs: list[dict], **extra) -> StudioTextItem:
    return StudioTextItem.model_validate(_text(runs, **extra))


def _pixels(path: Path) -> np.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(alpha=False)
        return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)


def _spans(path: Path) -> list[dict]:
    with pymupdf.open(path) as document:
        return [
            span
            for block in document[0].get_text("dict")["blocks"]
            if block.get("type") == 0
            for line in block["lines"]
            for span in line["spans"]
        ]


def _words(path: Path) -> list[tuple]:
    with pymupdf.open(path) as document:
        return document[0].get_text("words")


def _colour_mask(pixels: np.ndarray, colour: tuple[int, int, int]) -> np.ndarray:
    return (np.abs(pixels.astype(int) - np.array(colour)).sum(axis=2)) < 90


def _red(pixels: np.ndarray) -> np.ndarray:
    return (pixels[..., 0] > 200) & (pixels[..., 1] < 160) & (pixels[..., 2] < 160)


def test_list_markers_number_restart_and_nest():
    paragraphs = [
        ("decimal", 0),
        ("decimal", 0),
        ("alpha", 1),
        ("alpha", 1),
        ("decimal", 0),
        ("roman", 1),
        ("none", 0),
        ("decimal", 0),
        ("bullet", 0),
        ("dash", 0),
        ("check", 0),
    ]
    assert list_markers(paragraphs) == [
        "1.",
        "2.",
        "a)",
        "b)",
        "3.",
        "i.",
        None,
        "1.",
        "•",
        "–",
        "✓",
    ]
    assert list_markers([("roman", 0)] * 4)[-1] == "iv."
    assert list_markers([("alpha", 0)] * 27)[-1] == "aa)"


def test_case_transforms_follow_the_language():
    assert case_texts(["istanbul ılık"], "upper", "tr") == ["İSTANBUL ILIK"]
    assert case_texts(["İSTANBUL IŞIK"], "lower", "tr") == ["istanbul ışık"]
    assert case_texts(["istanbul ve izmir"], "title", "tr") == ["İstanbul Ve İzmir"]
    assert case_texts(["istanbul"], "title", "en") == ["Istanbul"]
    assert case_texts(["he", "llo wor", "ld's day"], "title", "en") == ["He", "llo Wor", "ld's Day"]
    assert case_texts(["Mixed"], "none", "tr") == ["Mixed"]


def test_paragraphs_split_runs_fill_values_and_drop_the_last_empty_line():
    item = _item(
        [{"text": "{items}\nsecond\n"}],
        paragraphs=[{"list": "bullet"}, {"list": "decimal"}, {"list": "decimal"}],
    )
    paragraphs = text_paragraphs(item, {"items": "one\ntwo"}, "en")
    assert [(p.kind, p.marker, [text for text, _ in p.pieces]) for p in paragraphs] == [
        ("bullet", "•", ["one"]),
        ("bullet", "•", ["two"]),
        ("decimal", "1.", ["second"]),
    ]


def test_strikethrough_crosses_the_words_in_both_layouts(tmp_path: Path):
    plain = _pixels(_render(tmp_path, [_text([{"text": "H   H", "color": "#ff0000"}])]))
    struck = _pixels(
        _render(tmp_path, [_text([{"text": "H   H", "color": "#ff0000", "strike": True}])])
    )
    gap = (slice(20, 60), slice(40, 55))
    assert not _red(plain)[gap].any()
    assert _red(struck)[gap].any()
    rows = np.where(_red(struck)[:, 45])[0]
    assert 25 < rows.mean() < 38
    segments = [
        {"text": "H", "x": 0, "y": 20, "size": 20, "strike": True, "color": "#ff0000"},
        {"text": "H", "x": 30, "y": 20, "size": 20, "strike": True, "color": "#ff0000"},
    ]
    measured = _pixels(_render(tmp_path, [_text([{"text": "H   H"}], segments=segments)]))
    assert _red(measured)[25:40, 36:50].any()


def test_runs_keep_their_own_font_size_and_weight_on_one_baseline(tmp_path: Path):
    path = _render(
        tmp_path,
        [
            _text(
                [
                    {"text": "Big "},
                    {"text": "small ", "size": 10},
                    {"text": "Heavy", "weight": 700, "fontId": "bundled:dejavu-sans"},
                ],
                fontSize=30,
                width=280,
            )
        ],
    )
    spans = {span["text"].strip(): span for span in _spans(path)}
    assert round(spans["Big"]["size"]) == 30
    assert round(spans["small"]["size"]) == 10
    assert "Bold" in spans["Heavy"]["font"]
    assert abs(spans["Big"]["origin"][1] - spans["small"]["origin"][1]) < 0.01


def test_a_bigger_run_makes_its_line_taller():
    faces = TextFaces()
    even = layout(_item([{"text": "one\ntwo\nthree"}]), faces, {}, "en").placed
    tall = layout(
        _item([{"text": "one\n"}, {"text": "two", "size": 40}, {"text": "\nthree"}]),
        faces,
        {},
        "en",
    ).placed
    gap_even = even[2].baseline - even[0].baseline
    gap_tall = tall[2].baseline - tall[0].baseline
    assert gap_tall > gap_even + 15


def test_lists_draw_markers_with_a_hanging_indent(tmp_path: Path):
    long = "alpha beta gamma delta epsilon zeta eta theta iota kappa"
    path = _render(
        tmp_path,
        [
            _text(
                [{"text": f"{long}\nnext\nnested\nplain"}],
                paragraphs=[
                    {"list": "decimal"},
                    {"list": "decimal"},
                    {"list": "bullet", "level": 1},
                    {"list": "none"},
                ],
            )
        ],
    )
    words = _words(path)
    text = [word[4] for word in words]
    assert text[:2] == ["1.", "alpha"]
    assert "2." in text and "•" in text
    alpha = next(word for word in words if word[4] == "alpha")
    marker = next(word for word in words if word[4] == "1.")
    assert alpha[0] - marker[0] == pytest.approx(1.6 * 20, abs=0.5)
    wrapped = [word for word in words if word[1] > alpha[1] + 5 and word[4] not in ("2.",)]
    assert wrapped[0][0] == pytest.approx(alpha[0], abs=0.5)
    bullet = next(word for word in words if word[4] == "•")
    nested = next(word for word in words if word[4] == "nested")
    assert bullet[0] == pytest.approx(alpha[0], abs=0.5)
    assert nested[0] == pytest.approx(alpha[0] + 1.6 * 20, abs=0.5)
    plain = next(word for word in words if word[4] == "plain")
    assert plain[0] == pytest.approx(20, abs=0.5)


def test_text_case_is_applied_to_the_exported_text(tmp_path: Path):
    path = _render(
        tmp_path,
        [_text([{"text": "istanbul "}, {"text": "ve izmir"}], textCase="title")],
        language="tr",
    )
    assert [word[4] for word in _words(path)] == ["İstanbul", "Ve", "İzmir"]
    lower = _render(tmp_path, [_text([{"text": "İSTANBUL"}], textCase="lower", language="tr")])
    assert [word[4] for word in _words(lower)] == ["istanbul"]


def test_legacy_uppercase_flag_still_works(tmp_path: Path):
    path = _render(tmp_path, [_text([{"text": "izmir"}], uppercase=True)], language="tr")
    assert [word[4] for word in _words(path)] == ["İZMİR"]


def test_outline_strokes_around_the_fill(tmp_path: Path):
    item = _text(
        [{"text": "I", "color": "#ff0000"}],
        fontSize=120,
        outline={"color": "#0000ff", "width": 3},
    )
    path = _render(tmp_path, [item])
    pixels = _pixels(path)
    assert _colour_mask(pixels, (0, 0, 255)).sum() > 100
    assert _colour_mask(pixels, (255, 0, 0)).sum() > 100
    with pymupdf.open(path) as document:
        content = document[0].read_contents()
    assert b"1 Tr" in content
    assert b"6.0000 w" in content


def test_shadow_is_drawn_at_its_offset(tmp_path: Path):
    item = _text(
        [{"text": "I", "color": "#000000"}],
        fontSize=120,
        shadow={"color": "#00ff00", "x": 30, "y": 0, "opacity": 1},
    )
    pixels = _pixels(_render(tmp_path, [item]))
    green = np.where(_colour_mask(pixels, (0, 255, 0)))
    black = np.where(pixels.max(axis=2) < 60)
    assert green[1].min() == pytest.approx(black[1].min() + 30, abs=2)


def test_highlight_bands_sit_behind_each_line(tmp_path: Path):
    item = _text(
        [{"text": "one\ntwo"}],
        highlight={"color": "#ffff00", "padding": 4},
    )
    layout_path = _render(tmp_path, [item])
    yellow = _colour_mask(_pixels(layout_path), (255, 255, 0))
    rows = np.where(yellow.any(axis=1))[0]
    columns = np.where(yellow.any(axis=0))[0]
    assert rows.min() < 22 and columns.min() <= 17
    measured = _text(
        [{"text": "one"}],
        segments=[{"text": "one", "x": 0, "y": 20, "size": 20}],
        bands=[{"x": 100, "y": 100, "width": 50, "height": 20}],
        highlight={"color": "#ffff00", "padding": 0},
    )
    yellow = _colour_mask(_pixels(_render(tmp_path, [measured])), (255, 255, 0))
    assert yellow[125, 145] and not yellow[100, 100]


def test_auto_width_keeps_one_line(tmp_path: Path):
    long = "a long single line that would wrap in a narrow box"
    wrapped = _words(_render(tmp_path, [_text([{"text": long}], width=80)]))
    single = _words(_render(tmp_path, [_text([{"text": long}], width=80, autoWidth=True)]))
    assert len({round(word[3]) for word in wrapped}) > 1
    assert len({round(word[3]) for word in single}) == 1


def test_measured_segments_carry_their_font_and_weight(tmp_path: Path):
    segments = [
        {"text": "Bold", "x": 0, "y": 20, "size": 20, "weight": 700},
        {"text": "Plain", "x": 0, "y": 50, "size": 12, "fontId": "bundled:dejavu-sans"},
    ]
    item = _text([{"text": "x"}], segments=segments)
    spans = {span["text"]: span for span in _spans(_render(tmp_path, [item]))}
    assert "Bold" in spans["Bold"]["font"]
    assert round(spans["Plain"]["size"]) == 12


def test_right_to_left_lists_and_effects_still_render(tmp_path: Path):
    item = _text(
        [{"text": f"{ARABIC}\n{ARABIC}", "strike": True}],
        paragraphs=[{"list": "decimal"}, {"list": "decimal"}],
        outline={"color": "#0000ff", "width": 1},
        shadow={"color": "#00ff00", "x": 3, "y": 3, "opacity": 0.5},
    )
    path = _render(tmp_path, [item])
    text = "".join(word[4] for word in _words(path))
    assert "1." in text and "2." in text
    assert _colour_mask(_pixels(path), (0, 0, 255)).any()


def test_new_text_fields_are_validated():
    with pytest.raises(ValidationError):
        _item([{"text": "x"}], paragraphs=[{"list": "stars"}])
    with pytest.raises(ValidationError):
        _item([{"text": "x"}], outline={"color": "#000000", "width": 0})
    with pytest.raises(ValidationError):
        _item([{"text": "x", "weight": 5000}])
    with pytest.raises(ValidationError):
        _item([{"text": "x"}], textCase="shout")


def test_weight_names_and_families():
    assert weight_of_name("SegoeUI-Semibold", True) == 600
    assert weight_of_name("SegoeUI-Light", False) == 300
    assert weight_of_name("Arial-Black", False) == 900
    assert weight_of_name("Arial-BoldMT", True) == 700
    assert weight_of_name("Inter", False) == 400
    assert weight_family("SegoeUI-Semibold") == weight_family("SegoeUI") == "segoeui"
    assert nearest_weight([300, 400, 700], 600) == 700
    assert nearest_weight([300, 400, 700], 350) == 300
    assert family_weights("bundled:dejavu-sans") == [400, 700]
    assert family_weights("library:inter") == [400, 700]


@pytest.fixture
def weighted_family(monkeypatch: pytest.MonkeyPatch) -> str:
    faces = [
        ImportedFace("Demo-Light", REGULAR, "Demo-Light", False, False),
        ImportedFace("Demo-Regular", REGULAR, "Demo-Regular", False, False),
        ImportedFace("Demo-Black", BOLD, "Demo-Black", True, False),
    ]
    monkeypatch.setattr(fonts, "imported_faces", lambda: faces)
    return "imported:Demo-Regular"


def test_imported_families_offer_their_real_weights(weighted_family: str, tmp_path: Path):
    assert family_weights(weighted_family) == [300, 400, 900]
    assert resolve_face(weighted_family, True, False, 900) == (BOLD, False)
    assert resolve_face(weighted_family, False, True, 300) == (REGULAR, False)
    assert font_file(FontFileParams(id=weighted_family, weight=900), silent_progress()).base64
    spans = _spans(
        _render(tmp_path, [_text([{"text": "Black", "fontId": weighted_family, "weight": 900}])])
    )
    assert "Bold" in spans[0]["font"]


def test_unknown_weights_fall_back_to_the_bold_flag():
    assert resolve_face("library:missing", False, False, 300)[0].name == REGULAR.name
    assert resolve_face("library:missing", True, False, 800)[0].name == BOLD.name
