import unicodedata
from pathlib import Path

import numpy as np
import pymupdf
import pytest

from vivepdf.ops._studio_models import StudioRenderParams, StudioTextItem
from vivepdf.ops._studio_shaped import direction, needs_shaping
from vivepdf.ops._studio_text import TextFaces
from vivepdf.ops.studio import render
from vivepdf.rpc.progress import silent_progress

ARABIC = "".join(map(chr, (0x0633, 0x0627, 0x0631, 0x0629)))
KATAKANA = "".join(map(chr, (0x30B9, 0x30BF, 0x30B8, 0x30AA, 0x30FC, 0x30FB)))


def _item(text: str, **extra) -> dict:
    item = {
        "kind": "text",
        "x": 20,
        "y": 20,
        "width": 260,
        "height": 80,
        "runs": [{"text": text}],
        "fontSize": 24,
    }
    item.update(extra)
    return item


def _render(folder: Path, items: list[dict]) -> Path:
    payload = {
        "pages": [{"width": 300, "height": 300, "items": items}],
        "output": str(folder / "shaped.pdf"),
        "overwrite": True,
    }
    return Path(render(StudioRenderParams.model_validate(payload), silent_progress()).output)


def _plain(path: Path) -> str:
    with pymupdf.open(path) as document:
        return unicodedata.normalize("NFKC", document[0].get_text())


def _ink_columns(path: Path) -> np.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(alpha=False)
        pixels = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
            pixmap.height, pixmap.width, 3
        )
    return np.where(pixels.min(axis=(0, 2)) < 128)[0]


def test_latin_text_keeps_the_exact_placement_path():
    item = StudioTextItem.model_validate(_item("Ayşe & Mehmet"))

    assert not needs_shaping(item, TextFaces(None), ["Ayşe & Mehmet"])


def test_right_to_left_and_missing_wide_glyphs_take_the_shaping_path():
    arabic = StudioTextItem.model_validate(_item(ARABIC))
    wide = StudioTextItem.model_validate(_item(KATAKANA))

    assert needs_shaping(arabic, TextFaces(None), [ARABIC])
    assert needs_shaping(wide, TextFaces(None), [KATAKANA])


def test_direction_follows_the_first_letter():
    assert direction(f"2027 {ARABIC} Studio") == "rtl"
    assert direction(f"Studio {ARABIC}") == "ltr"
    assert direction("2027") == "ltr"


def test_arabic_text_is_written_joined_and_extractable(tmp_path: Path):
    text = _plain(_render(tmp_path, [_item(f"{ARABIC} {ARABIC}")]))

    assert ARABIC in text


def test_left_aligned_arabic_starts_at_the_left_edge_like_the_canvas(tmp_path: Path):
    left = _ink_columns(_render(tmp_path, [_item(ARABIC, align="left")]))
    right = _ink_columns(_render(tmp_path, [_item(ARABIC, align="right")]))

    assert left.min() < 30
    assert right.max() > 270
    assert left.max() < right.min()


def test_japanese_long_vowel_and_middle_dot_are_drawn(tmp_path: Path):
    text = _plain(_render(tmp_path, [_item(KATAKANA)]))

    assert KATAKANA in text.replace("\n", "")


def test_shaped_text_turns_with_its_box(tmp_path: Path):
    output = _render(tmp_path, [_item(ARABIC, rotation=90, x=50, y=100, width=200, height=40)])
    with pymupdf.open(output) as document:
        line = document[0].get_text("dict")["blocks"][0]["lines"][0]

    assert line["dir"] == pytest.approx((0, 1), abs=1e-3)


def test_shaped_text_shrinks_to_fit_and_keeps_its_opacity(tmp_path: Path):
    long_text = " ".join([ARABIC] * 40)
    output = _render(tmp_path, [_item(long_text, shrinkToFit=True, fontSize=40, opacity=0.4)])
    with pymupdf.open(output) as document:
        page = document[0]
        bottom = max(word[3] for word in page.get_text("words"))
        pixmap = page.get_pixmap(alpha=False)
    pixels = np.frombuffer(pixmap.samples, dtype=np.uint8)

    assert bottom <= 20 + 80 + 1
    assert pixels.min() > 90
