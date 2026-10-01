from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._document import forget_document
from vivepdf.ops.info import InfoGetParams, PageTextParams, get_info, page_text
from vivepdf.rpc.progress import silent_progress


def _document(path: Path, **encryption: object) -> Path:
    document = pymupdf.open()
    for index in range(2):
        document.new_page().insert_text((72, 72), f"Sayfa {index + 1}")
    document.save(path, **encryption)
    document.close()
    return path


@pytest.fixture
def locked(tmp_path: Path):
    path = _document(
        tmp_path / "kilitli belge ş.pdf",
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="kullanıcı",
        owner_pw="sahip",
    )
    yield path
    forget_document(str(path))


def test_reading_the_info_of_a_locked_file_keeps_its_text_readable(locked: Path):
    info = get_info(InfoGetParams(path=str(locked), password="kullanıcı"), silent_progress())
    assert info.encrypted and not info.owner_only
    again = get_info(InfoGetParams(path=str(locked), password="kullanıcı"), silent_progress())
    assert again.page_count == 2
    text = page_text(PageTextParams(path=str(locked), password="kullanıcı"), silent_progress())
    assert [entry.text for entry in text.pages] == ["Sayfa 1", "Sayfa 2"]


def test_an_owner_only_file_is_still_reported_as_owner_only(tmp_path: Path):
    path = _document(
        tmp_path / "izin.pdf",
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="",
        owner_pw="sahip",
    )
    try:
        info = get_info(InfoGetParams(path=str(path)), silent_progress())
        assert info.encrypted and info.owner_only
        text = page_text(PageTextParams(path=str(path)), silent_progress())
        assert text.pages[0].text == "Sayfa 1"
    finally:
        forget_document(str(path))
