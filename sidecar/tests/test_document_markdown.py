import base64
from pathlib import Path

import pytest

from vivepdf.ops._document_markdown import document_markdown
from vivepdf.ops._studio_document_models import (
    StudioDocumentContent,
    StudioDocumentMarkdownParams,
)
from vivepdf.ops.studio_document import (
    StudioDocumentOpenParams,
    export_markdown,
    import_document,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

PIXEL = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()


def _markdown(body: str, **extra) -> str:
    return document_markdown(StudioDocumentContent.model_validate({"html": body, **extra}))


def test_blocks_and_marks_become_markdown() -> None:
    body = (
        '<h1 id="h-1">Report</h1><p>Plain <strong>bold</strong> <em>slanted </em>'
        "<s>gone</s> <u>under</u> H<sub>2</sub>O x<sup>2</sup> <code>a`b</code> "
        '<a href="https://example.org/a b">site</a></p>'
        '<blockquote><p>Quoted</p></blockquote><pre><code>print("```")\n</code></pre><hr>'
        '<h2 id="h-2">Lists</h2><ul><li><p>One</p><ul><li><p>Inner</p></li></ul></li>'
        '<li><p>Two</p></li></ul><ol start="3"><li><p>Third</p></li></ol>'
        '<ul class="tasks"><li><p>☑ Done</p></li><li><p>☐ Open</p></li></ul>'
    )

    written = _markdown(body)

    assert written == (
        "# Report\n\n"
        "Plain **bold** *slanted* ~~gone~~ <u>under</u> H<sub>2</sub>O x<sup>2</sup> "
        "``a`b`` [site](<https://example.org/a%20b>)\n\n"
        "> Quoted\n\n"
        '````\nprint("```")\n````\n\n'
        "---\n\n"
        "## Lists\n\n"
        "- One\n  - Inner\n- Two\n\n"
        "3. Third\n\n"
        "- [x] Done\n- [ ] Open\n"
    )


def test_tables_pictures_breaks_and_notes() -> None:
    body = (
        "<table><tr><th>Name</th><th>Note</th></tr>"
        '<tr><td colspan="2"><p>a | b</p><p>line</p></td></tr></table>'
        '<p style="text-align:center"><img src="vpimg-0" alt="A [chart]"></p>'
        '<p>Claim<sup class="fn-ref" id="fnref-1">1</sup> more'
        '<sup class="fn-ref" id="fnref-2">2</sup><br>next</p>'
        '<div class="page-break"></div><div class="section-break" data-columns="2"></div>'
        '<p>&nbsp;</p><p><img src="vpimg-9"><img src="vpimg-1"></p>'
    )

    written = _markdown(
        body,
        images=[PIXEL, "https://example.org/remote.png"],
        footnotes=["See *this*", "Bold note"],
        footnoteHtml=["", "<b>Bold</b> note"],
    )

    assert written == (
        "| Name | Note |\n| --- | --- |\n| a \\| b<br>line |  |\n\n"
        f"![A \\[chart\\]]({PIXEL})\n\n"
        "Claim[^1] more[^2]\\\nnext\n\n"
        "[^1]: See \\*this\\*\n[^2]: **Bold** note\n"
    )


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("<p>1. not a list</p>", "1\\. not a list\n"),
        ("<p># not a heading</p>", "\\# not a heading\n"),
        ("<p>- dash<br>+ plus</p>", "\\- dash\\\n\\+ plus\n"),
        ("<p>snake_case &amp;copy; &lt;tag&gt;</p>", "snake\\_case \\&copy; \\<tag\\>\n"),
        ('<p>a<sup class="fn-ref" id="fnref-7">7</sup></p>', "a\n"),
        ("", "\n"),
    ],
)
def test_text_that_looks_like_markdown_is_escaped(body: str, expected: str) -> None:
    assert _markdown(body) == expected


def test_export_writes_a_markdown_file_that_imports_back(tmp_path: Path) -> None:
    body = (
        '<h1 id="h-1">Talk</h1><p>A <strong>bold</strong> claim'
        '<sup class="fn-ref" id="fnref-1">1</sup> and <s>old</s> text.</p>'
        "<table><tr><th>A</th><th>B</th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table>"
    )
    params = StudioDocumentMarkdownParams.model_validate(
        {
            "html": body,
            "footnotes": ["Source note"],
            "footnoteHtml": ["<i>Source</i> note"],
            "output": str(tmp_path / "talk.markdown"),
        }
    )

    result = export_markdown(params, silent_progress())
    imported = import_document(StudioDocumentOpenParams(path=result.output), silent_progress())

    assert result.output.endswith("talk.md")
    assert result.bytes == Path(result.output).stat().st_size
    assert imported.title == "Talk"
    assert "<strong>bold</strong>" in imported.html and "<s>old</s>" in imported.html
    assert "<th>A</th>" in imported.html and "<td>2</td>" in imported.html
    assert 'data-footnote="Source note"' in imported.html
    assert 'data-footnote-html="&lt;em&gt;Source&lt;/em&gt; note"' in imported.html


def test_export_refuses_to_overwrite_without_permission(tmp_path: Path) -> None:
    target = tmp_path / "talk.md"
    target.write_text("keep", "utf-8")
    params = StudioDocumentMarkdownParams.model_validate(
        {"html": "<p>x</p>", "output": str(target)}
    )

    with pytest.raises(OpError) as caught:
        export_markdown(params, silent_progress())

    assert caught.value.data["exists"] is True
    assert target.read_text("utf-8") == "keep"


def test_note_breaks_pictures_and_cited_labels_export_and_import_back(tmp_path: Path) -> None:
    logo = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nlogo").decode()
    body = '<p>Claim<sup class="fn-ref" id="fnref-1">1</sup>.</p>'
    params = StudioDocumentMarkdownParams.model_validate(
        {
            "html": body,
            "images": [logo],
            "footnotes": ["See (Smith, 2020)\n2. edition"],
            "footnoteHtml": [
                'See <b>(Smith, 2020)</b> <img src="vpimg-0" alt="Logo"><br>2. edition'
            ],
            "output": str(tmp_path / "notes.md"),
        }
    )

    written = document_markdown(params)
    result = export_markdown(params, silent_progress())
    imported = import_document(StudioDocumentOpenParams(path=result.output), silent_progress())

    assert f"[^1]: See **(Smith, 2020)** ![Logo]({logo})\\\n    2\\. edition" in written
    assert "&lt;br&gt;" in imported.html
    assert f"&lt;img src=&quot;{logo}&quot; alt=&quot;Logo&quot;&gt;" in imported.html


def test_plain_note_breaks_reach_the_markdown_and_unknown_pictures_do_not() -> None:
    written = _markdown(
        '<p>a<sup class="fn-ref" id="fnref-1">1</sup></p>',
        footnotes=["first\nsecond"],
        footnoteHtml=['<img src="vpimg-4">'],
    )

    assert "[^1]: first\\\n    second" in written
    assert "![" not in written
