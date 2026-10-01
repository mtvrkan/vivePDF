from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.editor_question import (
    QuestionSpec,
    option_label,
    question_pdf,
    question_preview,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

STEM = "Aşağıdakilerden hangisi Türkiye'nin başkentidir?"
OPTIONS = ["İstanbul", "Ankara", "İzmir", "Bursa"]


def _spec(**change) -> QuestionSpec:
    return QuestionSpec.model_validate(
        {"number": 3, "stem": STEM, "options": OPTIONS, "answer": 1, **change}
    )


def _words(spec: QuestionSpec) -> list[tuple]:
    document, _ = question_pdf(spec)
    try:
        return document[0].get_text("words")
    finally:
        document.close()


def _word(words: list[tuple], text: str) -> tuple:
    return next(word for word in words if word[4] == text)


def _pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    path = tmp_path / "sinav.pdf"
    document.save(path)
    document.close()
    return path


def test_a_question_is_written_as_real_text_without_its_answer(tmp_path: Path):
    target = tmp_path / "out.pdf"
    result = apply(
        EditorApplyParams(
            path=str(_pdf(tmp_path)),
            output=str(target),
            objects=[
                {
                    "kind": "question",
                    "page": 1,
                    "x0": 50,
                    "y0": 60,
                    "x1": 510,
                    "y1": 120,
                    **_spec().model_dump(by_alias=True),
                }
            ],
        ),
        silent_progress(),
    )
    assert result.applied == 1 and result.warnings == []
    with pymupdf.open(target) as document:
        page = document[0]
        text = page.get_text()
        for word in ("3.", "Türkiye'nin", "A)", "İstanbul", "D)", "Bursa"):
            assert word in text
        assert not [item for item in page.get_drawings() if item["type"] == "s"]
        assert b"answer" not in document.tobytes().lower()


def test_short_options_share_one_row_and_long_ones_stack():
    words = _words(_spec())
    first, last = _word(words, "A)"), _word(words, "D)")
    assert first[1] == pytest.approx(last[1], abs=0.5)
    assert last[0] > first[0]
    long = [f"{text} şehri, ülkenin en kalabalık yerleşim yerlerinden biridir" for text in OPTIONS]
    stacked = _words(_spec(options=long))
    assert _word(stacked, "D)")[1] > _word(stacked, "C)")[1] > _word(stacked, "A)")[1]
    assert _word(stacked, "A)")[0] == pytest.approx(_word(stacked, "D)")[0], abs=0.5)


def test_two_columns_put_a_and_b_on_the_first_row():
    words = _words(_spec(layout="two"))
    a, b, c = _word(words, "A)"), _word(words, "B)"), _word(words, "C)")
    assert a[1] == pytest.approx(b[1], abs=0.5) and b[0] > a[0]
    assert c[1] > a[1] and c[0] == pytest.approx(a[0], abs=0.5)


def test_options_sit_under_the_stem_indented_past_the_number():
    words = _words(_spec(layout="stack"))
    number, stem, option = _word(words, "3."), _word(words, "Aşağıdakilerden"), _word(words, "A)")
    assert stem[0] > number[2]
    assert option[0] == pytest.approx(stem[0], abs=0.5)
    assert option[1] > stem[3]


def test_lower_case_letters_and_no_number():
    words = [word[4] for word in _words(_spec(letter_case="lower", number=None))]
    assert "a)" in words and "A)" not in words and "3." not in words
    assert option_label(5, "upper") == "F)"


def test_marking_the_answer_circles_its_letter_for_a_teacher_copy():
    document, _ = question_pdf(_spec(mark_answer=True, layout="stack"))
    try:
        page = document[0]
        circles = [item for item in page.get_drawings() if item["type"] == "s"]
        assert len(circles) == 1
        label = _word(page.get_text("words"), "B)")
        assert circles[0]["rect"].contains(
            pymupdf.Point((label[0] + label[2]) / 2, (label[1] + label[3]) / 2)
        )
    finally:
        document.close()


def test_an_open_question_gets_answer_lines_below_it():
    document, _ = question_pdf(_spec(options=[], answer=None, answer_lines=4))
    try:
        page = document[0]
        lines = [item for item in page.get_drawings() if item["type"] == "s"]
        assert len(lines) == 4
        stem_bottom = _word(page.get_text("words"), "Aşağıdakilerden")[3]
        assert min(item["rect"].y0 for item in lines) > stem_bottom
        assert max(item["rect"].y1 for item in lines) <= page.rect.height
    finally:
        document.close()


def test_the_preview_is_an_svg_of_the_question_size():
    result = question_preview(_spec(width=300), silent_progress())
    assert result.svg.startswith("<svg") and result.width == 300 and result.height > 20


@pytest.mark.parametrize(
    "change",
    [{"answer": 4}, {"options": ["x"] * 9}, {"width": 20}, {"color": "red"}],
)
def test_malformed_questions_are_refused(change: dict):
    with pytest.raises(ValidationError):
        _spec(**change)


def test_an_empty_question_is_refused():
    with pytest.raises(OpError) as error:
        question_pdf(QuestionSpec(stem="  ", options=["", " "]))
    assert error.value.code is ErrorCode.INVALID_PARAMS
    assert error.value.data == {"reason": "questionEmpty"}


def test_a_question_taller_than_any_page_is_refused():
    with pytest.raises(OpError) as error:
        question_pdf(_spec(stem="satır\n" * 400, font_size=72))
    assert error.value.data and error.value.data["reason"] == "questionTooTall"
