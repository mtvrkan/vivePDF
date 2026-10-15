from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._note_markup import inline_html, note_body
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
