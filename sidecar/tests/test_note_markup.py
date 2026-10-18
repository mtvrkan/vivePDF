import base64
import io
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops._note_markup import (
    MAX_NOTE_LINES,
    MAX_NOTE_PICTURE_CHARS,
    MAX_NOTE_PICTURES,
    archived_pictures,
    inline_html,
    note_body,
)
from vivepdf.ops._studio_document_models import (
    MAX_FOOTNOTE_HTML_CHARS,
    StudioDocumentRenderParams,
)
from vivepdf.ops.studio_document import render_document
from vivepdf.rpc.progress import silent_progress

FORMATTED = (
    "<strong>Bold</strong> and <em>slanted</em> <script>evil()</script>"
    '<a href="javascript:steal()" onclick="x">trap</a> '
    '<a href="https://example.org" style="color:red">site</a>'
)


def _picture_url(kind: str = "PNG", size: tuple[int, int] = (40, 20)) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", size, (220, 0, 0)).save(buffer, format=kind)
    mime = "jpeg" if kind == "JPEG" else kind.lower()
    return f"data:image/{mime};base64,{base64.b64encode(buffer.getvalue()).decode()}"


def _marker(number: int) -> str:
    return f'<sup class="fn-ref" id="fnref-{number}">{number}</sup>'


def _render(tmp_path: Path, body: str, **extra) -> pymupdf.Document:
    payload = {"html": body, "output": str(tmp_path / "out.pdf"), "title": "Notes"}
    payload.update(extra)
    result = render_document(StudioDocumentRenderParams.model_validate(payload), silent_progress())
    return pymupdf.open(result.output)


def _spans(document: pymupdf.Document, word: str) -> list[dict]:
    return [
        span
        for page in document
        for block in page.get_text("dict")["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
        if word in span["text"]
    ]


def test_inline_marks_and_safe_links_are_kept() -> None:
    cleaned = inline_html(FORMATTED)

    assert cleaned == (
        '<strong>Bold</strong> and <em>slanted</em> trap <a href="https://example.org">site</a>'
    )


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("<p>one</p><p>two <u>three</u></p>", "one two <u>three</u>"),
        ("x<sub>2</sub> y<sup>n</sup> <s>old</s> <code>a&lt;b</code>", None),
        ('<img src="x.png" onerror="boom()">after', "after"),
        ("<style>p{color:red}</style><!-- hidden --><b>ok</b>", "<b>ok</b>"),
        ('<a href="mailto:a@example.org">mail</a>', '<a href="mailto:a@example.org">mail</a>'),
        ('<a href="file:///etc/passwd">local</a>', "local"),
        ('<span class="c">run</span>in', "runin"),
        ("plain &amp; <i>simple</i>\x00", "plain &amp; <i>simple</i>"),
    ],
)
def test_everything_outside_the_allowlist_is_unwrapped_or_dropped(
    source: str, expected: str | None
) -> None:
    assert inline_html(source) == (source if expected is None else expected)


def test_empty_or_unreadable_markup_falls_back_to_the_plain_text() -> None:
    assert inline_html("   ") == ""
    assert note_body("a < b", "") == "a &lt; b"
    assert note_body("a < b", "<script>x</script>") == "a &lt; b"
    assert note_body("plain", "<b>bold</b>") == "<b>bold</b>"


def test_formatted_footnotes_are_drawn_with_their_marks(tmp_path: Path) -> None:
    body = f"<p>Claim{_marker(1)} and another{_marker(2)}</p>"
    notes = ["Bold and slanted trap site", "Plain second"]

    with _render(tmp_path, body, footnotes=notes, footnoteHtml=[FORMATTED]) as document:
        text = document[0].get_text()
        bold = _spans(document, "Bold")
        plain = _spans(document, "Plain second")
        uris = [link["uri"] for link in document[0].get_links() if link["kind"] == pymupdf.LINK_URI]

    assert "Bold and slanted" in text and "Plain second" in text
    assert "evil" not in text
    assert any(span["flags"] & pymupdf.TEXT_FONT_BOLD for span in bold)
    assert not any(span["flags"] & pymupdf.TEXT_FONT_BOLD for span in plain)
    assert "javascript:steal()" not in uris


def test_formatted_endnotes_keep_their_marks(tmp_path: Path) -> None:
    body = f"<p>Short{_marker(1)}</p>"
    notes = ["Long " + "explanation " * 160]
    markup = ["<b>Long</b> " + "explanation " * 160]

    with _render(
        tmp_path,
        body,
        footnotes=notes,
        footnoteHtml=markup,
        notesTitle="Endnotes",
        settings={"fontSize": 20},
    ) as document:
        text = "".join(page.get_text() for page in document)
        bold = _spans(document, "Long")

    assert "Endnotes" in text
    assert any(span["flags"] & pymupdf.TEXT_FONT_BOLD for span in bold)


