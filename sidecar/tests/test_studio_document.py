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
