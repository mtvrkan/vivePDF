from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._marked_content import text_strings
from vivepdf.ops.edit import RedactParams, redact
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)
NAME = "Ahmet Yılmaz"


@pytest.fixture
def leaky_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for rotation in (0, 90):
        page = document.new_page(width=600, height=800)
        page.insert_text((50, 100), f"Name: {NAME} ok", fontsize=12, fontname="dv", fontfile=FONT)
        page.insert_text((50, 300), "Unrelated line", fontsize=12, fontname="dv", fontfile=FONT)
        note = page.add_text_annot((400, 600), f"Ask {NAME} first")
        note.set_info(title=NAME)
        note.update()
        page.add_highlight_annot(page.search_for("Ahmet")[0])
        widget = pymupdf.Widget()
        widget.field_name = f"owner{rotation}"
        widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        widget.rect = pymupdf.Rect(50, 500, 300, 520)
        widget.field_value = NAME
        page.add_widget(widget)
        page.set_rotation(rotation)
    document.set_metadata({"title": f"About {NAME}", "author": NAME, "keywords": "x"})
    document.set_toc([[1, f"{NAME} chapter", 1], [1, "Other", 2]])
    path = tmp_path / "leaky.pdf"
    document.save(path)
    document.close()
    return path


def _everything_visible(document: pymupdf.Document) -> str:
    parts = [str(value) for value in (document.metadata or {}).values()]
    parts.extend(entry[1] for entry in document.get_toc())
    for page in document:
        parts.append(page.get_text())
        for annot in page.annots():
            parts.extend(str(value) for value in (annot.info or {}).values())
        parts.extend(str(widget.field_value) for widget in page.widgets())
    return "\n".join(parts)


def test_redacting_a_name_removes_it_from_comments_fields_bookmarks_and_properties(
    leaky_pdf: Path, tmp_path: Path
) -> None:
    output = tmp_path / "out.pdf"
    result = redact(
        RedactParams(path=str(leaky_pdf), output=str(output), search_text=[NAME]),
        silent_progress(),
    )
    assert result.redactions == 2
    assert result.hidden >= 7
    document = pymupdf.open(output)
    assert NAME not in _everything_visible(document)
    assert "Unrelated line" in document[0].get_text()
    assert [entry[1] for entry in document.get_toc()][1] == "Other"
    assert all(annot.type[1] != "Highlight" for page in document for annot in page.annots())
    document.close()