def test_overlong_markup_is_refused() -> None:
    with pytest.raises(ValueError):
        StudioDocumentRenderParams.model_validate(
            {
                "html": "<p>x</p>",
                "output": "out.pdf",
                "footnotes": ["n"],
                "footnoteHtml": ["b" * (MAX_FOOTNOTE_HTML_CHARS + 1)],
            }
        )


def test_line_breaks_are_kept_tidied_and_capped() -> None:
    many = "<br>".join(str(line) for line in range(30))

    assert inline_html("one <br/> two<br><br>") == "one<br>two"
    assert inline_html(many).count("<br>") == MAX_NOTE_LINES - 1
    assert note_body("first\n  second \n", "") == "first<br>second"
    assert note_body("\n".join("x" * 30), "").count("<br>") == MAX_NOTE_LINES - 1


def test_pictures_must_be_archived_raster_images_within_limits() -> None:
    images = [
        _picture_url(),
        "data:image/bmp;base64,Qk0=",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64," + "A" * MAX_NOTE_PICTURE_CHARS,
    ]
    picture = archived_pictures(images)
    tags = "".join(f'<img src="vpimg-{index}" alt="P{index}" onload="x()">' for index in range(5))
    remote = '<img src="https://example.org/logo.png">'
    inline = f'<img src="{images[0]}">'

    assert inline_html(f"a{tags}{remote}{inline}b", picture) == 'a<img src="vpimg-0" alt="P0">b'
    assert inline_html('<img src="vpimg-0">', None) == ""
    assert inline_html('<img src="vpimg-0">' * 9, picture).count("<img") == MAX_NOTE_PICTURES


def test_footnote_pictures_and_breaks_are_drawn_at_the_page_foot(tmp_path: Path) -> None:
    body = f"<p>Claim{_marker(1)}</p>"
    markup = ['Logo <img src="vpimg-0" alt="Mark"> here<br>Second line']

    with _render(
        tmp_path, body, footnotes=["Logo here"], footnoteHtml=markup, images=[_picture_url()]
    ) as document:
        page = document[0]
        pictures = [pymupdf.Rect(info["bbox"]) for info in page.get_image_info()]
        first = _spans(document, "Logo")[0]["bbox"]
        second = _spans(document, "Second line")[0]["bbox"]
        pixmap = page.get_pixmap(clip=pictures[0], dpi=144) if pictures else None
        height = page.rect.height

    assert len(pictures) == 1
    assert pictures[0].y0 > height / 2
    assert pictures[0].height == pytest.approx(11 * 0.8 * 1.2, abs=0.6)
    assert pictures[0].width == pytest.approx(pictures[0].height * 2, abs=1)
    assert pixmap is not None
    red, green, blue = pixmap.pixel(pixmap.width // 2, pixmap.height // 2)[:3]
    assert red > 180 and green < 60 and blue < 60
    assert second[1] > first[3] - 1


def test_a_picture_in_a_note_moved_to_the_endnotes_is_still_drawn(tmp_path: Path) -> None:
    body = f"<p>Short{_marker(1)}</p>"
    markup = ['<img src="vpimg-0" alt="Mark"> ' + "explanation " * 160]

    with _render(
        tmp_path,
        body,
        footnotes=["explanation " * 160],
        footnoteHtml=markup,
        images=[_picture_url("JPEG")],
        notesTitle="Endnotes",
        settings={"fontSize": 20},
    ) as document:
        text = "".join(page.get_text() for page in document)
        pictures = [info for page in document for info in page.get_image_info()]

    assert "Endnotes" in text
    assert len(pictures) == 1
    assert pymupdf.Rect(pictures[0]["bbox"]).height == pytest.approx(20 * 0.8 * 1.2, abs=1)


def test_a_footnote_picture_without_a_valid_archive_entry_is_left_out(tmp_path: Path) -> None:
    body = f"<p>Claim{_marker(1)}</p>"
    markup = ['Kept <img src="vpimg-3"> <img src="https://example.org/x.png">text']

    with _render(tmp_path, body, footnotes=["Kept text"], footnoteHtml=markup) as document:
        text = document[0].get_text()
        pictures = document[0].get_image_info()

    assert "Kept" in text and "text" in text
    assert pictures == []
