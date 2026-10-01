from pathlib import Path

import pymupdf
import pytest


@pytest.fixture
def sample_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(3):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"Page {index + 1}")
    document.set_metadata({"title": "Sample", "author": "Tests"})
    path = tmp_path / "sample.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def encrypted_pdf(tmp_path: Path, sample_pdf: Path) -> Path:
    document = pymupdf.open(sample_pdf)
    path = tmp_path / "encrypted.pdf"
    document.save(
        path,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="secret",
        owner_pw="owner",
    )
    document.close()
    return path


@pytest.fixture
def broken_pdf(tmp_path: Path) -> Path:
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"this is not a pdf")
    return path
