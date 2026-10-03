from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.create_bulk import BulkParams, Signer, create_bulk, fill_placeholders
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def people(tmp_path: Path) -> Path:
    path = tmp_path / "people.csv"
    path.write_text(
        "Ad Soyad;Kurum\nAyşe Demir;vivePDF\nMehmet Şahin;Ankara Üniversitesi\nAyşe Demir;Başka\n",
        encoding="utf-8",
    )
    return path


def _pages(path: str) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text() for page in document]


def test_placeholders_take_row_values_and_leave_unknown_ones():
    assert (
        fill_placeholders("Sayın {Ad} ({n}) {{x}}", {"Ad": "Ali", "n": "1"})
        == "Sayın Ali (1) {{x}}"
    )


def test_certificates_get_one_landscape_page_per_row_with_the_row_filled_in(
    tmp_path: Path, people: Path
):
    params = BulkParams(
        data_path=str(people),
        kind="certificate",
        heading="KATILIM BELGESİ",
        recipient="{Ad Soyad}",
        body="{Kurum} adına teşekkürler",
        signers=[Signer(name="Prof. Ali", role="Başkan")],
        output=str(tmp_path / "certificates.pdf"),
    )

    result = create_bulk(params, silent_progress())

    pages = _pages(result.outputs[0])
    assert (result.count, result.page_count) == (3, 3)
    assert "Mehmet Şahin" in pages[1] and "Ankara Üniversitesi adına teşekkürler" in pages[1]
    assert all("Prof. Ali" in page and "KATILIM BELGESİ" in page for page in pages)
    with pymupdf.open(result.outputs[0]) as document:
        assert document[0].rect.width > document[0].rect.height


def test_badges_fill_ten_per_sheet(tmp_path: Path):
    data = tmp_path / "badges.csv"
    data.write_text(
        "Ad\n" + "\n".join(f"Kişi {index}" for index in range(11)) + "\n", encoding="utf-8"
    )

    result = create_bulk(
        BulkParams(
            data_path=str(data),
            kind="badge",
            heading="Zirve",
            recipient="{Ad}",
            output=str(tmp_path / "badges.pdf"),
            split=True,
        ),
        silent_progress(),
    )

    pages = _pages(result.outputs[0])
    assert result.page_count == 2
    assert pages[0].count("Zirve") == 10 and "Kişi 9" in pages[0]
    assert "Kişi 10" in pages[1]


def test_separate_files_are_named_from_the_pattern_and_kept_unique(tmp_path: Path, people: Path):
    folder = tmp_path / "out"

    result = create_bulk(
        BulkParams(
            data_path=str(people),
            kind="invitation",
            recipient="Sayın {Ad Soyad}",
            split=True,
            output_dir=str(folder),
            pattern="{Ad Soyad}",
        ),
        silent_progress(),
    )

    assert [Path(path).name for path in result.outputs] == [
        "Ayşe Demir.pdf",
        "Mehmet Şahin.pdf",
        "Ayşe Demir-2.pdf",
    ]
    assert "Sayın Mehmet Şahin" in _pages(result.outputs[1])[0]

    with pytest.raises(OpError) as taken:
        create_bulk(
            BulkParams(
                data_path=str(people),
                kind="invitation",
                split=True,
                output_dir=str(folder),
                pattern="{Ad Soyad}",
            ),
            silent_progress(),
        )
    assert taken.value.data["exists"] is True


def test_unknown_fields_empty_tables_and_bad_logos_are_refused(tmp_path: Path, people: Path):
    with pytest.raises(OpError) as unknown:
        create_bulk(
            BulkParams(
                data_path=str(people), recipient="{Ad} {Soyad}", output=str(tmp_path / "x.pdf")
            ),
            silent_progress(),
        )
    assert unknown.value.code == ErrorCode.INVALID_PARAMS
    assert unknown.value.data["reason"] == "unknownFields"
    assert unknown.value.data["names"] == "Ad, Soyad"

    empty = tmp_path / "empty.csv"
    empty.write_text("Ad\n", encoding="utf-8")
    with pytest.raises(OpError) as no_rows:
        create_bulk(
            BulkParams(data_path=str(empty), output=str(tmp_path / "x.pdf")), silent_progress()
        )
    assert no_rows.value.data["reason"] == "noRows"

    logo = tmp_path / "logo.bmp"
    logo.write_bytes(b"BM")
    with pytest.raises(OpError) as bad_logo:
        create_bulk(
            BulkParams(data_path=str(people), logo=str(logo), output=str(tmp_path / "x.pdf")),
            silent_progress(),
        )
    assert bad_logo.value.data["which"] == "logo"
    assert not (tmp_path / "x.pdf").exists()
