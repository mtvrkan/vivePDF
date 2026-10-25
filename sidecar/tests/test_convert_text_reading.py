import zipfile
from pathlib import Path

import pymupdf

from vivepdf.ops._markup import inert_markdown
from vivepdf.ops.convert import TextSourceParams
from vivepdf.ops.convert_text import (
    MarkdownParams,
    TextParams,
    _joined_lines,
    _turned_boxes,
    to_html,
    to_markdown,
    to_text,
)
from vivepdf.ops.epub import EpubParams, to_epub
from vivepdf.rpc.progress import silent_progress

SIDECAR = Path(__file__).resolve().parent.parent
FONT = str(SIDECAR / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf")


def _write(page: pymupdf.Page, point: tuple[float, float], text: str, size: float = 12) -> None:
    page.insert_text(point, text, fontsize=size, fontname="dejavu", fontfile=FONT)


def _text(document: pymupdf.Document, tmp_path: Path, layout: bool = False) -> list[str]:
    source = tmp_path / "kaynak.pdf"
    document.save(source)
    document.close()
    result = to_text(
        TextParams(path=str(source), output=str(tmp_path / "metin.txt"), layout=layout),
        silent_progress(),
    )
    text = Path(result.output).read_text(encoding="utf-8")
    return [line.strip() for line in text.splitlines() if line.strip()]


def test_justified_words_and_a_bullet_stay_on_one_line(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "•")
    left = 92
    for word in ("Sağlık,", "işyeri", "güvenliği", "ve", "çevre"):
        _write(page, (left, 100), word)
        left += 90
    _write(page, (92, 116), "için tehdit oluşturur.")

    lines = _text(document, tmp_path)

    assert lines == ["• Sağlık, işyeri güvenliği ve çevre", "için tehdit oluşturur."]


def test_ligatures_come_out_as_separate_letters(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "ﬁyat ve ﬂama")

    assert _text(document, tmp_path) == ["fiyat ve flama"]


def test_layout_text_spells_out_ligatures_too(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "ﬁyat ve ﬂama")

    assert _text(document, tmp_path, layout=True) == ["fiyat ve flama"]


def test_cells_of_a_table_row_come_out_as_one_line(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for row, cells in enumerate((("Kalem", "Adet", "Tutar"), ("Defter", "5", "120,00"))):
        for column, cell in enumerate(cells):
            _write(page, (72 + column * 150, 100 + row * 20), cell)

    assert _text(document, tmp_path) == ["Kalem Adet Tutar", "Defter 5 120,00"]


def test_upright_and_turned_lines_are_both_kept(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "Yatay satır")
    page.insert_text(
        (40, 600), "Kenar yazısı", fontsize=12, fontname="dejavu", fontfile=FONT, rotate=90
    )

    lines = _text(document, tmp_path)

    assert "Yatay satır" in lines and "Kenar yazısı" in lines


def _span(text: str, x0: float, x1: float, baseline: float, size: float = 18) -> dict:
    return {
        "text": text,
        "size": size,
        "flags": 0,
        "origin": (x0, baseline),
        "bbox": pymupdf.Rect(x0, baseline - size * 0.8, x1, baseline + size * 0.2),
        "dir": (1.0, 0.0),
    }


def _line(*spans: dict) -> dict:
    bbox = pymupdf.Rect(spans[0]["bbox"])
    for span in spans[1:]:
        bbox |= span["bbox"]
    return {"bbox": bbox, "spans": list(spans)}


def test_markdown_puts_split_words_of_a_justified_line_back_in_order() -> None:
    lines = [
        _line(_span("insan", 100, 150, 100)),
        _line(_span("ve", 300, 320, 122), _span("tehdit", 500, 550, 122)),
        _line(_span("sağlığı,", 100, 160, 122.4), _span("çevre", 400, 450, 122.4)),
        _line(_span("oluşturur.", 100, 190, 144)),
    ]

    joined = _joined_lines(lines)

    assert [[span["text"] for span in line["spans"]] for line in joined] == [
        ["insan"],
        ["sağlığı,", "ve", "çevre", "tehdit"],
        ["oluşturur."],
    ]
    assert joined[1]["bbox"].x0 == 100 and joined[1]["bbox"].x1 == 550


def test_markdown_keeps_overlapping_lines_on_one_baseline_apart() -> None:
    lines = [_line(_span("Kalın", 100, 160, 100)), _line(_span("gölge", 120, 180, 100))]

    assert len(_joined_lines(lines)) == 2


def test_markdown_does_not_turn_a_small_raised_marker_into_a_footnote() -> None:
    lines = [_line(_span("–", 100, 108, 229.5, 13.5)), _line(_span("Patent", 128, 200, 232.5))]

    assert len(_joined_lines(lines)) == 2


def _turned_page(document: pymupdf.Document) -> pymupdf.Page:
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "Yatay başlık satırı", 14)
    _write(page, (72, 130), "Gövde metni devam ediyor.")
    page.insert_text(
        (30, 700), "Kenar yazısı", fontsize=12, fontname="dejavu", fontfile=FONT, rotate=90
    )
    page.insert_text(
        (100, 400),
        "Eğik damga",
        fontsize=20,
        fontname="dejavu",
        fontfile=FONT,
        morph=(pymupdf.Point(100, 400), pymupdf.Matrix(-15)),
    )
    return page


def test_markdown_keeps_turned_and_slanted_lines(tmp_path: Path) -> None:
    document = pymupdf.open()
    _turned_page(document)
    source = tmp_path / "kaynak.pdf"
    document.save(source)
    document.close()

    result = to_markdown(
        MarkdownParams(path=str(source), output=str(tmp_path / "metin.md")), silent_progress()
    )

    markdown = Path(result.output).read_text(encoding="utf-8")
    assert "Gövde metni devam ediyor." in markdown
    assert "Kenar yazısı" in markdown and "Eğik damga" in markdown
    assert markdown.index("Gövde") < markdown.index("Kenar yazısı")


def test_layout_text_keeps_turned_and_slanted_lines(tmp_path: Path) -> None:
    document = pymupdf.open()
    _turned_page(document)

    lines = _text(document, tmp_path, layout=True)

    assert lines[:2] == ["Yatay başlık satırı", "Gövde metni devam ediyor."]
    assert "Kenar yazısı" in lines and "Eğik damga" in lines


def test_turned_lines_inside_a_table_are_left_to_the_table() -> None:
    document = pymupdf.open()
    page = _turned_page(document)

    boxes = _turned_boxes(page, [pymupdf.Rect(0, 0, 80, 842)])

    assert [box.textlines[0]["spans"][0]["text"] for box in boxes] == ["Eğik damga"]


def _markdown(document: pymupdf.Document, tmp_path: Path) -> str:
    source = tmp_path / "bağlantı.pdf"
    document.save(source)
    document.close()
    result = to_markdown(
        MarkdownParams(path=str(source), output=str(tmp_path / "bağlantı.md")), silent_progress()
    )
    return Path(result.output).read_text(encoding="utf-8")


def _link(page: pymupdf.Page, rect: pymupdf.Rect, uri: str) -> None:
    page.insert_link({"kind": pymupdf.LINK_URI, "from": rect, "uri": uri})


def test_markdown_links_a_word_whose_link_box_is_shorter_than_its_line(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "Ayrıntılar için Konferans sayfasına bakınız.", 14)
    word = page.search_for("Konferans")[0]
    _link(page, pymupdf.Rect(word.x0, 100 - 14 * 0.35, word.x1, 100), "https://x.org/k")

    markdown = _markdown(document, tmp_path)

    assert "için [Konferans](https://x.org/k) sayfasına" in markdown


def test_markdown_link_does_not_reach_the_line_above(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "Üst satırdaki metin burada", 14)
    _write(page, (72, 116), "Alt satırdaki bağlantı", 14)
    words = page.search_for("satırdaki bağlantı")[0]
    _link(page, pymupdf.Rect(words.x0, words.y0 - 3, words.x1, words.y1), "https://x.org/b")

    markdown = _markdown(document, tmp_path)

    assert markdown.count("](https://x.org/b)") == 1
    assert "[satırdaki bağlantı](https://x.org/b)" in markdown


def test_markdown_does_not_link_bare_punctuation(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "Bu bir deneme , olsun", 14)
    comma = page.search_for(",")[0]
    _link(page, comma, "https://x.org/c")

    markdown = _markdown(document, tmp_path)

    assert "https://x.org/c" not in markdown


def _picture_count(document: pymupdf.Document, tmp_path: Path) -> int:
    source = tmp_path / "grafik.pdf"
    document.save(source)
    document.close()
    result = to_markdown(
        MarkdownParams(path=str(source), output=str(tmp_path / "grafik.md"), pictures="embed"),
        silent_progress(),
    )
    return result.picture_count


def _bars(page: pymupdf.Page, top: float, gap: float) -> None:
    for number, height in enumerate((60, 120, 90, 150, 110)):
        left = 100 + number * (50 + gap)
        page.draw_rect(
            pymupdf.Rect(left, top + 150 - height, left + 50, top + 150), fill=(0.3, 0.5, 0.9)
        )


def test_markdown_keeps_the_bars_of_a_chart_as_one_picture(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "Çeyrek sonuçları aşağıdaki grafikte gösterilmiştir.")
    _bars(page, 200, 22)
    _write(page, (72, 420), "Grafikten sonra gelen paragraf metni.")

    assert _picture_count(document, tmp_path) == 1


def test_markdown_keeps_separate_photos_apart(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "İki ayrı ekran görüntüsü:")
    for top, shade in ((140, 40), (400, 200)):
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 40), 0)
        pixmap.clear_with(shade)
        page.insert_image(pymupdf.Rect(72, top, 512, top + 250), pixmap=pixmap)

    assert _picture_count(document, tmp_path) == 2


