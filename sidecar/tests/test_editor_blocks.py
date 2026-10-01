import base64
import io
from pathlib import Path

import pymupdf
import pytest
from fontTools.subset import Subsetter
from fontTools.ttLib import TTFont
from PIL import Image

from vivepdf.ops.editor import (
    EditorApplyParams,
    EditorWarning,
    ResolvedFont,
    _Atom,
    _resolve_styles,
    apply,
)
from vivepdf.ops.editor_blocks import (
    BlocksParams,
    FontParams,
    FontPlanParams,
    blocks,
    detect_align,
    font,
    font_plan,
    join_lines,
)
from vivepdf.ops.fonts import (
    TEXTEDIT_FONT,
    FontResolution,
    _base14_variant,
    display_font_name,
    resolve_font,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

PARAGRAPH = (
    "Bilgisayar muhendisligi, bilgisayarlarin ve bilgi teknolojilerinin tasarimi, "
    "gelistirilmesi, bakimi ve yonetimi ile ilgilenen bir muhendislik dalidir."
)


def _jpeg() -> bytes:
    image = Image.new("RGB", (60, 40), (10, 100, 200))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture
def background_image_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=720, height=540)
    page.insert_image(pymupdf.Rect(0, 0, 720, 540), stream=_jpeg(), keep_proportion=False)
    page.insert_textbox(
        pymupdf.Rect(100, 100, 300, 140), "Uzerine yazi", fontsize=16, fontname="hebo"
    )
    path = tmp_path / "background.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def block_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    page.insert_textbox(
        pymupdf.Rect(40, 40, 360, 140),
        PARAGRAPH,
        fontsize=11,
        fontname="helv",
        align=pymupdf.TEXT_ALIGN_JUSTIFY,
    )
    page.insert_text((40, 200), "Single line title", fontsize=16, fontname="hebo")
    page.insert_image(pymupdf.Rect(40, 240, 160, 320), stream=_jpeg())
    path = tmp_path / "blocks.pdf"
    document.save(path)
    document.close()
    return path


def test_blocks_report_paragraphs_styles_and_images(block_pdf: Path):
    result = blocks(BlocksParams(path=str(block_pdf), page=0), silent_progress())
    texts = [item for item in result.blocks if item.kind == "text"]
    images = [item for item in result.blocks if item.kind == "image"]
    paragraph = next(item for item in texts if item.line_count > 1)
    title = next(item for item in texts if "title" in item.text)
    assert paragraph.text.startswith("Bilgisayar muhendisligi")
    assert paragraph.align == "justify"
    assert 0.9 <= paragraph.line_height <= 2.5
    assert title.bold is True and title.size == 16
    assert len(images) == 1
    assert images[0].width == 60 and images[0].bbox[0] == 40.0


def test_blocks_report_background_image_and_text_together(background_image_pdf: Path):
    result = blocks(BlocksParams(path=str(background_image_pdf), page=0), silent_progress())
    images = [item for item in result.blocks if item.kind == "image"]
    texts = [item for item in result.blocks if item.kind == "text"]
    assert len(images) == 1
    assert images[0].bbox[2] - images[0].bbox[0] >= 719
    assert images[0].bbox[3] - images[0].bbox[1] >= 539
    assert any("Uzerine yazi" in item.text for item in texts)
    paragraph = next(item for item in texts if "Uzerine yazi" in item.text)
    assert paragraph.bbox[0] >= images[0].bbox[0] and paragraph.bbox[2] <= images[0].bbox[2]
    assert paragraph.bbox[1] >= images[0].bbox[1] and paragraph.bbox[3] <= images[0].bbox[3]


def test_helpers_join_hyphenated_lines_and_detect_alignment():
    assert join_lines(["gelis-", "tirilmesi ve", "bakimi"]) == "gelistirilmesi ve bakimi"
    block = pymupdf.Rect(0, 0, 100, 40)
    assert (
        detect_align(
            block,
            [
                pymupdf.Rect(0, 0, 100, 10),
                pymupdf.Rect(0, 12, 100, 22),
                pymupdf.Rect(0, 24, 60, 34),
            ],
        )
        == "justify"
    )
    assert (
        detect_align(
            block,
            [
                pymupdf.Rect(20, 0, 80, 10),
                pymupdf.Rect(10, 12, 90, 22),
                pymupdf.Rect(30, 24, 70, 34),
            ],
        )
        == "center"
    )
    assert (
        detect_align(
            block,
            [
                pymupdf.Rect(40, 0, 100, 10),
                pymupdf.Rect(10, 12, 100, 22),
                pymupdf.Rect(0, 24, 100, 34),
            ],
        )
        == "right"
    )


