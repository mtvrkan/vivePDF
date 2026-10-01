from pathlib import Path

import pymupdf
import pytest
from docx import Document

from vivepdf.ops._placement import reading_rotation, turn_text_upright
from vivepdf.ops.convert import DocxParams, to_docx
from vivepdf.ops.convert_text import MarkdownParams, to_markdown
from vivepdf.rpc.progress import silent_progress

BODY = "Yan duran paragraf cümlesi burada sürüyor. " * 12


def _sideways_pdf(path: Path, rotation: int) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "Yan duran baslik", fontsize=20)
    page.insert_textbox(pymupdf.Rect(72, 130, 520, 500), BODY, fontsize=11)
    page.set_rotation(rotation)
    document.save(path)
    document.close()
    return path


def _upright_page(document: pymupdf.Document, rotation: int, text: str) -> pymupdf.Page:
    page = document.new_page(width=595, height=842)
    page.set_rotation(rotation)
    anchor = pymupdf.Point(72, 100) * page.derotation_matrix
    page.insert_text(anchor, text, fontsize=12, rotate=rotation)
    return page


def _docx_text(path: Path) -> str:
    return " ".join(paragraph.text for paragraph in Document(str(path)).paragraphs)


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_text_the_reader_sees_sideways_still_reaches_the_word_file(tmp_path: Path, rotation: int):
    source = _sideways_pdf(tmp_path / "turned.pdf", rotation)
    target = tmp_path / "turned.docx"

    to_docx(DocxParams(path=str(source), output=str(target)), silent_progress())

    text = _docx_text(target)
    assert "Yan duran baslik" in text
    assert text.count("paragraf cümlesi") >= 10


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_text_the_reader_sees_sideways_still_reaches_the_markdown_file(
    tmp_path: Path, rotation: int
):
    source = _sideways_pdf(tmp_path / "turned.pdf", rotation)
    target = tmp_path / "turned.md"

    to_markdown(MarkdownParams(path=str(source), output=str(target)), silent_progress())

    markdown = target.read_text(encoding="utf-8")
    assert "Yan duran baslik" in markdown
    assert markdown.count("paragraf cümlesi") >= 10


def test_a_locked_turned_page_with_an_offset_crop_box_converts_with_its_password(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_textbox(pymupdf.Rect(120, 140, 480, 600), BODY, fontsize=11)
    page.set_cropbox(pymupdf.Rect(100, 120, 500, 700))
    page.set_rotation(90)
    source = tmp_path / "locked.pdf"
    document.save(source, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="gizli", user_pw="gizli")
    document.close()
    target = tmp_path / "locked.docx"

    to_docx(DocxParams(path=str(source), password="gizli", output=str(target)), silent_progress())

    assert _docx_text(target).count("paragraf cümlesi") >= 10


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_a_page_that_already_reads_upright_keeps_its_rotation(rotation: int):
    document = pymupdf.open()
    _upright_page(document, rotation, "Zaten düz okunan satır")

    assert turn_text_upright(document, [0]) == []
    assert document[0].rotation == rotation


def test_the_direction_holding_most_characters_wins():
    document = pymupdf.open()
    page = _upright_page(document, 0, "Kısa")
    page.insert_textbox(pymupdf.Rect(72, 130, 520, 700), BODY, fontsize=11, rotate=90)

    assert reading_rotation(page) == 90
    assert turn_text_upright(document, [0]) == [1]
    assert document[0].rotation == 90


def test_a_page_without_text_is_left_alone():
    document = pymupdf.open()
    document.new_page().set_rotation(270)

    assert turn_text_upright(document, [0]) == []
    assert document[0].rotation == 270