def test_markdown_gives_a_scanned_page_as_a_picture(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    pixmap = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 124, 175), 0)
    pixmap.clear_with(220)
    page.insert_image(page.rect, pixmap=pixmap)
    document.new_page(width=595, height=842)
    source = tmp_path / "tarama.pdf"
    document.save(source)
    document.close()

    result = to_markdown(
        MarkdownParams(path=str(source), output=str(tmp_path / "tarama.md"), pictures="files"),
        silent_progress(),
    )

    markdown = Path(result.output).read_text(encoding="utf-8")
    assert result.picture_count == 1
    assert result.textless_pages == [1, 2]
    assert "](tarama-images/page-0001-01.png)" in markdown
    assert (tmp_path / "tarama-images" / "page-0001-01.png").is_file()


def test_markdown_puts_punctuation_right_after_emphasis() -> None:
    markdown = inert_markdown("- **Terfi etmenin** , o _eğik_ . ~~çizik~~ ; **ek** ) son")

    assert markdown == "- **Terfi etmenin**, o _eğik_. ~~çizik~~; **ek**) son"


def test_markdown_leaves_spaced_punctuation_without_emphasis_and_in_code() -> None:
    markdown = inert_markdown("2 * 3 , olur ve `**k** ,` kalır")

    assert markdown == "2 * 3 , olur ve `**k** ,` kalır"


