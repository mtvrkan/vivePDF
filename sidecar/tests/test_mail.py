import io
import struct
from email.message import EmailMessage
from pathlib import Path

import pymupdf
import pytest
from compound_file import write_compound_file
from PIL import Image

from vivepdf.ops._mail import MailLabels, read_msg
from vivepdf.ops.convert_to_pdf import FileToPdfParams, file_to_pdf
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

PT_SYSTIME = 0x0040


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 20), (200, 30, 30)).save(buffer, "PNG")
    return buffer.getvalue()


def _utf16(text: str) -> bytes:
    return text.encode("utf-16-le")


def _convert(source: Path, tmp_path: Path, **fields) -> Path:
    result = file_to_pdf(
        FileToPdfParams(path=str(source), output=str(tmp_path / "mail.pdf"), **fields),
        silent_progress(),
    )
    return Path(result.output)


@pytest.fixture
def html_eml(tmp_path: Path) -> Path:
    message = EmailMessage()
    message["Subject"] = "Toplantı notları"
    message["From"] = "Ayşe Demir <ayse@example.com>"
    message["To"] = "Ekip <ekip@example.com>"
    message["Date"] = "Fri, 02 Oct 2026 10:30:00 +0300"
    message.set_content("Düz metin sürümü")
    message.add_alternative(
        "<html><head><style>p{color:red}</style><script>alert(1)</script></head><body>"
        '<p>Merhaba, <b>gündem</b> ekte.</p><img src="cid:logo@x"/>'
        '<img src="https://tracker.example/pixel.gif"/></body></html>',
        subtype="html",
    )
    message.get_payload()[1].add_related(
        _png(), "image", "png", cid="<logo@x>", filename="logo.png"
    )
    message.add_attachment(b"line one\n", maintype="text", subtype="plain", filename="gundem.txt")
    path = tmp_path / "notes.eml"
    path.write_bytes(bytes(message))
    return path


def test_html_eml_becomes_a_pdf_with_headers_inline_picture_and_embedded_attachment(
    tmp_path: Path, html_eml: Path
):
    labels = MailLabels(sender="Kimden", to="Kime", cc="Bilgi", date="Tarih", attachments="Ekler")

    output = _convert(html_eml, tmp_path, mail_labels=labels)

    with pymupdf.open(output) as document:
        text = document[0].get_text()
        assert "Toplantı notları" in text
        assert "Kimden" in text and "Ayşe Demir" in text
        assert "Merhaba," in text and "gündem" in text
        assert "alert" not in text and "color:red" not in text
        assert "Ekler" in text and "gundem.txt" in text
        assert len(document[0].get_images()) == 1
        assert document.embfile_names() == ["gundem.txt"]
        assert document.embfile_get("gundem.txt") == b"line one\n"
        assert document.metadata["title"] == "Toplantı notları"


def test_plain_eml_keeps_its_line_breaks(tmp_path: Path):
    message = EmailMessage()
    message["Subject"] = "Plain"
    message["From"] = "a@example.com"
    message.set_content("First line\nSecond line")
    source = tmp_path / "plain.eml"
    source.write_bytes(bytes(message))

    output = _convert(source, tmp_path)

    with pymupdf.open(output) as document:
        lines = [line.strip() for line in document[0].get_text().splitlines()]
        assert "First line" in lines and "Second line" in lines
        assert "From a@example.com" in lines
        assert document.embfile_count() == 0


def _properties(submit_ticks: int) -> bytes:
    header = b"\0" * 32
    tag = (0x0039 << 16) | PT_SYSTIME
    return header + struct.pack("<IIQ", tag, 6, submit_ticks)


@pytest.fixture
def outlook_msg(tmp_path: Path) -> Path:
    html = (
        b'<html><head><meta charset="utf-8"></head><body><p>Rapor ekte, '
        b'g\xc3\xbczel g\xc3\xbcnler.</p><img src="cid:chart@1"></body></html>'
    )
    tree = {
        "__substg1.0_0037001F": _utf16("Çeyrek raporu"),
        "__substg1.0_0C1A001F": _utf16("Mehmet Kaya"),
        "__substg1.0_5D01001F": _utf16("mehmet@example.com"),
        "__substg1.0_0E04001F": _utf16("Ayşe Demir"),
        "__substg1.0_1000001F": _utf16("Rapor ekte."),
        "__substg1.0_10130102": html,
        "__properties_version1.0": _properties(134_038_000_000_000_000),
        "__attach_version1.0_#00000000": {
            "__substg1.0_3707001F": _utf16("rapor.csv"),
            "__substg1.0_37010102": b"a;b\n" * 1500,
        },
        "__attach_version1.0_#00000001": {
            "__substg1.0_3707001F": _utf16("chart.png"),
            "__substg1.0_37010102": _png(),
            "__substg1.0_3712001F": _utf16("chart@1"),
        },
    }
    path = tmp_path / "report.msg"
    write_compound_file(path, tree)
    return path


def test_outlook_msg_is_read_with_sender_date_body_and_attachments(outlook_msg: Path):
    message = read_msg(outlook_msg)

    assert message.subject == "Çeyrek raporu"
    assert message.sender == "Mehmet Kaya <mehmet@example.com>"
    assert message.to == "Ayşe Demir"
    assert "2025" in message.date
    assert "güzel günler" in message.html_body
    assert [item.name for item in message.attachments] == ["rapor.csv", "chart.png"]
    assert message.attachments[0].data == b"a;b\n" * 1500
    assert message.attachments[1].content_id == "chart@1"


def test_outlook_msg_converts_with_the_inline_chart_and_the_csv_attached(
    tmp_path: Path, outlook_msg: Path
):
    output = _convert(outlook_msg, tmp_path)

    with pymupdf.open(output) as document:
        text = document[0].get_text()
        assert "Çeyrek raporu" in text and "güzel günler" in text
        assert len(document[0].get_images()) == 1
        assert document.embfile_names() == ["rapor.csv"]


def test_a_msg_that_is_not_an_outlook_file_is_reported(tmp_path: Path):
    source = tmp_path / "broken.msg"
    source.write_bytes(b"not an outlook message")

    with pytest.raises(OpError) as error:
        _convert(source, tmp_path)

    assert error.value.data["reason"] == "fileUnreadable"
    assert not (tmp_path / "mail.pdf").exists()


def test_merge_turns_an_eml_input_into_pages_with_the_given_labels(
    tmp_path: Path, html_eml: Path, sample_pdf: Path
):
    from vivepdf.ops.merge_split import MergeInput, MergeParams, merge

    params = MergeParams(
        inputs=[MergeInput(path=str(sample_pdf)), MergeInput(path=str(html_eml))],
        output=str(tmp_path / "merged.pdf"),
        mail_labels=MailLabels(sender="Kimden"),
    )

    result = merge(params, silent_progress())

    with pymupdf.open(result.output) as document:
        with pymupdf.open(sample_pdf) as first:
            mail_page = document[first.page_count]
        assert "Kimden" in mail_page.get_text()
        assert "Toplantı notları" in mail_page.get_text()
