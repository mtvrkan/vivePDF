from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._document_structure import is_heading, plain_text_html
from vivepdf.ops.create import CreateDocumentParams, create_document
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

PLAIN = """GİRİŞ
Bu rapor yılın çalışmalarını özetler.

HEDEFLER
1. Müşteri memnuniyeti
2. Hızlı teslim

- birinci
- ikinci

Ali Veli
Atatürk Cad. 12
"""


def _spans(path: Path, page: int = 0) -> list[dict]:
    with pymupdf.open(path) as document:
        blocks = document[page].get_text("dict")["blocks"]
    return [
        span
        for block in blocks
        for line in block.get("lines", [])
        for span in line["spans"]
        if span["text"].strip()
    ]


def _text(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text() for page in document]


def _params(tmp_path: Path, **values) -> CreateDocumentParams:
    values.setdefault("output", str(tmp_path / "out.pdf"))
    return CreateDocumentParams(**values)


def test_plain_text_gets_headings_lists_and_kept_line_breaks():
    html = plain_text_html(PLAIN)

    assert "<h2>GİRİŞ</h2><p>Bu rapor yılın çalışmalarını özetler.</p>" in html.replace("\n", "")
    assert "<ol><li>Müşteri memnuniyeti</li><li>Hızlı teslim</li></ol>" in html
    assert "<ul><li>birinci</li><li>ikinci</li></ul>" in html
    assert '<p class="lines">Ali Veli<br/>Atatürk Cad. 12</p>' in html


def test_plain_text_reflows_long_lines_escapes_markup_and_keeps_list_numbering():
    long_line = "kelime " * 15
    html = plain_text_html(f"{long_line}\n{long_line}\n\n3. üçüncü\n4. dördüncü\n\n<b>&</b>")

    assert html.startswith(f"<p>{long_line.strip()} {long_line.strip()}</p>")
    assert '<ol start="3">' in html
    assert "&lt;b&gt;&amp;&lt;/b&gt;" in html


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("SONUÇ", True),
        ("1. GİRİŞ", True),
        ("Giriş", False),
        ("ABC.", False),
        ("12", False),
        ("X", False),
    ],
)
def test_heading_detection(line: str, expected: bool):
    assert is_heading(line) is expected


def test_report_from_plain_text_has_title_header_footer_and_numbers(tmp_path: Path):
    params = _params(
        tmp_path,
        text=PLAIN,
        title="Yıllık Rapor",
        author="Ayşe",
        date="3 Ekim 2026",
        header="Şirket",
        footer="Gizli",
    )

    result = create_document(params, silent_progress())

    assert result.page_count == 1
    spans = _spans(Path(result.output))
    by_text = {span["text"].strip(): span for span in spans}
    assert (
        by_text["Yıllık Rapor"]["size"]
        > by_text["GİRİŞ"]["size"]
        > by_text["Bu rapor yılın çalışmalarını özetler."]["size"]
    )
    assert {"Şirket", "Gizli", "1 / 1"} <= set(by_text)
    with pymupdf.open(result.output) as document:
        assert document.metadata["title"] == "Yıllık Rapor"
        assert document.metadata["author"] == "Ayşe"


def test_markdown_file_is_laid_out_as_markdown_with_the_chosen_font(tmp_path: Path):
    source = tmp_path / "notes.md"
    source.write_text(
        "# Başlık\n\n**kalın** metin\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", encoding="utf-8"
    )

    result = create_document(
        _params(
            tmp_path, path=str(source), template="lectureNotes", font="serif", page_numbers=False
        ),
        silent_progress(),
    )

    spans = _spans(Path(result.output))
    assert any(span["text"].strip() == "kalın" and "Bold" in span["font"] for span in spans)
    assert all("Charis" in span["font"] for span in spans)
    assert "1 / 1" not in _text(Path(result.output))[0]


def test_booklet_starts_with_a_cover_and_numbers_the_pages_after_it(tmp_path: Path):
    params = _params(
        tmp_path,
        text="# Bölüm bir\n\nmetin\n\n# Bölüm iki\n\nmetin",
        template="booklet",
        title="Kitapçık",
        paper="a5",
        page_number_format="Sayfa {page}/{total}",
    )

    result = create_document(params, silent_progress())

    pages = _text(Path(result.output))
    assert result.page_count == 3
    assert "Kitapçık" in pages[0] and "Sayfa" not in pages[0]
    assert "Bölüm bir" in pages[1] and "Sayfa 1/2" in pages[1]
    assert "Bölüm iki" in pages[2] and "Sayfa 2/2" in pages[2]
    with pymupdf.open(result.output) as document:
        assert round(document[0].rect.width) == round(pymupdf.paper_rect("a5").width)


def test_minutes_list_every_signer_and_the_logo_is_placed(tmp_path: Path):
    logo = tmp_path / "logo.png"
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20), False)
    pixmap.set_rect(pixmap.irect, (30, 60, 120))
    pixmap.save(logo)

    result = create_document(
        _params(
            tmp_path,
            text="Toplantı yapıldı.",
            template="minutes",
            title="TUTANAK",
            author="Ali, Veli, Ayşe, Fatma",
            logo=str(logo),
        ),
        silent_progress(),
    )

    text = _text(Path(result.output))[0]
    assert all(name in text for name in ("Ali", "Veli", "Ayşe", "Fatma"))
    with pymupdf.open(result.output) as document:
        assert len(document[0].get_images()) == 1


def test_errors_for_missing_content_files_and_unsupported_types(tmp_path: Path):
    with pytest.raises(OpError) as empty:
        create_document(_params(tmp_path, text="   "), silent_progress())
    assert empty.value.code == ErrorCode.INVALID_PARAMS
    assert empty.value.data["reason"] == "noContent"

    with pytest.raises(OpError) as missing:
        create_document(_params(tmp_path, path=str(tmp_path / "yok.txt")), silent_progress())
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND

    other = tmp_path / "table.csv"
    other.write_text("a,b", encoding="utf-8")
    with pytest.raises(OpError) as unsupported:
        create_document(_params(tmp_path, path=str(other)), silent_progress())
    assert unsupported.value.data["reason"] == "unsupportedType"

    logo = tmp_path / "logo.gif"
    logo.write_bytes(b"GIF89a")
    with pytest.raises(OpError) as bad_logo:
        create_document(_params(tmp_path, text="metin", logo=str(logo)), silent_progress())
    assert bad_logo.value.data == {"reason": "unsupportedType", "extension": "gif", "which": "logo"}


def test_existing_output_is_not_overwritten_without_permission(tmp_path: Path):
    output = tmp_path / "out.pdf"
    output.write_bytes(b"old")

    with pytest.raises(OpError) as taken:
        create_document(_params(tmp_path, text="metin"), silent_progress())

    assert taken.value.data["exists"] is True
    assert output.read_bytes() == b"old"
