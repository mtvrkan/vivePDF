import base64
import io
import json
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops._studio_document_models import (
    StudioDocumentOpenParams,
    StudioDocumentPageParams,
    StudioDocumentPreviewParams,
    StudioDocumentRenderParams,
    StudioDocumentSaveParams,
)
from vivepdf.ops.studio_document import (
    document_image,
    import_document,
    open_studio_document,
    preview_document,
    preview_document_page,
    render_document,
    save_studio_document,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

BODY = (
    '<h1 id="h-1">Introduction</h1><p>First chapter text with <strong>bold</strong> words.</p>'
    '<h2 id="h-2">Details</h2><p style="text-align:center">Centred line</p>'
    "<table><tr><th>Name</th><th>Score</th></tr><tr><td>Ayşe</td><td>90</td></tr></table>"
    '<div class="page-break"></div>'
    '<h1 id="h-3">Results</h1><p><img src="vpimg-0" style="width:120pt"></p>'
)


def _png(colour: tuple[int, int, int, int] = (200, 30, 30, 255), size=(40, 30)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", size, colour).save(buffer, format="PNG")
    return buffer.getvalue()


def _data_url(payload: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def _render(tmp_path: Path, body: str = BODY, **extra) -> pymupdf.Document:
    payload = {
        "html": body,
        "images": [_data_url(_png())],
        "output": str(tmp_path / "out.pdf"),
        "title": "Report",
    }
    payload.update(extra)
    result = render_document(StudioDocumentRenderParams.model_validate(payload), silent_progress())
    return pymupdf.open(result.output)


def test_a_document_gets_cover_contents_numbers_and_bookmarks(tmp_path: Path):
    settings = {
        "cover": True,
        "toc": True,
        "tocTitle": "Contents",
        "title": "Annual report",
        "author": "Can",
        "pageNumberFormat": "{n} / {total}",
    }

    with _render(tmp_path, settings=settings) as document:
        texts = [page.get_text() for page in document]
        toc = document.get_toc()

    assert "Annual report" in texts[0]
    assert "Contents" in texts[1] and "Introduction" in texts[1] and "Results" in texts[1]
    assert any("Introduction" in text and "First chapter" in text for text in texts[2:])
    assert f"{len(texts)} / {len(texts)}" in texts[-1]
    assert [entry[1] for entry in toc] == ["Introduction", "Details", "Results"]
    assert [entry[0] for entry in toc] == [1, 2, 1]
    results_page = toc[2][2]
    assert "Results" in texts[results_page - 1]
    assert document_images(tmp_path) == 1


def document_images(tmp_path: Path) -> int:
    with pymupdf.open(tmp_path / "out.pdf") as document:
        return sum(len(page.get_images()) for page in document)


def test_an_untitled_cover_takes_the_first_heading(tmp_path: Path):
    with _render(tmp_path, title="", settings={"cover": True}) as document:
        cover = document[0].get_text()
        metadata = document.metadata

    assert "Introduction" in cover
    assert metadata["title"] == "Introduction"


def test_a_page_break_starts_a_new_page_and_headers_follow_the_settings(tmp_path: Path):
    settings = {
        "header": "Draft",
        "footer": "vivePDF",
        "pageNumbers": "outside",
        "furnitureOnFirst": False,
    }

    with _render(tmp_path, settings=settings) as document:
        first, second = (page.get_text() for page in document)

    assert "Introduction" in first and "Results" not in first
    assert "Results" in second
    assert "Draft" not in first and "vivePDF" not in first
    assert "Draft" in second and "vivePDF" in second and "2" in second


def test_italic_text_stays_italic_when_the_font_has_no_italic_file(tmp_path: Path):
    body = '<p>Upright <em>slanted ğş</em></p><p style="font-family:f1"><em>serif slant</em></p>'

    with _render(tmp_path, body=body, fonts=["bundled:dejavu-sans", "library:lora"]) as document:
        spans = [
            span
            for block in document[0].get_text("dict")["blocks"]
            for line in block.get("lines", [])
            for span in line["spans"]
        ]

    fonts = {span["text"].strip(): span["font"] for span in spans}
    assert "Italic" in fonts["slanted ğş"] and "Sans" in fonts["slanted ğş"]
    assert "Italic" in fonts["serif slant"] and "Roman" in fonts["serif slant"]


def test_landscape_paper_and_margins_set_the_page_size(tmp_path: Path):
    with _render(tmp_path, settings={"paper": "a5", "landscape": True}) as document:
        rect = document[0].rect

    assert rect.width == pytest.approx(pymupdf.paper_rect("a5").height)
    assert rect.width > rect.height


def _line_box(document: pymupdf.Document, text: str) -> pymupdf.Rect:
    return document[0].search_for(text)[0]


def test_paragraph_spacing_moves_and_indents_the_lines_it_belongs_to(tmp_path: Path):
    plain = "<p>Alpha line</p><p>Beta line</p><p>Gamma words</p>"
    spaced = (
        "<p>Alpha line</p>"
        '<p style="margin-top:36pt;text-indent:36pt">Beta line</p>'
        "<p>Gamma words</p>"
    )

    with _render(tmp_path / "plain", plain) as document:
        before = _line_box(document, "Beta"), _line_box(document, "Gamma")
    with _render(tmp_path / "spaced", spaced) as document:
        after = _line_box(document, "Beta"), _line_box(document, "Gamma")

    assert after[0].y0 - before[0].y0 == pytest.approx(36 - 11 * 0.6, abs=1)
    assert after[0].x0 - before[0].x0 == pytest.approx(36, abs=1)
    assert after[1].x0 == pytest.approx(before[1].x0, abs=1)


def test_a_paragraph_line_height_spreads_only_its_own_lines(tmp_path: Path):
    words = " ".join(["word"] * 120)
    body = f'<p style="line-height:2">{words}</p><p>{words}</p>'

    with _render(tmp_path, body) as document:
        lines = sorted({round(block[1]) for block in document[0].get_text("words")})

    gaps = [low - high for high, low in zip(lines, lines[1:], strict=False)]
    assert max(gaps) > min(gaps) * 1.6


def _filler(words: int) -> str:
    return "<p>" + " ".join(f"word{index}" for index in range(words)) + "</p>"


def _body_words(page: pymupdf.Page) -> list:
    bottom = page.rect.height - 20 * 72 / 25.4
    return [word for word in page.get_text("words") if word[3] <= bottom]


def test_two_columns_fill_the_left_column_before_the_right(tmp_path: Path):
    with _render(tmp_path, _filler(900), settings={"columns": 2, "columnGapMm": 10}) as document:
        page = document[0]
        middle = page.rect.width / 2
        words = _body_words(page)
        left = [word for word in words if word[2] < middle]
        right = [word for word in words if word[0] > middle]

    assert left and right
    assert not [word for word in words if word[0] < middle < word[2]]
    assert int(left[-1][4][4:]) < int(right[0][4][4:])


def test_three_columns_start_where_the_gap_leaves_them(tmp_path: Path):
    settings = {"columns": 3, "columnGapMm": 8, "marginMm": 20}

    with _render(tmp_path, _filler(1500), settings=settings) as document:
        starts = sorted({round(word[0]) for word in _body_words(document[0])})

    margin = 20 * 72 / 25.4
    gap = 8 * 72 / 25.4
    column = (pymupdf.paper_rect("a4").width - 2 * margin - 2 * gap) / 3
    first = starts[0]
    for index in (1, 2):
        expected = first + index * (column + gap)
        assert min(abs(start - expected) for start in starts) < 1.5


def test_a_page_break_in_columns_starts_a_new_page(tmp_path: Path):
    body = '<p>First page</p><div class="page-break"></div><p>Second page</p>'

    with _render(tmp_path, body, settings={"columns": 2}) as document:
        pages = [page.get_text() for page in document]

    assert len(pages) == 2
    assert "First page" in pages[0]
    assert "Second page" in pages[1]


def test_the_contents_stay_full_width_above_a_two_column_body(tmp_path: Path):
    body = "".join(f'<h1 id="h-{index}">Chapter {index}</h1>{_filler(80)}' for index in range(1, 4))
    settings = {"columns": 2, "toc": True, "tocTitle": "Contents"}

    with _render(tmp_path, body, settings=settings) as document:
        contents = document[0]
        number = contents.search_for("Chapter 1")[0]
        rows = [word for word in _body_words(contents) if word[1] >= number.y0 - 1]
        body_page = document[1]
        middle = body_page.rect.width / 2
        right = [word for word in _body_words(body_page) if word[0] > middle]
        width = contents.rect.width
        body_text = body_page.get_text()

    assert max(word[2] for word in rows) > width * 0.75
    assert "Chapter 1" in body_text
    assert right


def test_more_than_three_columns_are_refused():
    with pytest.raises(ValueError):
        StudioDocumentRenderParams.model_validate(
            {"html": "<p>x</p>", "output": "out.pdf", "settings": {"columns": 4}}
        )


def _marker(number: int) -> str:
    return f'<sup class="fn-ref" id="fnref-{number}">{number}</sup>'


def _page_with(document: pymupdf.Document, text: str) -> int:
    return next(page.number for page in document if page.search_for(text))


def test_a_footnote_sits_at_the_bottom_of_the_page_its_marker_is_on(tmp_path: Path):
    body = f"<p>Opening words{_marker(1)}</p>{_filler(500)}<p>Late words{_marker(2)}</p>"
    notes = ["First explanation", "Second explanation"]

    with _render(tmp_path, body, footnotes=notes) as document:
        first_page, second_page, late_page = (
            _page_with(document, text) for text in (*notes, "Late words")
        )
        note = document[first_page].search_for("First explanation")[0]
        height = document[first_page].rect.height
        body_bottom = max(
            word[3] for word in document[first_page].get_text("words") if word[4].startswith("word")
        )

    assert first_page == 0
    assert second_page == late_page
    assert note.y1 > height * 0.8
    assert body_bottom < note.y0


def test_the_body_never_runs_into_the_notes(tmp_path: Path):
    body = "".join(f"<p>{' '.join(['text'] * 40)}{_marker(index)}</p>" for index in range(1, 9))
    notes = [f"Note number {index} " + "detail " * 20 for index in range(1, 9)]

    with _render(tmp_path, body + _filler(1200), footnotes=notes) as document:
        for page in document:
            numbers = page.search_for("Note number")
            if not numbers:
                continue
            top = min(rect.y0 for rect in numbers)
            body_words = [
                word for word in page.get_text("words") if word[4].startswith(("text", "word"))
            ]
            assert body_words
            assert max(word[3] for word in body_words) < top
        text = "".join(page.get_text() for page in document)

    assert all(f"Note number {index}" in text for index in range(1, 9))
    assert "Notes" not in text


def test_a_marker_links_to_its_note(tmp_path: Path):
    body = f"<p>Linked{_marker(1)} words</p>"

    with _render(tmp_path, body, footnotes=["Target note"]) as document:
        links = [link for link in document[0].get_links() if link["kind"] == pymupdf.LINK_GOTO]
        note = document[0].search_for("Target note")[0]

    assert len(links) == 1
    assert links[0]["page"] == 0
    assert links[0]["to"].y == pytest.approx(note.y0, abs=6)


def test_a_note_taller_than_a_third_of_the_page_becomes_an_endnote(tmp_path: Path):
    body = f"<p>Short text{_marker(1)} and more{_marker(2)}</p>{_filler(300)}"
    notes = ["Long " + "explanation " * 160, "Small note"]
    settings = {"fontSize": 20}

    with _render(
        tmp_path, body, footnotes=notes, notesTitle="Endnotes", settings=settings
    ) as document:
        title, small, body_end = (
            _page_with(document, text) for text in ("Endnotes", "Small note", "word299")
        )
        links = [
            link
            for page in document
            for link in page.get_links()
            if link["kind"] == pymupdf.LINK_GOTO
        ]

    assert body_end <= title <= small
    assert len(links) == 2


def test_contents_and_columns_keep_their_notes(tmp_path: Path):
    body = "".join(
        f'<h1 id="h-{index}">Chapter {index}{_marker(index)}</h1>{_filler(200)}'
        for index in range(1, 4)
    )
    settings = {"columns": 2, "toc": True, "tocTitle": "Contents"}
    notes = [f"Chapter note {index}" for index in range(1, 4)]

    with _render(tmp_path, body, footnotes=notes, settings=settings) as document:
        contents = document[0].get_text()
        placed = {
            index: next(
                page.number for page in document if page.search_for(f"Chapter note {index}")
            )
            for index in range(1, 4)
        }
        headings = {
            index: next(
                page.number
                for page in document
                if page.number > 0 and page.search_for(f"Chapter {index}")
            )
            for index in range(1, 4)
        }
        bookmarks = [title for _, title, _ in document.get_toc()]

    assert "Chapter 11" not in contents
    assert placed == headings
    assert bookmarks == ["Chapter 1", "Chapter 2", "Chapter 3"]


def test_notes_without_a_marker_are_left_out(tmp_path: Path):
    with _render(tmp_path, "<p>No markers</p>", footnotes=["Orphan note"]) as document:
        text = document[0].get_text()

    assert "Orphan note" not in text


def _shaded(page: pymupdf.Page) -> list[pymupdf.Rect]:
    return [
        drawing["rect"]
        for drawing in page.get_drawings()
        if drawing.get("fill")
        and tuple(round(part, 2) for part in drawing["fill"]) == (0.95, 0.96, 0.96)
        and drawing["rect"].width > 100
    ]


def test_code_and_header_shading_stays_on_the_pages_that_hold_them(tmp_path: Path):
    rows = "".join(f"<tr><td><p>r{index}</p></td><td><p>x</p></td></tr>" for index in range(8))
    code = chr(10).join(f"line {index}" for index in range(80))
    body = (
        "<p>intro</p>" * 20
        + f"<table><tr><th><p>Name</p></th><th><p>Score</p></th></tr>{rows}</table>"
        + f"<pre><code>{code}</code></pre>"
        + "<p>after</p>" * 120
    )

    with _render(tmp_path, body=body) as document:
        shaded = [_shaded(page) for page in document]
        code_pages = [
            page.number
            for page in document
            if "line 40" in page.get_text() or "line 79" in page.get_text()
        ]

    assert len(shaded[0]) >= 2
    assert all(any(rect.height > 50 for rect in shaded[number]) for number in code_pages)
    last_code_page = max(code_pages)
    assert len(shaded) > last_code_page + 1
    assert all(not rects for rects in shaded[last_code_page + 1 :])


def test_merged_table_cells_span_their_columns_and_rows(tmp_path: Path):
    body = (
        '<table><tr><th colspan="2"><p>Wide</p></th><th><p>C</p></th></tr>'
        '<tr><td rowspan="2"><p>Tall</p></td><td><p>E</p></td><td><p>F</p></td></tr>'
        "<tr><td><p>G</p></td><td><p>H</p></td></tr></table>"
    )

    with _render(tmp_path, body=body) as document:
        words = {word[4]: pymupdf.Rect(word[:4]) for word in document[0].get_text("words")}

    assert words["G"].x0 == pytest.approx(words["E"].x0, abs=1)
    assert words["H"].x0 == pytest.approx(words["F"].x0, abs=1)
    assert words["C"].x0 == pytest.approx(words["F"].x0, abs=1)
    assert words["Tall"].x0 < words["E"].x0


def test_scripts_outside_pictures_and_unsafe_links_are_dropped(tmp_path: Path):
    body = (
        "<p>Safe</p><script>alert(1)</script>"
        '<p><img src="C:/Windows/secret.png"><img src="vpimg-7"></p>'
        '<p><a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></p>'
    )

    with _render(tmp_path, body=body) as document:
        page = document[0]
        links = [link.get("uri") for link in page.get_links()]
        text = page.get_text()
        images = page.get_images()

    assert "alert" not in text
    assert images == []
    assert links == ["https://example.com"]


def test_a_broken_embedded_picture_is_reported(tmp_path: Path):
    with pytest.raises(OpError) as caught:
        _render(tmp_path, images=["data:image/png;base64,bm90IGFuIGltYWdl"])

    assert caught.value.data["reason"] == "imageUnreadable"


def test_the_preview_lays_out_once_and_serves_each_page(tmp_path: Path):
    params = StudioDocumentPreviewParams.model_validate(
        {"html": BODY, "images": [_data_url(_png())], "settings": {"paper": "letter"}}
    )

    preview = preview_document(params, silent_progress())
    page = preview_document_page(
        StudioDocumentPageParams(token=preview.token, page=1, width=300), silent_progress()
    )

    assert preview.page_count == 2
    assert preview.width == pytest.approx(612)
    assert page.width == 300
    assert base64.b64decode(page.image).startswith(b"\x89PNG")
    with pytest.raises(OpError) as beyond:
        preview_document_page(
            StudioDocumentPageParams(token=preview.token, page=5), silent_progress()
        )
    with pytest.raises(OpError) as gone:
        preview_document_page(StudioDocumentPageParams(token="missing", page=0), silent_progress())
    assert beyond.value.data["reason"] == "badRange"
    assert gone.value.data["reason"] == "previewGone"


def test_a_document_file_round_trips_and_refuses_other_files(tmp_path: Path):
    document = {"version": 1, "kind": "document", "name": "Notlar", "content": {"type": "doc"}}
    saved = save_studio_document(
        StudioDocumentSaveParams(document=document, output=str(tmp_path / "notes")),
        silent_progress(),
    )
    other = tmp_path / "other.vivedoc"
    other.write_text(json.dumps({"kind": "design"}), "utf-8")
    newer = tmp_path / "newer.vivedoc"
    newer.write_text(json.dumps({"kind": "document", "version": 99}), "utf-8")

    opened = open_studio_document(StudioDocumentOpenParams(path=saved.output), silent_progress())

    assert saved.output.endswith("notes.vivedoc")
    assert opened.document == document
    for path, reason in ((other, "noDocument"), (newer, "newerDocument")):
        with pytest.raises(OpError) as caught:
            open_studio_document(StudioDocumentOpenParams(path=str(path)), silent_progress())
        assert caught.value.data["reason"] == reason
    with pytest.raises(OpError) as exists:
        save_studio_document(
            StudioDocumentSaveParams(document=document, output=saved.output), silent_progress()
        )
    assert exists.value.data["exists"] is True


def test_markdown_imports_with_its_own_pictures_only(tmp_path: Path):
    folder = tmp_path / "notes"
    folder.mkdir()
    (folder / "chart.png").write_bytes(_png())
    (tmp_path / "outside.png").write_bytes(_png())
    source = folder / "notes.md"
    source.write_text(
        "# Weekly notes\n\nHello **world**.\n\n![a](chart.png) ![b](../outside.png) "
        "![c](https://example.com/x.png)\n",
        "utf-8",
    )

    result = import_document(StudioDocumentOpenParams(path=str(source)), silent_progress())

    assert result.title == "Weekly notes"
    assert "<strong>world</strong>" in result.html
    assert result.html.count("data:image/png;base64,") == 1
    assert "outside" not in result.html and "example.com" not in result.html


def test_plain_text_imports_as_paragraphs(tmp_path: Path):
    source = tmp_path / "letter.txt"
    source.write_text("Dear <team>,\nline two\n\nSecond paragraph\n", "utf-8")

    result = import_document(StudioDocumentOpenParams(path=str(source)), silent_progress())

    assert result.html == "<p>Dear &lt;team&gt;,<br>line two</p><p>Second paragraph</p>"
    assert result.title == "letter"


def test_unsupported_imports_are_refused(tmp_path: Path):
    source = tmp_path / "book.docx"
    source.write_bytes(b"PK")

    with pytest.raises(OpError) as caught:
        import_document(StudioDocumentOpenParams(path=str(source)), silent_progress())

    assert caught.value.data["reason"] == "unsupportedType"


def test_pictures_are_embedded_as_jpeg_or_png_and_shrunk(tmp_path: Path):
    photo = tmp_path / "photo.jpg"
    Image.new("RGB", (5000, 2500), (10, 120, 200)).save(photo)
    logo = tmp_path / "logo.png"
    logo.write_bytes(_png((0, 0, 0, 0)))

    big = document_image(StudioDocumentOpenParams(path=str(photo)), silent_progress())
    clear = document_image(StudioDocumentOpenParams(path=str(logo)), silent_progress())

    assert big.src.startswith("data:image/jpeg;base64,")
    assert (big.width, big.height) == (2400, 1200)
    assert clear.src.startswith("data:image/png;base64,")
