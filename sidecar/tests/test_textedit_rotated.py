from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.textedit import (
    FindReplaceParams,
    TextEdit,
    TextEditParams,
    TextSpansParams,
    direction_rotation,
    find_replace,
    get_spans,
    replace_text,
)
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _rotated_document(tmp_path: Path, page_rotation: int, text_rotation: int) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text(
        (300, 400),
        "Sozlesme tarihi 2025",
        fontsize=14,
        fontname="dejavu",
        fontfile=FONT,
        rotate=text_rotation,
    )
    page.set_rotation(page_rotation)
    path = tmp_path / f"rotated-{page_rotation}-{text_rotation}.pdf"
    document.save(path)
    document.close()
    return path


def _lines(path: Path) -> list[tuple[str, tuple[float, float]]]:
    document = pymupdf.open(path)
    found = [
        ("".join(span["text"] for span in line["spans"]), tuple(round(v, 3) for v in line["dir"]))
        for block in document[0].get_text("dict")["blocks"]
        for line in block.get("lines", [])
    ]
    document.close()
    return found


@pytest.mark.parametrize(
    ("direction", "rotation"),
    [((1, 0), 0), ((0, -1), 90), ((-1, 0), 180), ((0, 1), 270), ((0.7, -0.7), 0)],
)
def test_line_direction_maps_to_a_right_angle(direction, rotation):
    assert direction_rotation(direction) == rotation


@pytest.mark.parametrize(("page_rotation", "text_rotation"), [(90, 270), (270, 90), (0, 90)])
def test_find_replace_keeps_the_direction_of_rotated_text(
    tmp_path: Path, page_rotation: int, text_rotation: int
):
    source = _rotated_document(tmp_path, page_rotation, text_rotation)
    original_direction = _lines(source)[0][1]
    target = tmp_path / "replaced.pdf"
    result = find_replace(
        FindReplaceParams(path=str(source), output=str(target), find="2025", replace="2026"),
        silent_progress(),
    )
    assert result.replaced == 1
    lines = _lines(target)
    joined = " ".join(text for text, _direction in lines)
    assert "2026" in joined
    assert "2025" not in joined
    assert joined.count("2") == 2
    assert all(direction == original_direction for _text, direction in lines)


def test_editing_a_span_on_a_rotated_page_keeps_its_direction(tmp_path: Path):
    source = _rotated_document(tmp_path, 90, 270)
    spans = get_spans(TextSpansParams(path=str(source), page=0, visible=True), silent_progress())
    span = spans.spans[0]
    target = tmp_path / "edited.pdf"
    replace_text(
        TextEditParams(
            path=str(source),
            output=str(target),
            page=0,
            visible=True,
            edits=[
                TextEdit(
                    bbox=span.bbox,
                    text="Sozlesme tarihi 2026",
                    size=span.size,
                    color=span.color,
                    font=span.font,
                    font_xref=span.font_xref,
                )
            ],
        ),
        silent_progress(),
    )
    lines = _lines(target)
    assert [text for text, _direction in lines] == ["Sozlesme tarihi 2026"]
    assert lines[0][1] == _lines(source)[0][1]


def test_horizontal_text_is_still_written_horizontally(tmp_path: Path):
    source = _rotated_document(tmp_path, 0, 0)
    target = tmp_path / "flat.pdf"
    find_replace(
        FindReplaceParams(path=str(source), output=str(target), find="2025", replace="2026"),
        silent_progress(),
    )
    assert all(direction == (1.0, 0.0) for _text, direction in _lines(target))


def test_a_neighbouring_rotated_line_is_left_whole(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for x, text in ((300, "Birinci satir 2025"), (318, "Ikinci satir sabit")):
        page.insert_text((x, 400), text, fontsize=14, fontname="dejavu", fontfile=FONT, rotate=90)
    page.set_rotation(270)
    source = tmp_path / "two-lines.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "two-lines-out.pdf"
    find_replace(
        FindReplaceParams(path=str(source), output=str(target), find="2025", replace="2026"),
        silent_progress(),
    )
    texts = [text for text, _direction in _lines(target)]
    assert "Ikinci satir sabit" in texts
    assert any("2026" in text for text in texts)
    assert all(direction == (0.0, -1.0) for _text, direction in _lines(target))


def _line_document(tmp_path: Path, page_rotation: int, text_rotation: int, origin) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text(
        origin,
        "Tarih 2025 sonrasi metin",
        fontsize=14,
        fontname="dejavu",
        fontfile=FONT,
        rotate=text_rotation,
        color=(0.8, 0.1, 0.1),
    )
    page.set_rotation(page_rotation)
    path = tmp_path / f"line-{page_rotation}-{text_rotation}.pdf"
    document.save(path)
    document.close()
    return path


def _upright_words(path: Path, rotation: int) -> list[tuple[str, pymupdf.Rect]]:
    document = pymupdf.open(path)
    frame = pymupdf.Matrix(rotation)
    words = []
    for word in document[0].get_text("words"):
        rect = pymupdf.Rect(word[:4]) * frame
        rect.normalize()
        words.append((word[4], rect))
    document.close()
    return sorted(words, key=lambda item: item[1].x0)


def _spans(path: Path) -> list[dict]:
    document = pymupdf.open(path)
    spans = [
        span
        for block in document[0].get_text("dict")["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
        if span["text"].strip()
    ]
    document.close()
    return spans


@pytest.mark.parametrize(
    ("page_rotation", "text_rotation"), [(0, 0), (0, 90), (90, 270), (270, 90), (0, 180), (0, 270)]
)
def test_a_longer_replacement_moves_the_rest_of_a_rotated_line(
    tmp_path: Path, page_rotation: int, text_rotation: int
):
    source = _line_document(tmp_path, page_rotation, text_rotation, (300, 420))
    target = tmp_path / "reflowed.pdf"
    result = find_replace(
        FindReplaceParams(
            path=str(source), output=str(target), find="2025", replace="2025-2026 donemi"
        ),
        silent_progress(),
    )
    assert result.replaced == 1
    assert not [warning for warning in result.warnings if warning.code == "lineOverflow"]
    words = _upright_words(target, text_rotation)
    assert [text for text, _rect in words] == [
        "Tarih",
        "2025-2026",
        "donemi",
        "sonrasi",
        "metin",
    ]
    for (_left, before), (_right, after) in zip(words, words[1:], strict=False):
        assert after.x0 >= before.x1 - 0.5
    source_direction = _lines(source)[0][1]
    assert all(direction == source_direction for _text, direction in _lines(target))
    tail = next(span for span in _spans(target) if "sonrasi" in span["text"])
    original = next(span for span in _spans(source) if "sonrasi" in span["text"])
    assert tail["size"] == pytest.approx(original["size"])
    assert tail["color"] == original["color"]


def test_a_rotated_line_pushed_past_the_page_edge_is_reported(tmp_path: Path):
    source = _line_document(tmp_path, 0, 90, (300, 220))
    target = tmp_path / "overflow.pdf"
    result = find_replace(
        FindReplaceParams(
            path=str(source),
            output=str(target),
            find="2025",
            replace="2025 yilinda imzalanan uzun sozlesme",
        ),
        silent_progress(),
    )
    assert any(warning.code == "lineOverflow" for warning in result.warnings)