def test_scrubbing_can_be_turned_off(leaky_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "plain.pdf"
    redact(
        RedactParams(
            path=str(leaky_pdf), output=str(output), search_text=[NAME], scrub_hidden=False
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    assert NAME in document.metadata["author"]
    assert NAME not in document[0].get_text()
    document.close()


def test_whole_pages_are_blanked(leaky_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "pages.pdf"
    result = redact(
        RedactParams(
            path=str(leaky_pdf), output=str(output), whole_pages="2", overlay_text="EXEMPT"
        ),
        silent_progress(),
    )
    assert result.redactions == 1
    document = pymupdf.open(output)
    assert document.page_count == 2
    assert "Unrelated" in document[0].get_text()
    assert document[1].get_text().strip() in ("", "EXEMPT")
    assert list(document[1].annots()) == []
    assert list(document[1].widgets()) == []
    document.close()


def test_blank_terms_are_nothing_to_redact(leaky_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        redact(
            RedactParams(path=str(leaky_pdf), output=str(tmp_path / "x.pdf"), search_text=["  "]),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_redacting_over_a_photo_keeps_it_a_jpeg(tmp_path: Path) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 800, 600), False)
    pixmap.set_rect(pixmap.irect, (200, 120, 40))
    photo = pixmap.tobytes("jpeg", jpg_quality=80)
    document = pymupdf.open()
    for _ in range(3):
        page = document.new_page(width=600, height=800)
        page.insert_image(pymupdf.Rect(0, 0, 600, 450), stream=photo)
        page.insert_text((50, 100), "Confidential name here", fontsize=14)
    source = tmp_path / "photo.pdf"
    document.save(source)
    document.close()
    output = tmp_path / "redacted-photo.pdf"
    result = redact(
        RedactParams(path=str(source), output=str(output), search_text=["name"]),
        silent_progress(),
    )
    assert result.redactions == 3
    redacted = pymupdf.open(output)
    for page in redacted:
        assert "name" not in page.get_text()
        xref = page.get_images(full=True)[0][0]
        assert redacted.xref_get_key(xref, "Filter")[1] == "/DCTDecode"
    redacted.close()
    assert output.stat().st_size < source.stat().st_size * 6


def _word_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_text(
        (50, 100), "Ali ve Veli üniversite, ve sonra.", fontsize=12, fontname="dv", fontfile=FONT
    )
    document.set_metadata({"title": "Ali ve üniversite"})
    path = tmp_path / "words.pdf"
    document.save(path)
    document.close()
    return path


def test_whole_word_leaves_the_term_inside_other_words(tmp_path: Path) -> None:
    source = _word_pdf(tmp_path)
    output = tmp_path / "whole.pdf"
    result = redact(
        RedactParams(path=str(source), output=str(output), search_text=["ve"], whole_word=True),
        silent_progress(),
    )
    assert result.redactions == 2
    with pymupdf.open(output) as document:
        text = document[0].get_text()
        assert "üniversite" in text
        assert "Veli" in text
        assert " ve " not in text
        assert document.metadata["title"] == "Ali █████ üniversite"


def test_substring_match_stays_the_default(tmp_path: Path) -> None:
    source = _word_pdf(tmp_path)
    output = tmp_path / "loose.pdf"
    result = redact(
        RedactParams(path=str(source), output=str(output), search_text=["ve"]),
        silent_progress(),
    )
    assert result.redactions >= 4


def _redacted(source: Path, tmp_path: Path, **extra) -> pymupdf.Document:
    output = tmp_path / "hidden-out.pdf"
    redact(
        RedactParams(path=str(source), output=str(output), overwrite=True, **extra),
        silent_progress(),
    )
    return pymupdf.open(output)


def _single_page(tmp_path: Path, build) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((50, 100), f"Name: {NAME} ok", fontsize=12, fontname="dv", fontfile=FONT)
    build(document, page)
    path = tmp_path / "single.pdf"
    document.save(path)
    document.close()
    return path


def test_rich_text_of_a_text_box_is_scrubbed(tmp_path: Path) -> None:
    def build(document: pymupdf.Document, page: pymupdf.Page) -> None:
        box = page.add_freetext_annot(pymupdf.Rect(300, 600, 550, 650), "Call the owner")
        document.xref_set_key(
            box.xref, "RC", pymupdf.get_pdf_str(f"<body><p>Call {NAME}</p></body>")
        )

    document = _redacted(_single_page(tmp_path, build), tmp_path, search_text=[NAME])
    annot = next(iter(document[0].annots()))
    assert NAME not in document.xref_get_key(annot.xref, "RC")[1]
    assert (annot.info or {}).get("content") == "Call the owner"
    document.close()


def test_choice_fields_tooltips_and_defaults_are_scrubbed(tmp_path: Path) -> None:
    def build(document: pymupdf.Document, page: pymupdf.Page) -> None:
        choice = pymupdf.Widget()
        choice.field_name = "who"
        choice.field_type = pymupdf.PDF_WIDGET_TYPE_COMBOBOX
        choice.rect = pymupdf.Rect(50, 500, 300, 520)
        choice.choice_values = [NAME, "Someone else"]
        choice.field_value = NAME
        page.add_widget(choice)
        text = pymupdf.Widget()
        text.field_name = "note"
        text.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        text.rect = pymupdf.Rect(50, 550, 300, 570)
        text.field_label = f"Ask {NAME}"
        added = page.add_widget(text)
        document.xref_set_key(added.xref, "DV", pymupdf.get_pdf_str(NAME))

    document = _redacted(_single_page(tmp_path, build), tmp_path, search_text=[NAME])
    widgets = {widget.field_name: widget for widget in document[0].widgets()}
    assert NAME not in widgets["who"].choice_values
    assert "Someone else" in widgets["who"].choice_values
    assert NAME not in str(widgets["who"].field_value)
    for key in ("TU", "DV"):
        assert NAME not in document.xref_get_key(widgets["note"].xref, key)[1]
    document.close()


def test_links_that_carry_the_term_are_removed(tmp_path: Path) -> None:
    def build(_document: pymupdf.Document, page: pymupdf.Page) -> None:
        page.insert_link(
            {
                "kind": pymupdf.LINK_URI,
                "from": pymupdf.Rect(50, 700, 200, 720),
                "uri": "mailto:ahmet.yilmaz@firma.com",
            }
        )
        page.insert_link(
            {
                "kind": pymupdf.LINK_URI,
                "from": pymupdf.Rect(300, 700, 450, 720),
                "uri": "https://example.com/",
            }
        )

    document = _redacted(
        _single_page(tmp_path, build), tmp_path, search_text=["ahmet.yilmaz@firma.com"]
    )
    uris = [link.get("uri") for link in document[0].get_links()]
    assert uris == ["https://example.com/"]
    document.close()


def test_custom_properties_and_structure_text_are_scrubbed(tmp_path: Path) -> None:
    def build(document: pymupdf.Document, page: pymupdf.Page) -> None:
        document.set_metadata({"author": "x"})
        info = int(document.xref_get_key(-1, "Info")[1].split()[0])
        document.xref_set_key(info, "Manager", pymupdf.get_pdf_str(NAME))
        root = document.get_new_xref()
        element = document.get_new_xref()
        document.update_object(root, f"<< /Type /StructTreeRoot /K {element} 0 R >>")
        document.update_object(
            element,
            f"<< /Type /StructElem /S /Figure /P {root} 0 R "
            f"/Alt {pymupdf.get_pdf_str('Photo of ' + NAME)} "
            f"/ActualText {pymupdf.get_pdf_str(NAME)} >>",
        )
        document.xref_set_key(document.pdf_catalog(), "StructTreeRoot", f"{root} 0 R")

    source = _single_page(tmp_path, build)
    document = _redacted(source, tmp_path, search_text=[NAME])
    info = int(document.xref_get_key(-1, "Info")[1].split()[0])
    assert NAME not in document.xref_get_key(info, "Manager")[1]
    element = next(
        xref
        for xref in range(1, document.xref_length())
        if document.xref_get_key(xref, "S")[1] == "/Figure"
    )
    assert NAME not in document.xref_get_key(element, "Alt")[1]
    assert NAME not in document.xref_get_key(element, "ActualText")[1]
    document.close()


def test_embedded_file_names_and_descriptions_are_scrubbed(tmp_path: Path) -> None:
    def build(document: pymupdf.Document, _page: pymupdf.Page) -> None:
        document.embfile_add(f"{NAME}.txt", b"data", filename=f"{NAME}.txt", desc=f"CV of {NAME}")
        document.embfile_add("plain.txt", b"data", desc=f"Sent by {NAME}")

    document = _redacted(_single_page(tmp_path, build), tmp_path, search_text=[NAME])
    names = document.embfile_names()
    assert len(names) == 2
    for name in names:
        info = document.embfile_info(name)
        assert NAME not in name
        assert NAME not in info["filename"]
        assert NAME not in info["description"]
        assert document.embfile_get(name) == b"data"
    document.close()


def test_an_area_redaction_scrubs_the_words_it_covered_everywhere(
    leaky_pdf: Path, tmp_path: Path
) -> None:
    source = pymupdf.open(leaky_pdf)
    box = source[0].search_for(NAME)[0]
    source.close()
    document = _redacted(
        leaky_pdf,
        tmp_path,
        areas=[{"page": 1, "x0": box.x0, "y0": box.y0, "x1": box.x1, "y1": box.y1}],
    )
    assert NAME not in document.metadata["author"]
    assert NAME not in document.get_toc()[0][1]
    assert "Unrelated line" in document[0].get_text()
    document.close()


def test_an_area_redaction_leaves_hidden_text_alone_when_scrubbing_is_off(
    leaky_pdf: Path, tmp_path: Path
) -> None:
    source = pymupdf.open(leaky_pdf)
    box = source[0].search_for(NAME)[0]
    source.close()
    document = _redacted(
        leaky_pdf,
        tmp_path,
        scrub_hidden=False,
        areas=[{"page": 1, "x0": box.x0, "y0": box.y0, "x1": box.x1, "y1": box.y1}],
    )
    assert NAME in document.metadata["author"]
    document.close()


def _picture_pdf(tmp_path: Path) -> Path:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 100), False)
    pixmap.set_rect(pixmap.irect, (30, 30, 30))
    document = pymupdf.open()
    for _ in range(2):
        page = document.new_page(width=600, height=800)
        page.insert_image(pymupdf.Rect(50, 50, 450, 250), pixmap=pixmap)
    path = tmp_path / "picture.pdf"
    document.save(path)
    document.close()
    return path


PICTURE_BOX = {"page": 1, "x0": 100, "y0": 100, "x1": 200, "y1": 150}


@pytest.mark.parametrize(("images", "kept"), [("none", 1), ("overlapping", 0), ("all", 0)])
def test_pictures_left_under_a_box_are_counted(tmp_path: Path, images: str, kept: int) -> None:
    result = redact(
        RedactParams(
            path=str(_picture_pdf(tmp_path)),
            output=str(tmp_path / "out.pdf"),
            areas=[PICTURE_BOX],
            images=images,
        ),
        silent_progress(),
    )
    assert result.images_kept == kept


def test_blanked_pages_never_report_kept_pictures(tmp_path: Path) -> None:
    result = redact(
        RedactParams(
            path=str(_picture_pdf(tmp_path)),
            output=str(tmp_path / "out.pdf"),
            areas=[PICTURE_BOX],
            whole_pages="1",
            images="none",
        ),
        silent_progress(),
    )
    assert result.images_kept == 0
    with pymupdf.open(tmp_path / "out.pdf") as document:
        assert not document[0].get_images()
        assert document[1].get_images()


def _utf16_hex(text: str) -> str:
    return "<FEFF" + text.encode("utf-16-be").hex().upper() + ">"


def _content_strings(document: pymupdf.Document) -> list[str]:
    found: list[str] = []
    for xref in range(1, document.xref_length()):
        if document.xref_is_stream(xref):
            data = document.xref_stream(xref) or b""
            found.extend(text for _start, _end, text in text_strings(data))
    return found


def test_marked_content_text_in_page_and_form_streams_is_scrubbed(tmp_path: Path) -> None:
    inline_image = b"BI /W 2 /H 1 /BPC 8 /CS /G ID \x28/Alt (Proje Mavi)\x29 EI\n"

    def build(document: pymupdf.Document, _page: pymupdf.Page) -> None:
        page = document.new_page(width=600, height=800)
        page.draw_rect(pymupdf.Rect(10, 10, 20, 20))
        form = document.get_new_xref()
        document.update_object(form, "<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] >>")
        document.update_stream(form, b"/P << /ActualText (Proje Mavi) >> BDC 0 0 m 5 5 l S EMC\n")
        resources = int(document.xref_get_key(page.xref, "Resources")[1].split()[0])
        document.xref_set_key(resources, "XObject", f"<< /Fm0 {form} 0 R >>")
        marked = (
            f"/Span << /ActualText {_utf16_hex(NAME)} >> BDC 0 0 m 9 9 l S EMC\n"
            "/Span << /Alt (Rapor: Proje Mavi \\(gizli\\)) /Lang (tr) >> BDC /Fm0 Do EMC\n"
            "/Span << /E (Proje Mavi) >> BDC 1 1 m 2 2 l S EMC\n"
        ).encode("ascii")
        contents = page.get_contents()[0]
        document.update_stream(
            contents, marked + b"q " + inline_image + b"Q\n" + document.xref_stream(contents)
        )

    document = _redacted(_single_page(tmp_path, build), tmp_path, search_text=[NAME, "Proje Mavi"])
    strings = _content_strings(document)
    assert len(strings) == 4
    assert not [text for text in strings if NAME in text or "Proje Mavi" in text]
    assert "Rapor: █████ (gizli)" in strings
    assert b"/Lang (tr)" in document.xref_stream(document[1].get_contents()[0])
    streams = b"".join(
        document.xref_stream(xref) or b""
        for xref in range(1, document.xref_length())
        if document.xref_is_stream(xref)
    )
    assert inline_image in streams
    document.close()


def test_layer_names_and_page_label_prefixes_are_scrubbed(tmp_path: Path) -> None:
    def build(document: pymupdf.Document, _page: pymupdf.Page) -> None:
        layer = document.add_ocg("layer")
        document.xref_set_key(layer, "Name", pymupdf.get_pdf_str(f"{NAME} notları"))
        document.add_ocg("Plain layer")
        document.new_page()
        appendix = document.get_new_xref()
        document.update_object(appendix, f"<< /S /r /P {_utf16_hex('Ek ' + NAME)} >>")
        leaf = document.get_new_xref()
        document.update_object(
            leaf,
            f"<< /Nums [0 << /S /D /P {_utf16_hex(NAME + '-')} >> 1 {appendix} 0 R] >>",
        )
        root = document.get_new_xref()
        document.update_object(root, f"<< /Kids [{leaf} 0 R] >>")
        document.xref_set_key(document.pdf_catalog(), "PageLabels", f"{root} 0 R")

    document = _redacted(_single_page(tmp_path, build), tmp_path, search_text=[NAME])
    names = sorted(entry["name"] for entry in document.get_ocgs().values())
    assert names == ["Plain layer", "█████ notları"]
    root = int(document.xref_get_key(document.pdf_catalog(), "PageLabels")[1].split()[0])
    leaf = int(document.xref_get_key(root, "Kids")[1].strip("[] ").split()[0])
    nums = document.xref_get_key(leaf, "Nums")[1]
    assert [text for *_span, text in text_strings(nums.encode("latin-1"), (b"/P",))] == ["█████-"]
    appendix = int(nums.split("]")[0].split()[-3])
    assert document.xref_get_key(appendix, "P")[1] == "Ek █████"
    document.close()


def test_javascript_in_actions_and_script_streams_is_scrubbed(tmp_path: Path) -> None:
    def build(document: pymupdf.Document, page: pymupdf.Page) -> None:
        script = document.get_new_xref()
        document.update_object(script, "<<>>")
        document.update_stream(script, b'app.alert("Proje Mavi");')
        document.xref_set_key(
            document.pdf_catalog(), "OpenAction", f"<< /S /JavaScript /JS {script} 0 R >>"
        )
        link = page.add_text_annot((400, 600), "note")
        document.xref_set_key(
            link.xref,
            "AA",
            f"<< /O << /S /JavaScript /JS {pymupdf.get_pdf_str('say(' + repr(NAME) + ')')} >> >>",
        )

    document = _redacted(_single_page(tmp_path, build), tmp_path, search_text=[NAME, "Proje Mavi"])
    kind, value = document.xref_get_key(document.pdf_catalog(), "OpenAction/JS")
    assert kind == "xref"
    script = document.xref_stream(int(value.split()[0]))
    assert script.startswith(b"\xfe\xff")
    assert script[2:].decode("utf-16-be") == 'app.alert("█████");'
    annot = next(document[0].annots())
    kind, value = document.xref_get_key(annot.xref, "AA/O/JS")
    assert kind == "string"
    assert NAME not in value
    assert "█████" in value
    document.close()
