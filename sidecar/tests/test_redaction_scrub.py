from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._page_text import NUMBER_FONT
from vivepdf.ops.redaction_scrub import (
    RedactedTextParams,
    ScrubArea,
    ScrubHiddenParams,
    redacted_text,
    scrub_hidden,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

NAME = "Ayşe Yıldırım"


@pytest.fixture
def leaky(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    font = {"fontname": "dejavu", "fontfile": str(NUMBER_FONT), "fontsize": 12}
    page.insert_text((72, 100), f"Müşteri: {NAME} sözleşmeyi imzaladı.", **font)
    page.insert_text((72, 130), "Yıldız ve ayşegül kelimeleri kalmalı.", **font)
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.field_name = "musteri"
    widget.field_value = f"Sayın {NAME}"
    widget.rect = pymupdf.Rect(72, 200, 300, 220)
    page.add_widget(widget)
    note = page.add_text_annot((400, 400), f"{NAME} ile görüşüldü")
    note.update()
    document.set_toc([[1, f"{NAME} dosyası", 1]])
    document.set_metadata({"title": f"{NAME} sözleşmesi", "author": "Hukuk"})
    path = tmp_path / "sızıntı.pdf"
    document.save(path)
    document.close()
    return path


def _name_area(path: Path) -> ScrubArea:
    with pymupdf.open(path) as document:
        rect = document[0].search_for(NAME)[0]
    return ScrubArea(page=1, x0=rect.x0, y0=rect.y0, x1=rect.x1, y1=rect.y1)


def test_redacted_text_reads_the_words_under_the_marked_area(leaky: Path) -> None:
    result = redacted_text(
        RedactedTextParams(path=str(leaky), areas=[_name_area(leaky)]), silent_progress()
    )
    assert NAME in result.texts
    assert "Ayşe" in result.texts and "Yıldırım" in result.texts
    assert "Müşteri" not in result.texts


def test_scrub_hidden_removes_the_name_everywhere_it_hides(leaky: Path) -> None:
    area = _name_area(leaky)
    texts = redacted_text(RedactedTextParams(path=str(leaky), areas=[area]), silent_progress())
    result = scrub_hidden(
        ScrubHiddenParams(path=str(leaky), texts=texts.texts, areas=[area]), silent_progress()
    )
    assert result.output == str(leaky)
    assert result.hidden >= 4
    with pymupdf.open(leaky) as document:
        page = document[0]
        widget = next(page.widgets())
        assert "Ayşe" not in widget.field_value and "Yıldırım" not in widget.field_value
        assert all("Yıldırım" not in (annot.info.get("content") or "") for annot in page.annots())
        assert "Yıldırım" not in document.get_toc()[0][1]
        assert "Yıldırım" not in document.metadata["title"]
        assert document.metadata["author"] == "Hukuk"
        assert "Yıldız ve ayşegül" in page.get_text()


def test_scrub_hidden_writes_a_copy_and_keeps_a_password(leaky: Path, tmp_path: Path) -> None:
    locked = tmp_path / "locked.pdf"
    with pymupdf.open(leaky) as document:
        document.save(locked, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="o")
    result = scrub_hidden(
        ScrubHiddenParams(
            path=str(locked), password="pw", texts=[NAME], output=str(tmp_path / "copy.pdf")
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert document.needs_pass
        assert document.authenticate("pw")
        assert NAME not in document.metadata["title"]


def test_scrub_hidden_leaves_an_untouched_file_alone(leaky: Path) -> None:
    before = leaky.read_bytes()
    result = scrub_hidden(
        ScrubHiddenParams(path=str(leaky), texts=["Bulunmayan Kişi"]), silent_progress()
    )
    assert result.hidden == 0
    assert leaky.read_bytes() == before


def test_scrub_hidden_needs_something_to_scrub(leaky: Path) -> None:
    with pytest.raises(OpError) as caught:
        scrub_hidden(ScrubHiddenParams(path=str(leaky), texts=["  ", "a"]), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_a_masked_field_is_drawn_with_the_block_mask(leaky: Path) -> None:
    area = _name_area(leaky)
    texts = redacted_text(RedactedTextParams(path=str(leaky), areas=[area]), silent_progress())
    scrub_hidden(
        ScrubHiddenParams(path=str(leaky), texts=texts.texts, areas=[area]), silent_progress()
    )
    with pymupdf.open(leaky) as document:
        page = document[0]
        widget = next(page.widgets())
        shown = page.get_text(clip=widget.rect)
        assert "█" in shown
        assert "·" not in shown