def _report(tmp_path: Path, pages: int) -> Path:
    document = pymupdf.open()
    for number in range(1, pages + 1):
        page = document.new_page(width=595, height=842)
        _write(page, (72, 50), "Kurum Faaliyet Raporu", 9)
        _write(page, (72, 200), f"Bölüm {number} gövde metni burada yer alır.")
        _write(page, (480, 810), f"sayfa {number} / {pages}", 9)
    source = tmp_path / "rapor.pdf"
    document.save(source)
    document.close()
    return source


def _outputs(source: Path, tmp_path: Path) -> dict[str, str]:
    text = to_text(TextParams(path=str(source), output=str(tmp_path / "r.txt")), silent_progress())
    markdown = to_markdown(
        MarkdownParams(path=str(source), output=str(tmp_path / "r.md")), silent_progress()
    )
    html = to_html(
        TextSourceParams(path=str(source), output=str(tmp_path / "r.html")), silent_progress()
    )
    epub = to_epub(EpubParams(path=str(source), output=str(tmp_path / "r.epub")), silent_progress())
    with zipfile.ZipFile(epub.output) as archive:
        chapters = "".join(
            archive.read(name).decode("utf-8")
            for name in archive.namelist()
            if name.startswith("OEBPS/text/")
        )
    return {
        "text": Path(text.output).read_text(encoding="utf-8"),
        "markdown": Path(markdown.output).read_text(encoding="utf-8"),
        "html": Path(html.output).read_text(encoding="utf-8"),
        "epub": chapters,
    }


def test_running_headers_and_page_numbers_are_left_out(tmp_path: Path) -> None:
    outputs = _outputs(_report(tmp_path, 4), tmp_path)

    for name, output in outputs.items():
        assert "Bölüm 3 gövde metni" in output, name
        assert "Faaliyet Raporu" not in output, name
        assert "sayfa 2" not in output, name


def test_short_documents_keep_their_header_and_footer(tmp_path: Path) -> None:
    outputs = _outputs(_report(tmp_path, 2), tmp_path)

    for name, output in outputs.items():
        assert "Faaliyet Raporu" in output and "sayfa 2 / 2" in output, name


def _struck_markdown(tmp_path: Path, hidden: bool) -> str:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "Giriş paragrafı burada duruyor.")
    page.draw_rect(pymupdf.Rect(60, 194, 500, 196), color=None, fill=(0.8, 0.1, 0.2))
    if hidden:
        page.draw_rect(pymupdf.Rect(70, 170, 520, 220), color=None, fill=(0.9, 0.85, 0.8))
    _write(page, (80, 200), "Bir bakıma yükselen refahın faturası kesilmektedir.", 14)
    return _markdown(document, tmp_path)


def test_markdown_ignores_a_strike_line_hidden_behind_a_panel(tmp_path: Path) -> None:
    markdown = _struck_markdown(tmp_path, hidden=True)

    assert "Bir bakıma yükselen" in markdown and "~~" not in markdown


def test_markdown_keeps_a_visible_strike_line(tmp_path: Path) -> None:
    markdown = _struck_markdown(tmp_path, hidden=False)

    assert "~~" in markdown


def test_markdown_keeps_right_to_left_words_in_reading_order(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_htmlbox(
        pymupdf.Rect(72, 80, 520, 200),
        '<p dir="rtl" style="font-size:16px">שלום עולם וברוכים הבאים</p><p>Soldan sağa satır.</p>',
    )

    markdown = _markdown(document, tmp_path)

    assert "שלום עולם וברוכים הבאים" in markdown
    assert "Soldan sağa satır." in markdown
