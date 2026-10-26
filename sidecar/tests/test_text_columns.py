from pathlib import Path

import pymupdf

from vivepdf.ops._columns import column_order, column_split
from vivepdf.ops._markup import page_html, page_markup
from vivepdf.ops.convert_text import page_text

SIDECAR = Path(__file__).resolve().parent.parent
FONT = str(SIDECAR / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf")
LEFT = [
    "Sol sütunun ilk satırı burada",
    "başlıyor ve okuma bu sütunda",
    "aşağı doğru devam etmeli, sonra",
    "sağ sütuna geçilmeli.",
]
RIGHT = [
    "Sağ sütun ikinci bölümdür ve",
    "sol sütun bittikten sonra",
    "okunmalıdır; aksi hâlde cümleler",
    "birbirine karışır.",
]


def _write(page: pymupdf.Page, point: tuple[float, float], text: str) -> None:
    page.insert_text(point, text, fontsize=10, fontname="dejavu", fontfile=FONT)


def _interleaved_page() -> pymupdf.Page:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (50, 60), "Ortak başlık iki sütunun üstünde, sayfa boyunca uzanır")
    for number, (left, right) in enumerate(zip(LEFT, RIGHT, strict=True)):
        _write(page, (50, 90 + number * 14), left)
        _write(page, (310, 90 + number * 14), right)
    _write(page, (50, 90 + 4 * 14), "Sol sütun bir satır daha sürüyor.")
    return page


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def test_plain_text_reads_interleaved_columns_one_after_the_other() -> None:
    page = _interleaved_page()

    lines = _lines(page_text(page, False))

    assert lines == [
        "Ortak başlık iki sütunun üstünde, sayfa boyunca uzanır",
        *LEFT,
        "Sol sütun bir satır daha sürüyor.",
        *RIGHT,
    ]


def test_html_gives_each_column_its_own_paragraph_in_reading_order() -> None:
    page = _interleaved_page()

    html = page_html(page_markup(page), 10)

    left = html.index("Sol sütunun ilk satırı burada başlıyor")
    tail = html.index("Sol sütun bir satır daha sürüyor.")
    right = html.index("Sağ sütun ikinci bölümdür ve sol sütun")
    assert html.index("Ortak başlık") < left < tail < right
    assert "burada Sağ" not in html


def test_a_ruled_two_column_table_keeps_its_rows_together() -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for number in range(5):
        top = 100 + number * 30
        page.draw_rect(pymupdf.Rect(40, top, 300, top + 30), color=(0, 0, 0))
        page.draw_rect(pymupdf.Rect(300, top, 560, top + 30), color=(0, 0, 0))
        _write(page, (46, top + 19), f"Birinci hücre {number} için açıklama")
        _write(page, (306, top + 19), f"İkinci hücre {number} için açıklama")

    lines = _lines(page_text(page, False))

    assert lines[0] == "Birinci hücre 0 için açıklama İkinci hücre 0 için açıklama"


def test_short_labels_beside_values_are_not_taken_for_columns() -> None:
    lines = [(pymupdf.Rect(50, 100 + row * 14, 120, 110 + row * 14), 1) for row in range(6)] + [
        (pymupdf.Rect(310, 100 + row * 14, 500, 110 + row * 14), 5) for row in range(6)
    ]

    assert column_split(lines) is None


def test_a_heading_beside_the_top_of_a_column_is_read_before_both_columns() -> None:
    heading = (pymupdf.Rect(310, 40, 500, 52), "başlık")
    left = [
        (pymupdf.Rect(50, 100 + row * 14, 290, 110 + row * 14), f"sol {row}") for row in range(5)
    ]
    right = [
        (pymupdf.Rect(310, 100 + row * 14, 550, 110 + row * 14), f"sağ {row}") for row in range(4)
    ]
    items = [
        heading,
        *[pair for pairs in zip(left, right, strict=False) for pair in pairs],
        left[4],
    ]
    columns = column_split([(rect, 5) for rect, _text in items])

    assert columns is not None
    assert column_order(items, columns) == [
        "başlık",
        *[text for _rect, text in left],
        *[text for _rect, text in right],
    ]


def _turned_page(rotation: int, cropbox: pymupdf.Rect | None = None) -> pymupdf.Page:
    document = pymupdf.open()
    page = document.new_page(width=700, height=900)
    if cropbox is not None:
        page.set_cropbox(cropbox)
    page.set_rotation(rotation)
    return page


def _write_upright(page: pymupdf.Page, point: tuple[float, float], text: str) -> None:
    page.insert_text(
        pymupdf.Point(point) * page.derotation_matrix,
        text,
        fontsize=10,
        fontname="dejavu",
        fontfile=FONT,
        rotate=page.rotation,
    )


def _two_columns(page: pymupdf.Page) -> None:
    _write_upright(page, (50, 60), "Ortak başlık iki sütunun üstünde, sayfa boyunca uzanır")
    for number, (left, right) in enumerate(zip(LEFT, RIGHT, strict=True)):
        _write_upright(page, (50, 90 + number * 14), left)
        _write_upright(page, (450, 90 + number * 14), right)


def test_plain_text_reads_the_columns_of_a_turned_landscape_page_one_after_the_other() -> None:
    page = _turned_page(90)
    _two_columns(page)

    lines = _lines(page_text(page, False))

    assert lines == ["Ortak başlık iki sütunun üstünde, sayfa boyunca uzanır", *LEFT, *RIGHT]


def test_html_reads_the_columns_of_a_turned_page_with_an_offset_crop_box() -> None:
    page = _turned_page(270, pymupdf.Rect(60, 40, 660, 880))
    _two_columns(page)

    html = page_html(page_markup(page), 10)

    left = html.index("Sol sütunun ilk satırı burada başlıyor")
    right = html.index("Sağ sütun ikinci bölümdür ve sol sütun")
    assert html.index("Ortak başlık") < left < right
    assert "burada Sağ" not in html


def test_a_ruled_two_column_table_on_a_turned_page_keeps_its_rows_together() -> None:
    page = _turned_page(90)
    turn = page.derotation_matrix
    for number in range(5):
        top = 100 + number * 30
        page.draw_rect(pymupdf.Rect(40, top, 420, top + 30) * turn, color=(0, 0, 0))
        page.draw_rect(pymupdf.Rect(420, top, 800, top + 30) * turn, color=(0, 0, 0))
        _write_upright(page, (46, top + 19), f"Birinci hücre {number} için açıklama")
        _write_upright(page, (426, top + 19), f"İkinci hücre {number} için açıklama")

    lines = _lines(page_text(page, False))

    assert lines[0] == "Birinci hücre 0 için açıklama İkinci hücre 0 için açıklama"
