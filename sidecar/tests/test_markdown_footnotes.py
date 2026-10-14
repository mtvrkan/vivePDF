import html
import re
from pathlib import Path

import pytest

from vivepdf.ops._markdown_footnotes import split_definitions, with_footnotes
from vivepdf.ops._studio_document_models import MAX_FOOTNOTE_CHARS, MAX_FOOTNOTES
from vivepdf.ops.studio_document import StudioDocumentOpenParams, import_document
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

NOTE = re.compile(r'<sup data-footnote="([^"]*)"></sup>')


def _import(tmp_path: Path, text: str, name: str = "talk.md"):
    source = tmp_path / name
    source.write_text(text, "utf-8")
    return import_document(StudioDocumentOpenParams(path=str(source)), silent_progress())


def _notes(body: str) -> list[str]:
    return [html.unescape(found) for found in NOTE.findall(body)]


def test_markdown_footnotes_become_footnote_nodes(tmp_path: Path):
    result = _import(
        tmp_path,
        "# Talk\n\nFirst claim[^a] and second[^Big-Note].\n\n"
        "[^a]: A *plain* note\n  that continues.\n\n    A second paragraph.\n"
        "[^big-note]: Labels ignore case.\n\nAfter the notes.\n",
    )

    assert _notes(result.html) == [
        "A plain note that continues. A second paragraph.",
        "Labels ignore case.",
    ]
    assert "[^" not in result.html
    assert "After the notes." in result.html
    assert "continues" not in NOTE.sub("", result.html)


def test_references_in_code_stay_literal(tmp_path: Path):
    result = _import(
        tmp_path,
        "Use `x[^1]` here[^1].\n\n```\nlist[^1]\n[^2]: not a note\n```\n\n[^1]: Real note.\n",
    )

    assert _notes(result.html) == ["Real note."]
    assert "<code>x[^1]</code>" in result.html
    assert "list[^1]" in result.html
    assert "[^2]: not a note" in result.html


def test_undefined_references_stay_and_unused_definitions_go(tmp_path: Path):
    result = _import(tmp_path, "Missing[^x] note.\n\n[^unused]: Nobody points here.\n")

    assert _notes(result.html) == []
    assert "Missing[^x] note." in result.html
    assert "Nobody points here" not in result.html


def test_a_repeated_label_gives_each_reference_its_note(tmp_path: Path):
    result = _import(tmp_path, "One[^n], two[^n].\n\n[^n]: Shared.\n[^n]: Ignored second.\n")

    assert _notes(result.html) == ["Shared.", "Shared."]


def test_a_definition_is_not_read_as_a_link_definition():
    text, notes = split_definitions("Text[^1].\n\n[^1]: word\n")

    assert notes == {"1": "word"}
    assert "[^1]:" not in text
    written = with_footnotes("<p>Text[^1].</p>", notes)
    assert written == '<p>Text<sup data-footnote="word"></sup>.</p>'


def test_long_notes_are_cut_and_references_stop_at_the_limit():
    _, notes = split_definitions(f"[^long]: {'a' * (MAX_FOOTNOTE_CHARS + 50)}\n")
    assert len(notes["long"]) == MAX_FOOTNOTE_CHARS

    body = with_footnotes("<p>" + "x[^n]" * (MAX_FOOTNOTES + 2) + "</p>", {"n": "note"})
    assert body.count("data-footnote") == MAX_FOOTNOTES
    assert body.count("[^n]") == 2


def test_attribute_text_is_escaped():
    body = with_footnotes("<p>a[^q]</p>", {"q": 'say "hi" <b>'})

    assert 'data-footnote="say &quot;hi&quot; &lt;b&gt;"' in body


def test_unsupported_imports_are_still_refused(tmp_path: Path):
    source = tmp_path / "talk.rtf"
    source.write_text("[^1]: note", "utf-8")

    with pytest.raises(OpError) as caught:
        import_document(StudioDocumentOpenParams(path=str(source)), silent_progress())

    assert caught.value.data["reason"] == "unsupportedType"
