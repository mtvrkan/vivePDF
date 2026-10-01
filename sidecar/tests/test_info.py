from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.info import InfoGetParams, PageLabelsParams, get_info, page_labels
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def test_returns_page_count_sizes_and_metadata(sample_pdf: Path) -> None:
    info = get_info(InfoGetParams(path=str(sample_pdf)), silent_progress())

    assert info.page_count == 3
    assert info.file_name == "sample.pdf"
    assert info.bytes == sample_pdf.stat().st_size
    assert info.encrypted is False
    assert info.pdf_version is not None and info.pdf_version.startswith("PDF")
    assert info.metadata["title"] == "Sample"
    assert len(info.page_sizes) == 3
    assert round(info.page_sizes[0].width) == 595
    assert info.has_toc is False


def test_serializes_with_camel_case_aliases(sample_pdf: Path) -> None:
    info = get_info(InfoGetParams(path=str(sample_pdf)), silent_progress())
    payload = info.model_dump(by_alias=True)

    assert "pageCount" in payload
    assert "fileName" in payload
    assert "page_count" not in payload


def test_encrypted_without_password_raises_needs_password(encrypted_pdf: Path) -> None:
    with pytest.raises(OpError) as raised:
        get_info(InfoGetParams(path=str(encrypted_pdf)), silent_progress())

    assert raised.value.code == ErrorCode.NEEDS_PASSWORD
    assert raised.value.data == {"wrongPassword": False}


def test_encrypted_with_wrong_password_flags_it(encrypted_pdf: Path) -> None:
    with pytest.raises(OpError) as raised:
        get_info(InfoGetParams(path=str(encrypted_pdf), password="nope"), silent_progress())

    assert raised.value.code == ErrorCode.NEEDS_PASSWORD
    assert raised.value.data == {"wrongPassword": True}


def test_encrypted_with_password_opens(encrypted_pdf: Path) -> None:
    info = get_info(InfoGetParams(path=str(encrypted_pdf), password="secret"), silent_progress())

    assert info.page_count == 3
    assert info.encrypted is True


def test_missing_file_raises_file_not_found(tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        get_info(InfoGetParams(path=str(tmp_path / "nope.pdf")), silent_progress())

    assert raised.value.code == ErrorCode.FILE_NOT_FOUND


def test_broken_file_raises_invalid_pdf(broken_pdf: Path) -> None:
    with pytest.raises(OpError) as raised:
        get_info(InfoGetParams(path=str(broken_pdf)), silent_progress())

    assert raised.value.code == ErrorCode.INVALID_PDF


def test_thumbnail_renders_requested_width(sample_pdf: Path) -> None:
    from vivepdf.ops.info import ThumbnailParams, thumbnail

    result = thumbnail(ThumbnailParams(path=str(sample_pdf), page=1, width=200), silent_progress())
    assert result.width == 200
    assert result.height > 200
    assert result.page_count == 3
    assert result.image.startswith("iVBOR")
    with pytest.raises(OpError):
        thumbnail(ThumbnailParams(path=str(sample_pdf), page=9), silent_progress())


def test_page_labels_follow_the_label_rules(tmp_path: Path) -> None:
    path = tmp_path / "labels.pdf"
    with pymupdf.open() as document:
        for _ in range(5):
            document.new_page()
        document.set_page_labels(
            [
                {"startpage": 0, "style": "r", "prefix": "", "firstpagenum": 1},
                {"startpage": 2, "style": "D", "prefix": "A-", "firstpagenum": 7},
            ]
        )
        document.save(path)

    result = page_labels(PageLabelsParams(path=str(path)), silent_progress())

    assert result.labels == ["i", "ii", "A-7", "A-8", "A-9"]
    assert result.page_count == 5
    assert result.model_dump(by_alias=True)["pageCount"] == 5


def test_page_labels_are_absent_without_rules_or_when_they_match_page_numbers(
    tmp_path: Path, sample_pdf: Path
) -> None:
    assert page_labels(PageLabelsParams(path=str(sample_pdf)), silent_progress()).labels is None
    path = tmp_path / "plain.pdf"
    with pymupdf.open() as document:
        for _ in range(3):
            document.new_page()
        document.set_page_labels([{"startpage": 0, "style": "D", "prefix": "", "firstpagenum": 1}])
        document.save(path)

    assert page_labels(PageLabelsParams(path=str(path)), silent_progress()).labels is None


def test_page_labels_of_an_encrypted_file_need_the_password(encrypted_pdf: Path) -> None:
    with pytest.raises(OpError) as raised:
        page_labels(PageLabelsParams(path=str(encrypted_pdf)), silent_progress())

    assert raised.value.code == ErrorCode.NEEDS_PASSWORD
