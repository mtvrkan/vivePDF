from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import pages as pages_module
from vivepdf.ops.pages import AssembleParams, assemble
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _params(path: Path, order: list[int], **values: object) -> AssembleParams:
    return AssembleParams.model_validate(
        {
            "sources": [
                {"id": "main", "path": str(path), "password": values.pop("password", None)}
            ],
            "pages": [{"kind": "page", "source": "main", "index": index} for index in order],
            **values,
        }
    )


def _texts(path: Path, password: str | None = None) -> list[str]:
    with pymupdf.open(path) as document:
        if document.needs_pass:
            assert document.authenticate(password)
        return [page.get_text().strip() for page in document]


def _parts(folder: Path) -> list[Path]:
    return list(folder.glob(".vivepdf-*.part"))


def test_in_place_rewrites_the_main_source(sample_pdf: Path) -> None:
    result = assemble(_params(sample_pdf, [3, 1, 3], inPlace=True), silent_progress())

    assert result.output == str(sample_pdf)
    assert result.page_count == 3
    assert result.bytes == sample_pdf.stat().st_size
    assert _texts(sample_pdf) == ["Page 3", "Page 1", "Page 3"]
    assert _parts(sample_pdf.parent) == []


def test_in_place_can_shrink_the_document(sample_pdf: Path) -> None:
    result = assemble(_params(sample_pdf, [2], inPlace=True), silent_progress())

    assert result.page_count == 1
    assert _texts(sample_pdf) == ["Page 2"]


def test_in_place_keeps_protection(encrypted_pdf: Path) -> None:
    assemble(_params(encrypted_pdf, [2, 1], inPlace=True, password="secret"), silent_progress())

    with pymupdf.open(encrypted_pdf) as document:
        assert document.needs_pass
    assert _texts(encrypted_pdf, "secret") == ["Page 2", "Page 1"]


def test_output_and_in_place_conflict(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        assemble(
            _params(sample_pdf, [1], inPlace=True, output=str(tmp_path / "x.pdf")),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS
    assert raised.value.data == {"reason": "outputAndInPlace"}


def test_neither_output_nor_in_place_is_rejected(sample_pdf: Path) -> None:
    with pytest.raises(OpError) as raised:
        assemble(_params(sample_pdf, [1]), silent_progress())
    assert raised.value.code == ErrorCode.INVALID_PARAMS
    assert raised.value.data == {"reason": "outputRequired"}


def test_failed_replace_leaves_original_and_no_part_files(
    sample_pdf: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(_source: Path, _target: Path) -> None:
        raise PermissionError("locked")

    monkeypatch.setattr(pages_module, "replace_patiently", refuse)

    with pytest.raises(PermissionError):
        assemble(_params(sample_pdf, [3, 2, 1], inPlace=True), silent_progress())

    assert _texts(sample_pdf) == ["Page 1", "Page 2", "Page 3"]
    assert _parts(sample_pdf.parent) == []
