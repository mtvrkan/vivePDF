from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.scan_session import (
    ScannerAssembleParams,
    ScannerDiscardParams,
    assemble,
    discard,
    session_part,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture(autouse=True)
def temporary_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "temp"
    root.mkdir()
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(root))
    return root


def _part(labels: list[str], image: bool = False) -> Path:
    path = session_part()
    document = pymupdf.open()
    for label in labels:
        page = document.new_page(width=300, height=400)
        if image:
            source = pymupdf.open()
            drawn = source.new_page(width=300, height=400)
            drawn.insert_text((30, 120), label, fontsize=28, fontfile=FONT, fontname="dv")
            page.insert_image(page.rect, pixmap=drawn.get_pixmap(dpi=200))
            source.close()
        else:
            page.insert_text((30, 60), label)
    document.save(path)
    document.close()
    return path


def _texts(path: str) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text().strip() for page in document]


def test_pages_from_several_scans_are_saved_in_the_chosen_order(tmp_path: Path) -> None:
    first = _part(["bir", "iki"])
    second = _part(["uc"])
    result = assemble(
        ScannerAssembleParams(
            pages=[
                {"path": str(second), "page": 0},
                {"path": str(first), "page": 1, "rotation": 90},
                {"path": str(first), "page": 0},
            ],
            output=str(tmp_path / "tarama.pdf"),
        ),
        silent_progress(),
    )
    assert result.page_count == 3
    assert _texts(result.output) == ["uc", "iki", "bir"]
    with pymupdf.open(result.output) as document:
        assert document[1].rotation == 90
    assert not first.exists()
    assert not second.exists()


def test_a_page_that_is_not_in_the_scan_is_refused(tmp_path: Path) -> None:
    part = _part(["tek"])
    with pytest.raises(OpError) as caught:
        assemble(
            ScannerAssembleParams(
                pages=[{"path": str(part), "page": 3}], output=str(tmp_path / "t.pdf")
            ),
            silent_progress(),
        )
    assert caught.value.data["reason"] == "pageMissing"
    assert part.exists()
    assert not (tmp_path / "t.pdf").exists()


def test_scans_are_kept_when_asked(tmp_path: Path) -> None:
    part = _part(["bir"])
    assemble(
        ScannerAssembleParams(
            pages=[{"path": str(part), "page": 0}], output=str(tmp_path / "t.pdf"), discard=False
        ),
        silent_progress(),
    )
    assert part.exists()


def test_discarding_never_touches_files_outside_the_session(tmp_path: Path) -> None:
    part = _part(["bir"])
    outside = tmp_path / "belge.pdf"
    outside.write_bytes(part.read_bytes())
    result = discard(
        ScannerDiscardParams(paths=[str(part), str(outside), str(part.parent / ".." / "x.pdf")]),
        silent_progress(),
    )
    assert result.removed == 1
    assert not part.exists()
    assert outside.exists()


def test_the_saved_scan_can_be_made_searchable(tmp_path: Path) -> None:
    part = _part(["Fatura listesi"], image=True)
    result = assemble(
        ScannerAssembleParams(
            pages=[{"path": str(part), "page": 0}],
            output=str(tmp_path / "aranabilir.pdf"),
            ocr=True,
            languages=["tur", "eng"],
        ),
        silent_progress(),
    )
    assert result.ocr_pages == 1
    assert "Fatura" in _texts(result.output)[0]
    assert list(part.parent.glob("*.pdf")) == []


def test_session_parts_live_in_the_users_own_data_folder(temporary_root: Path) -> None:
    assert session_part().parent == (temporary_root / "scan-session").resolve()
