import unicodedata
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.create_cv import CreateCvParams, CvEntry, CvLabels, CvSection, create_cv
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _params(folder: Path, **update) -> CreateCvParams:
    values = {
        "name": "Deniz Kaya",
        "headline": "Data Engineer",
        "contacts": ["deniz@example.com", "+90 555 000 00 00", "github.com/deniz", ""],
        "summary": "Builds data pipelines.",
        "experience": [
            CvEntry(
                title="Data Engineer",
                organisation="Acme",
                location="Izmir",
                period="2022 – now",
                details="- Built the warehouse\n- Cut costs by 30%",
            ),
            CvEntry(),
        ],
        "education": [
            CvEntry(title="BSc Statistics", organisation="Ege University", period="2018")
        ],
        "skills": ["Python", "SQL", " "],
        "languages": ["Turkish", "English (C1)"],
        "sections": [CvSection(heading="Certificates", body="dbt Fundamentals"), CvSection()],
        "labels": CvLabels(experience="Deneyim", education="Eğitim"),
        "output": str(folder / "cv.pdf"),
    }
    values.update(update)
    return CreateCvParams(**values)


@pytest.mark.parametrize("template", ["classic", "modern", "compact"])
def test_every_template_lays_out_the_whole_cv_on_one_page(tmp_path: Path, template: str):
    photo = tmp_path / "me.png"
    Image.new("RGB", (300, 400), (120, 90, 80)).save(photo)

    result = create_cv(_params(tmp_path, template=template, photo=str(photo)), silent_progress())

    with pymupdf.open(result.output) as document:
        assert document.page_count == 1
        text = unicodedata.normalize("NFKC", document[0].get_text())
        for expected in (
            "Deniz Kaya",
            "Deneyim",
            "Eğitim",
            "Built the warehouse",
            "2022 – now",
            "Ege University",
            "English (C1)",
            "Certificates",
            "dbt Fundamentals",
        ):
            assert expected in text
        assert document[0].get_images()
        uris = {link.get("uri") for link in document[0].get_links()}
        assert {"mailto:deniz@example.com", "https://github.com/deniz"} <= uris
        assert document.metadata["title"] == "Deniz Kaya"
        assert document.metadata["subject"] == "Data Engineer"


def test_modern_template_draws_the_sidebar_in_the_accent_colour(tmp_path: Path):
    result = create_cv(_params(tmp_path, template="modern", accent="#aa2200"), silent_progress())

    with pymupdf.open(result.output) as document:
        page = document[0]
        fills = [drawing["fill"] for drawing in page.get_drawings() if drawing.get("fill")]
        assert any(abs(fill[0] - 0xAA / 255) < 0.01 and fill[2] < 0.01 for fill in fills)
        sidebar = pymupdf.Rect(0, 0, page.rect.width / 3, page.rect.height)
        assert "Python" in page.get_text(clip=sidebar)
        assert "Built the warehouse" not in page.get_text(clip=sidebar)


def test_long_cv_continues_on_more_pages(tmp_path: Path):
    entries = [
        CvEntry(title=f"Role {index}", organisation="Acme", details="- Did things\n" * 6)
        for index in range(25)
    ]

    result = create_cv(_params(tmp_path, experience=entries), silent_progress())

    assert result.page_count > 1


def test_cv_needs_a_name_and_a_supported_photo(tmp_path: Path):
    with pytest.raises(OpError) as unnamed:
        create_cv(_params(tmp_path, name="  "), silent_progress())
    assert unnamed.value.data["reason"] == "noName"

    with pytest.raises(OpError) as missing:
        create_cv(_params(tmp_path, photo=str(tmp_path / "gone.jpg")), silent_progress())
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND

    document = tmp_path / "photo.gif"
    document.write_bytes(b"GIF89a")
    with pytest.raises(OpError) as unsupported:
        create_cv(_params(tmp_path, photo=str(document)), silent_progress())
    assert unsupported.value.data["reason"] == "unsupportedType"
    assert not (tmp_path / "cv.pdf").exists()