def test_block_rewrite_and_image_move_delete(block_pdf: Path, tmp_path: Path):
    listing = blocks(BlocksParams(path=str(block_pdf), page=0), silent_progress())
    paragraph = next(item for item in listing.blocks if item.kind == "text" and item.line_count > 1)
    image = next(item for item in listing.blocks if item.kind == "image")
    output = tmp_path / "rewritten.pdf"
    apply(
        EditorApplyParams(
            path=str(block_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": paragraph.bbox[0],
                    "y0": paragraph.bbox[1],
                    "x1": paragraph.bbox[2],
                    "y1": paragraph.bbox[3],
                    "text": "Yeni paragraf metni burada yer alir ve satirlara sarilir.",
                    "fontSize": paragraph.size,
                    "color": paragraph.color,
                    "bold": paragraph.bold,
                    "italic": paragraph.italic,
                    "font": paragraph.font,
                    "align": paragraph.align,
                    "lineHeight": paragraph.line_height,
                },
                {
                    "kind": "imageChange",
                    "page": 1,
                    "x0": image.bbox[0],
                    "y0": image.bbox[1],
                    "x1": image.bbox[2],
                    "y1": image.bbox[3],
                    "xref": image.xref,
                    "newX0": 200.0,
                    "newY0": 240.0,
                    "newX1": 320.0,
                    "newY1": 320.0,
                },
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    page = document[0]
    text = page.get_text()
    infos = page.get_image_info(xrefs=True)
    document.close()
    assert "Yeni paragraf metni" in text
    assert "Bilgisayar muhendisligi" not in text
    assert "Single line title" in text
    moved = [info for info in infos if info.get("xref") and info.get("width", 0) > 1]
    assert len(moved) == 1
    assert round(pymupdf.Rect(moved[0]["bbox"]).x0) == 200

    deleted = tmp_path / "deleted.pdf"
    apply(
        EditorApplyParams(
            path=str(block_pdf),
            output=str(deleted),
            objects=[
                {
                    "kind": "imageChange",
                    "page": 1,
                    "x0": image.bbox[0],
                    "y0": image.bbox[1],
                    "x1": image.bbox[2],
                    "y1": image.bbox[3],
                    "xref": image.xref,
                }
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(deleted)
    remaining = [
        info
        for info in document[0].get_image_info(xrefs=True)
        if info.get("xref") and info.get("width", 0) > 1
    ]
    document.close()
    assert remaining == []


def test_consecutive_lines_merge_into_one_paragraph(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    for row, line in enumerate(
        ["Birinci satir burada", "ikinci satir devam eder", "ucuncu satir biter."]
    ):
        page.insert_text((40, 60 + row * 14), line, fontsize=11, fontname="helv")
    page.insert_text((40, 140), "Ayri bir baslik", fontsize=16, fontname="hebo")
    path = tmp_path / "lines.pdf"
    document.save(path)
    document.close()
    result = blocks(BlocksParams(path=str(path), page=0), silent_progress())
    texts = [item for item in result.blocks if item.kind == "text"]
    assert len(texts) == 2
    assert texts[0].line_count == 3
    assert texts[0].text == "Birinci satir burada ikinci satir devam eder ucuncu satir biter."
    assert texts[1].text == "Ayri bir baslik"


@pytest.fixture
def embedded_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.insert_text(
        (40, 60),
        "Gömülü yazı tipi ile başlık",
        fontsize=18,
        fontname="dejavu",
        fontfile=str(TEXTEDIT_FONT),
    )
    page.insert_text((40, 120), "Second line stays", fontsize=12, fontname="helv")
    page.insert_image(pymupdf.Rect(40, 160, 160, 240), stream=_jpeg())
    path = tmp_path / "embedded.pdf"
    document.save(path)
    document.close()
    return path


def test_blocks_expose_embedded_font_and_font_op_returns_it(embedded_pdf: Path):
    listing = blocks(BlocksParams(path=str(embedded_pdf), page=0), silent_progress())
    title = next(item for item in listing.blocks if item.kind == "text" and "Gömülü" in item.text)
    plain = next(item for item in listing.blocks if item.kind == "text" and "Second" in item.text)
    assert title.font_xref > 0 and title.font_ext == "ttf"
    assert title.font_family == "DejaVuSans"
    assert plain.font_xref > 0 and plain.font_ext == ""
    result = font(FontParams(path=str(embedded_pdf), xref=title.font_xref), silent_progress())
    loaded = pymupdf.Font(fontbuffer=base64.b64decode(result.base64))
    assert result.ext == "ttf" and loaded.has_glyph(ord("ş"))
    with pytest.raises(OpError):
        font(FontParams(path=str(embedded_pdf), xref=plain.font_xref), silent_progress())


def test_font_resolution_prefers_embedded_then_base14_then_fallback(embedded_pdf: Path):
    listing = blocks(BlocksParams(path=str(embedded_pdf), page=0), silent_progress())
    title = next(item for item in listing.blocks if item.kind == "text" and "Gömülü" in item.text)
    document = pymupdf.open(embedded_pdf)
    embedded = resolve_font(
        document,
        "şğı yeni",
        font_name=title.font,
        font_xref=title.font_xref,
        bold=False,
        italic=False,
    )
    assert embedded.fontname == f"vpf{title.font_xref}" and embedded.fontbuffer
    fallback = resolve_font(
        document, "şğı", font_name="Unknown-Font", font_xref=None, bold=True, italic=False
    )
    assert fallback.fontname == "vivepdf-te-bold"
    latin = resolve_font(
        document, "plain", font_name="TimesNewRomanPSMT", font_xref=None, bold=False, italic=True
    )
    assert latin.fontname in ("Times-Italic",) or latin.fontfile
    document.close()
    assert _base14_variant("ABCDEF+Times New Roman,Bold", True, False) == "Times-Bold"
    assert display_font_name("ABCDEE+TimesNewRomanPSMT") == "TimesNewRoman"
    assert display_font_name("Calibri-BoldItalic") == "Calibri"


def test_block_grown_box_redacts_only_original_and_image_rotates(
    embedded_pdf: Path, tmp_path: Path
):
    listing = blocks(BlocksParams(path=str(embedded_pdf), page=0), silent_progress())
    title = next(item for item in listing.blocks if item.kind == "text" and "Gömülü" in item.text)
    image = next(item for item in listing.blocks if item.kind == "image")
    output = tmp_path / "grown.pdf"
    apply(
        EditorApplyParams(
            path=str(embedded_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": title.bbox[0],
                    "y0": title.bbox[1],
                    "x1": title.bbox[2],
                    "y1": 140.0,
                    "original": title.bbox,
                    "fontXref": title.font_xref,
                    "text": "Değişen başlık",
                    "fontSize": title.size,
                    "font": title.font,
                },
                {
                    "kind": "imageChange",
                    "page": 1,
                    "x0": image.bbox[0],
                    "y0": image.bbox[1],
                    "x1": image.bbox[2],
                    "y1": image.bbox[3],
                    "xref": image.xref,
                    "newX0": image.bbox[0],
                    "newY0": image.bbox[1],
                    "newX1": image.bbox[0] + 80,
                    "newY1": image.bbox[1] + 120,
                    "rotate": 90,
                },
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    page = document[0]
    text = page.get_text()
    assert "Değişen başlık" in text and "Gömülü" not in text
    assert "Second line stays" in text
    fonts = [entry[3] for entry in page.get_fonts(full=True)]
    assert any("DejaVu" in name for name in fonts)
    infos = [info for info in page.get_image_info(xrefs=True) if info["width"] > 1]
    assert len(infos) == 1 and infos[0]["width"] == 40 and infos[0]["height"] == 60
    document.close()


def _png_bytes(color: tuple[int, int, int]) -> bytes:
    image = Image.new("RGB", (30, 20), color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def duplicate_xref_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    first_rect = pymupdf.Rect(40, 40, 100, 80)
    second_rect = pymupdf.Rect(150, 150, 210, 190)
    page.insert_image(first_rect, stream=_jpeg())
    xref = page.get_images(full=True)[0][0]
    page.insert_image(second_rect, xref=xref)
    path = tmp_path / "duplicate.pdf"
    document.save(path)
    document.close()
    return path


def test_image_replace_preserves_other_placement_of_same_xref(
    duplicate_xref_pdf: Path, tmp_path: Path
):
    listing = blocks(BlocksParams(path=str(duplicate_xref_pdf), page=0), silent_progress())
    images = [item for item in listing.blocks if item.kind == "image"]
    assert len(images) == 2
    target = images[0]
    replacement = tmp_path / "replacement.png"
    replacement.write_bytes(_png_bytes((5, 5, 5)))
    output = tmp_path / "replaced.pdf"
    apply(
        EditorApplyParams(
            path=str(duplicate_xref_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "imageChange",
                    "page": 1,
                    "x0": target.bbox[0],
                    "y0": target.bbox[1],
                    "x1": target.bbox[2],
                    "y1": target.bbox[3],
                    "xref": target.xref,
                    "newX0": target.bbox[0],
                    "newY0": target.bbox[1],
                    "newX1": target.bbox[2],
                    "newY1": target.bbox[3],
                    "replacementPath": str(replacement),
                }
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    infos = [info for info in document[0].get_image_info(xrefs=True) if info["width"] > 1]
    document.close()
    assert len(infos) == 2


def test_image_change_deleted_skips_replacement_validation(
    duplicate_xref_pdf: Path, tmp_path: Path
):
    listing = blocks(BlocksParams(path=str(duplicate_xref_pdf), page=0), silent_progress())
    target = next(item for item in listing.blocks if item.kind == "image")
    output = tmp_path / "deleted-one.pdf"
    apply(
        EditorApplyParams(
            path=str(duplicate_xref_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "imageChange",
                    "page": 1,
                    "x0": target.bbox[0],
                    "y0": target.bbox[1],
                    "x1": target.bbox[2],
                    "y1": target.bbox[3],
                    "xref": target.xref,
                    "replacementPath": str(tmp_path / "does-not-exist.png"),
                }
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    infos = [info for info in document[0].get_image_info(xrefs=True) if info["width"] > 1]
    document.close()
    assert len(infos) == 1


def test_image_change_missing_replacement_path_raises_and_leaves_other_pending_untouched(
    block_pdf: Path, tmp_path: Path
):
    listing = blocks(BlocksParams(path=str(block_pdf), page=0), silent_progress())
    image = next(item for item in listing.blocks if item.kind == "image")
    with pytest.raises(OpError):
        apply(
            EditorApplyParams(
                path=str(block_pdf),
                output=str(tmp_path / "should-not-exist.pdf"),
                objects=[
                    {
                        "kind": "text",
                        "page": 1,
                        "x0": 40.0,
                        "y0": 340.0,
                        "x1": 200.0,
                        "y1": 370.0,
                        "text": "Eklenen not",
                    },
                    {
                        "kind": "imageChange",
                        "page": 1,
                        "x0": image.bbox[0],
                        "y0": image.bbox[1],
                        "x1": image.bbox[2],
                        "y1": image.bbox[3],
                        "xref": image.xref,
                        "newX0": image.bbox[0],
                        "newY0": image.bbox[1],
                        "newX1": image.bbox[2],
                        "newY1": image.bbox[3],
                        "replacementPath": str(tmp_path / "missing.png"),
                    },
                ],
            ),
            silent_progress(),
        )
    assert not (tmp_path / "should-not-exist.pdf").exists()
    document = pymupdf.open(block_pdf)
    assert "Eklenen not" not in document[0].get_text()
    document.close()


def _subset_font_bytes(chars: str) -> bytes:
    loaded = TTFont(str(TEXTEDIT_FONT))
    subsetter = Subsetter()
    subsetter.populate(text=chars)
    subsetter.subset(loaded)
    buffer = io.BytesIO()
    loaded.save(buffer)
    return buffer.getvalue()


@pytest.fixture
def runs_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    page.insert_font(fontname="dejavu", fontfile=str(TEXTEDIT_FONT))
    page.insert_font(fontname="dejavub", fontfile=str(TEXTEDIT_FONT.parent / "DejaVuSans-Bold.ttf"))
    page.insert_text(
        (40, 60), "Hello ", fontsize=14, fontname="dejavu", fontfile=str(TEXTEDIT_FONT)
    )
    page.insert_text(
        (95, 60),
        "world",
        fontsize=14,
        fontname="dejavub",
        fontfile=str(TEXTEDIT_FONT.parent / "DejaVuSans-Bold.ttf"),
    )
    page.insert_text((40, 200), "Untouched neighbour text", fontsize=12, fontname="helv")
    path = tmp_path / "runs.pdf"
    document.save(path)
    document.close()
    return path


def test_bold_run_survives_editing_another_word_in_the_paragraph(runs_pdf: Path, tmp_path: Path):
    listing = blocks(BlocksParams(path=str(runs_pdf), page=0), silent_progress())
    paragraph = next(
        item for item in listing.blocks if item.kind == "text" and "world" in item.text
    )
    bold_run = next(run for line in paragraph.text_lines for run in line.runs if run.bold)
    plain_run = next(run for line in paragraph.text_lines for run in line.runs if not run.bold)
    output = tmp_path / "bold-survives.pdf"
    apply(
        EditorApplyParams(
            path=str(runs_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": paragraph.bbox[0],
                    "y0": paragraph.bbox[1],
                    "x1": paragraph.bbox[2] + 20,
                    "y1": paragraph.bbox[3],
                    "original": paragraph.bbox,
                    "text": paragraph.text,
                    "fontSize": paragraph.size,
                    "runs": [
                        {
                            "text": "Merhaba ",
                            "font": plain_run.font,
                            "fontXref": plain_run.font_xref,
                            "size": plain_run.size,
                            "color": plain_run.color,
                            "bold": False,
                        },
                        {
                            "text": "world",
                            "font": bold_run.font,
                            "fontXref": bold_run.font_xref,
                            "size": bold_run.size,
                            "color": bold_run.color,
                            "bold": True,
                        },
                    ],
                }
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    page = document[0]
    data = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
    text = page.get_text()
    document.close()
    assert "Merhaba" in text and "world" in text
    bold_spans = [
        span
        for block in data["blocks"]
        if block.get("type") == 0
        for line in block["lines"]
        for span in line["spans"]
        if "world" in span["text"]
    ]
    assert bold_spans and bool(bold_spans[0]["flags"] & 16)
    assert "DejaVu" in bold_spans[0]["font"]


def test_first_line_indent_is_preserved(runs_pdf: Path, tmp_path: Path):
    listing = blocks(BlocksParams(path=str(runs_pdf), page=0), silent_progress())
    paragraph = next(
        item for item in listing.blocks if item.kind == "text" and "world" in item.text
    )
    output = tmp_path / "indent.pdf"
    apply(
        EditorApplyParams(
            path=str(runs_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": paragraph.bbox[0],
                    "y0": paragraph.bbox[1],
                    "x1": paragraph.bbox[0] + 90,
                    "y1": paragraph.bbox[1] + 80,
                    "original": paragraph.bbox,
                    "text": "one two three four five six seven eight",
                    "fontSize": 12,
                    "firstLineIndent": 20,
                    "runs": [
                        {
                            "text": "one two three four five six seven eight",
                            "font": "helv",
                            "size": 12,
                        }
                    ],
                }
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    data = document[0].get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
    document.close()
    lines = [
        pymupdf.Rect(line["bbox"])
        for block in data["blocks"]
        if block.get("type") == 0
        for line in block["lines"]
        if any(span["text"].strip() for span in line["spans"])
    ]
    lines.sort(key=lambda box: box.y0)
    assert len(lines) >= 2
    assert lines[0].x0 > lines[1].x0 + 5


def test_justify_layout_does_not_overflow_box(runs_pdf: Path, tmp_path: Path):
    output = tmp_path / "justify.pdf"
    text = " ".join(["word"] * 20)
    result = apply(
        EditorApplyParams(
            path=str(runs_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": 40,
                    "y0": 240,
                    "x1": 200,
                    "y1": 340,
                    "original": [40, 240, 200, 340],
                    "text": text,
                    "fontSize": 11,
                    "align": "justify",
                    "runs": [{"text": text, "font": "helv", "size": 11}],
                }
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    data = document[0].get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
    document.close()
    for block in data["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            if not any(span["text"].strip() for span in line["spans"]):
                continue
            box = pymupdf.Rect(line["bbox"])
            assert box.x1 <= 200 + 3
    assert not any(warning.code == "textOverflow" for warning in result.warnings)


def test_a_paragraph_that_cannot_fit_names_its_text_in_the_warning(block_pdf: Path, tmp_path: Path):
    listing = blocks(BlocksParams(path=str(block_pdf), page=0), silent_progress())
    paragraph = next(item for item in listing.blocks if item.kind == "text" and item.line_count > 1)
    text = "Bu paragraf iki noktalık bir şeride asla sığmaz, hangi boyutta olursa olsun."
    x0, y0 = paragraph.bbox[0], paragraph.bbox[1]

    result = apply(
        EditorApplyParams(
            path=str(block_pdf),
            output=str(tmp_path / "sliver.pdf"),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": x0,
                    "y0": y0,
                    "x1": x0 + 2,
                    "y1": y0 + 2,
                    "text": text,
                    "fontSize": paragraph.size,
                    "font": paragraph.font,
                }
            ],
        ),
        silent_progress(),
    )

    overflow = [warning for warning in result.warnings if warning.code == "textOverflow"]
    assert [warning.detail for warning in overflow] == [text[:40]]


def test_font_substitution_reports_warning(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    subset = _subset_font_bytes("abc ")
    before = {entry[0] for entry in page.get_fonts(full=True)}
    page.insert_font(fontname="subsetfont", fontbuffer=subset)
    page.insert_text((40, 300), "abc", fontsize=12, fontname="subsetfont")
    xref = next(entry[0] for entry in page.get_fonts(full=True) if entry[0] not in before)
    path = tmp_path / "subset.pdf"
    document.save(path)
    document.close()
    output = tmp_path / "substituted.pdf"
    result = apply(
        EditorApplyParams(
            path=str(path),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": 40,
                    "y0": 290,
                    "x1": 200,
                    "y1": 320,
                    "original": [40, 288, 100, 312],
                    "text": "xyz",
                    "fontSize": 12,
                    "fontXref": xref,
                    "runs": [{"text": "xyz", "fontXref": xref, "size": 12}],
                }
            ],
        ),
        silent_progress(),
    )
    assert any(warning.code == "fontSubstituted" for warning in result.warnings)


def test_font_substitution_severity_info_for_matching_family(monkeypatch):
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    warnings: list[EditorWarning] = []
    atoms = [_Atom("Hi", "TimesNewRomanPS-BoldItalicMT", 99, 12, "#111111", True, True, False)]
    monkeypatch.setattr(
        "vivepdf.ops.editor.resolve_font",
        lambda *args, **kwargs: ResolvedFont("vpsabc", "times.ttf", None),
    )
    monkeypatch.setattr(
        "vivepdf.ops.editor.describe_resolution",
        lambda *args, **kwargs: FontResolution(
            family="Times New Roman", source="system", missing_glyphs=""
        ),
    )
    _resolve_styles(document, page, atoms, "obj1", warnings)
    document.close()
    warning = next(item for item in warnings if item.code == "fontSubstituted")
    assert warning.severity == "info"


def test_font_substitution_severity_warning_for_different_family(monkeypatch):
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    warnings: list[EditorWarning] = []
    atoms = [_Atom("Hi", "Calibri", 99, 12, "#111111", False, False, False)]
    monkeypatch.setattr(
        "vivepdf.ops.editor.resolve_font",
        lambda *args, **kwargs: ResolvedFont("vps999", "arial.ttf", None),
    )
    monkeypatch.setattr(
        "vivepdf.ops.editor.describe_resolution",
        lambda *args, **kwargs: FontResolution(family="Arial", source="system", missing_glyphs=""),
    )
    _resolve_styles(document, page, atoms, "obj1", warnings)
    document.close()
    warning = next(item for item in warnings if item.code == "fontSubstituted")
    assert warning.severity == "warning"


def test_redaction_leaves_neighbouring_block_intact(runs_pdf: Path, tmp_path: Path):
    listing = blocks(BlocksParams(path=str(runs_pdf), page=0), silent_progress())
    paragraph = next(
        item for item in listing.blocks if item.kind == "text" and "world" in item.text
    )
    output = tmp_path / "neighbour.pdf"
    apply(
        EditorApplyParams(
            path=str(runs_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": paragraph.bbox[0],
                    "y0": paragraph.bbox[1] - 30,
                    "x1": paragraph.bbox[2],
                    "y1": paragraph.bbox[3] + 5,
                    "original": paragraph.bbox,
                    "text": "Kisa",
                    "fontSize": paragraph.size,
                }
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    text = document[0].get_text()
    document.close()
    assert "Untouched neighbour text" in text
    assert "Hello" not in text and "world" not in text


def test_font_plan_reports_embedded_and_fallback_sources(embedded_pdf: Path):
    listing = blocks(BlocksParams(path=str(embedded_pdf), page=0), silent_progress())
    title = next(item for item in listing.blocks if item.kind == "text" and "Gömülü" in item.text)
    embedded = font_plan(
        FontPlanParams(path=str(embedded_pdf), page=0, fontXref=title.font_xref, text="şğı yeni"),
        silent_progress(),
    )
    assert embedded.source == "embedded"
    other = font_plan(
        FontPlanParams(
            path=str(embedded_pdf), page=0, fontFamily="Unknown-Font", bold=True, text="şğı"
        ),
        silent_progress(),
    )
    assert other.source in ("system", "fallback")


@pytest.fixture
def rotated_image_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    page.insert_image(pymupdf.Rect(40, 40, 120, 100), stream=_jpeg(), rotate=90)
    path = tmp_path / "rotated-image.pdf"
    document.save(path)
    document.close()
    return path


def test_image_move_preserves_original_placement_rotation(rotated_image_pdf: Path, tmp_path: Path):
    listing = blocks(BlocksParams(path=str(rotated_image_pdf), page=0), silent_progress())
    image = next(item for item in listing.blocks if item.kind == "image")
    output = tmp_path / "moved-rotated.pdf"
    apply(
        EditorApplyParams(
            path=str(rotated_image_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "imageChange",
                    "page": 1,
                    "x0": image.bbox[0],
                    "y0": image.bbox[1],
                    "x1": image.bbox[2],
                    "y1": image.bbox[3],
                    "xref": image.xref,
                    "newX0": image.bbox[0] + 40,
                    "newY0": image.bbox[1] + 40,
                    "newX1": image.bbox[2] + 40,
                    "newY1": image.bbox[3] + 40,
                }
            ],
        ),
        silent_progress(),
    )
    document = pymupdf.open(rotated_image_pdf)
    before_transform = document[0].get_image_info(xrefs=True)[0]["transform"]
    document.close()
    document = pymupdf.open(output)
    infos = [info for info in document[0].get_image_info(xrefs=True) if info["width"] > 1]
    document.close()
    assert len(infos) == 1
    after_transform = infos[0]["transform"]
    assert (abs(after_transform[0]) < 0.05) == (abs(before_transform[0]) < 0.05)
    assert (abs(after_transform[3]) < 0.05) == (abs(before_transform[3]) < 0.05)


def test_image_replace_rejects_unsupported_format(block_pdf: Path, tmp_path: Path):
    listing = blocks(BlocksParams(path=str(block_pdf), page=0), silent_progress())
    image = next(item for item in listing.blocks if item.kind == "image")
    bogus = tmp_path / "not-an-image.heic"
    bogus.write_bytes(b"not a real image payload")
    with pytest.raises(OpError):
        apply(
            EditorApplyParams(
                path=str(block_pdf),
                output=str(tmp_path / "rejected.pdf"),
                objects=[
                    {
                        "kind": "imageChange",
                        "page": 1,
                        "x0": image.bbox[0],
                        "y0": image.bbox[1],
                        "x1": image.bbox[2],
                        "y1": image.bbox[3],
                        "xref": image.xref,
                        "newX0": image.bbox[0],
                        "newY0": image.bbox[1],
                        "newX1": image.bbox[2],
                        "newY1": image.bbox[3],
                        "replacementPath": str(bogus),
                    }
                ],
            ),
            silent_progress(),
        )


def test_detect_hard_breaks_marks_short_lines() -> None:
    from vivepdf.ops.editor_blocks import detect_hard_breaks, join_lines

    boxes = [
        pymupdf.Rect(0, 0, 364, 20),
        pymupdf.Rect(0, 26, 236, 46),
        pymupdf.Rect(0, 52, 390, 72),
        pymupdf.Rect(0, 78, 385, 98),
        pymupdf.Rect(0, 104, 120, 124),
    ]
    texts = ["Fakülte: A", "Bölüm: B", "long wrapped-", "line continues", "end"]
    flags = detect_hard_breaks(boxes, texts)
    assert flags == [True, True, False, False, False]
    assert join_lines(texts, flags) == "Fakülte: A\nBölüm: B\nlong wrappedline continues end"
    wrapped = [
        pymupdf.Rect(0, 0, 200, 20),
        pymupdf.Rect(0, 26, 230, 46),
        pymupdf.Rect(0, 52, 180, 72),
    ]
    assert detect_hard_breaks(
        wrapped, ["Birinci satir burada", "ikinci satir devam eder", "biter."]
    ) == [
        False,
        False,
        False,
    ]


def _marked_png() -> bytes:
    image = Image.new("RGB", (40, 20), (255, 255, 255))
    for x in range(10):
        for y in range(10):
            image.putpixel((x, y), (255, 0, 0))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _red_corner(page: pymupdf.Page, rect: pymupdf.Rect) -> str | None:
    pixmap = page.get_pixmap()
    corners = {
        "tl": (rect.x0 + 2, rect.y0 + 2),
        "tr": (rect.x1 - 2, rect.y0 + 2),
        "bl": (rect.x0 + 2, rect.y1 - 2),
        "br": (rect.x1 - 2, rect.y1 - 2),
    }
    for name, (x, y) in corners.items():
        red, green, _blue = pixmap.pixel(int(x), int(y))[:3]
        if red > 200 and green < 80:
            return name
    return None


def _placed_image_pdf(tmp_path: Path, page_rotation: int, image_rotation: int) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=300, height=400)
    page.set_rotation(page_rotation)
    page.insert_image(pymupdf.Rect(50, 50, 130, 130), stream=_marked_png(), rotate=image_rotation)
    path = tmp_path / f"placed-{page_rotation}-{image_rotation}.pdf"
    document.save(path)
    document.close()
    return path


def _visible_image_rect(path: Path) -> tuple[pymupdf.Rect, str | None]:
    document = pymupdf.open(path)
    page = document[0]
    infos = [info for info in page.get_image_info(xrefs=True) if info["width"] > 1]
    rect = pymupdf.Rect(infos[-1]["bbox"]) * page.rotation_matrix
    rect.normalize()
    corner = _red_corner(page, rect)
    document.close()
    return rect, corner


@pytest.mark.parametrize(
    ("page_rotation", "image_rotation"), [(0, 90), (0, 270), (90, 0), (90, 90), (270, 180)]
)
def test_image_blocks_report_visible_placement_rotation(
    tmp_path: Path, page_rotation: int, image_rotation: int
):
    source = _placed_image_pdf(tmp_path, page_rotation, image_rotation)
    listing = blocks(BlocksParams(path=str(source), page=0), silent_progress())
    image = next(item for item in listing.blocks if item.kind == "image")
    assert image.placement_rotation == (page_rotation - image_rotation) % 360


@pytest.mark.parametrize(
    ("page_rotation", "image_rotation"), [(0, 90), (0, 180), (90, 0), (90, 90), (270, 180)]
)
def test_replacement_image_keeps_original_placement_rotation(
    tmp_path: Path, page_rotation: int, image_rotation: int
):
    source = _placed_image_pdf(tmp_path, page_rotation, image_rotation)
    _before_rect, before_corner = _visible_image_rect(source)
    listing = blocks(BlocksParams(path=str(source), page=0), silent_progress())
    image = next(item for item in listing.blocks if item.kind == "image")
    replacement = tmp_path / "replacement.png"
    replacement.write_bytes(_marked_png())
    output = tmp_path / "replaced.pdf"
    apply(
        EditorApplyParams(
            path=str(source),
            output=str(output),
            objects=[
                {
                    "kind": "imageChange",
                    "page": 1,
                    "x0": image.bbox[0],
                    "y0": image.bbox[1],
                    "x1": image.bbox[2],
                    "y1": image.bbox[3],
                    "xref": image.xref,
                    "newX0": image.bbox[0],
                    "newY0": image.bbox[1],
                    "newX1": image.bbox[2],
                    "newY1": image.bbox[3],
                    "replacementPath": str(replacement),
                }
            ],
        ),
        silent_progress(),
    )
    _after_rect, after_corner = _visible_image_rect(output)
    assert before_corner is not None
    assert after_corner == before_corner


@pytest.mark.parametrize(("page_rotation", "image_rotation"), [(90, 0), (90, 90), (180, 270)])
def test_image_move_on_rotated_page_keeps_visible_orientation(
    tmp_path: Path, page_rotation: int, image_rotation: int
):
    source = _placed_image_pdf(tmp_path, page_rotation, image_rotation)
    _before_rect, before_corner = _visible_image_rect(source)
    listing = blocks(BlocksParams(path=str(source), page=0), silent_progress())
    image = next(item for item in listing.blocks if item.kind == "image")
    output = tmp_path / "moved.pdf"
    apply(
        EditorApplyParams(
            path=str(source),
            output=str(output),
            objects=[
                {
                    "kind": "imageChange",
                    "page": 1,
                    "x0": image.bbox[0],
                    "y0": image.bbox[1],
                    "x1": image.bbox[2],
                    "y1": image.bbox[3],
                    "xref": image.xref,
                    "newX0": image.bbox[0] + 30,
                    "newY0": image.bbox[1] + 30,
                    "newX1": image.bbox[2] + 30,
                    "newY1": image.bbox[3] + 30,
                }
            ],
        ),
        silent_progress(),
    )
    _after_rect, after_corner = _visible_image_rect(output)
    assert after_corner == before_corner
