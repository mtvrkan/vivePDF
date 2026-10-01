from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import _watermark_text_removal
from vivepdf.ops._content import content_tokens
from vivepdf.ops._text_order import place_in_order, state_before
from vivepdf.ops._watermark_style import WATERMARK_FONT_BOLD
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.progress import silent_progress


def _line(index: int, head: str = "Govde") -> str:
    return f"{head}{index:02d} satiri icerik metni burada devam ediyor ve uzuyor{index:02d}."


def _stamp(page: pymupdf.Page, angle: float) -> None:
    page.insert_text(
        (60, 460),
        "TASLAK",
        fontsize=150,
        fontname="wm",
        fontfile=str(WATERMARK_FONT_BOLD),
        color=(0.8, 0.8, 0.85),
        morph=(pymupdf.Point(300, 420), pymupdf.Matrix(angle)),
    )


def _one_text_object_per_line(path: Path, angle: float) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index in range(60):
        page.insert_text((40, 60 + index * 12), _line(index), fontsize=10)
    _stamp(page, angle)
    document.save(path)
    document.close()


def _one_text_object_for_the_page(path: Path, angle: float) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((40, 40), "x", fontsize=10)
    body = b"".join(f"({_line(index, 'Paragraf')}) Tj 0 -12 Td ".encode() for index in range(60))
    xref = page.get_contents()[0]
    document.update_stream(xref, b"q BT /helv 10 Tf 40 780 Td " + body + b"ET Q")
    _stamp(page, angle)
    document.save(path)
    document.close()


def _words(page: pymupdf.Page) -> list[tuple[str, float, float]]:
    return [
        (word[4], word[0], word[1]) for word in page.get_text("words") if "TASLA" not in word[4]
    ]


@pytest.mark.parametrize("build", [_one_text_object_per_line, _one_text_object_for_the_page])
@pytest.mark.parametrize("angle", [30, -20])
def test_restored_words_keep_their_place_in_the_content_stream(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build, angle: float
) -> None:
    source = tmp_path / "isaretli.pdf"
    build(source, angle)
    with pymupdf.open(source) as document:
        expected_lines = [
            line for line in document[0].get_text().splitlines() if "TASLA" not in line
        ]
        expected_words = _words(document[0])

    restored: list[int] = []
    original = _watermark_text_removal._put_back

    def counting(page: pymupdf.Page, plan: list[dict], *rest: object) -> None:
        restored.append(sum(len(entry["chars"]) for entry in plan))
        original(page, plan, *rest)

    monkeypatch.setattr(_watermark_text_removal, "_put_back", counting)
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "temiz.pdf"),
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert sum(restored) > 0
    with pymupdf.open(result.output) as document:
        page = document[0]
        assert "TASLAK" not in page.get_text()
        assert page.get_text().splitlines() == expected_lines
        words = _words(page)
    assert [word[0] for word in words] == [word[0] for word in expected_words]
    for got, want in zip(words, expected_words, strict=True):
        assert abs(got[1] - want[1]) < 0.05 and abs(got[2] - want[2]) < 0.05


def test_the_text_state_follows_line_moves_and_saved_states() -> None:
    data = b"q 2 0 0 2 10 20 cm BT /F1 9 Tf 12 TL 5 6 Td T* (a) Tj Q BT 1 0 0 1 7 8 Tm (b) Tj ET"
    tokens = content_tokens(data)
    first = next(index for index, token in enumerate(tokens) if token[2] == b"Tj")
    state = state_before(tokens, first)
    assert tuple(state.ctm) == (2, 0, 0, 2, 10, 20)
    assert tuple(state.line) == (1, 0, 0, 1, 5, -6)
    assert state.size == 9 and state.in_text
    last = len(tokens) - 2
    later = state_before(tokens, last)
    assert tuple(later.ctm) == (1, 0, 0, 1, 0, 0)
    assert tuple(later.line) == (1, 0, 0, 1, 7, 8)
    assert later.size == 0


def _page_with(content: bytes) -> tuple[pymupdf.Document, pymupdf.Page, bytes]:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((40, 40), "x", fontsize=10)
    font = page.get_fonts()[0][4]
    data = content.replace(b"/F ", f"/{font} ".encode())
    document.update_stream(page.get_contents()[0], data)
    return document, page, data


def _chunk(page: pymupdf.Page, text: str, origin: tuple[float, float]) -> tuple[bytes, tuple]:
    font = page.get_fonts()[0][4]
    top = page.rect.height - origin[1]
    chunk = f"BT /{font} 10 Tf 1 0 0 1 {origin[0]} {top} Tm ({text}) Tj ET".encode()
    return chunk, (text[0], float(origin[0]), float(origin[1]))


def _shown(page: pymupdf.Page, data: bytes) -> list[str]:
    page.parent.update_stream(page.get_contents()[0], data)
    words = page.get_text("words", flags=pymupdf.TEXT_CLIP)
    return list(dict.fromkeys(word[4] for word in words))


def test_a_word_with_nothing_before_it_goes_before_the_first_text_object() -> None:
    document, page, data = _page_with(
        b"q 1 1 1 rg 0 0 595 842 re f Q "
        b"q BT /F 10 Tf 40 780 Td (Ikinci) Tj 0 -12 Td (Ucuncu) Tj ET Q"
    )
    chunk, own = _chunk(page, "Birinci", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.index(b"re f") < placed.index(b"(Birinci)") < placed.index(b"(Ikinci)")
    assert _shown(page, placed) == ["Birinci", "Ikinci", "Ucuncu"]
    document.close()


def test_a_word_inside_clipping_text_comes_back_after_the_clip_is_lifted() -> None:
    document, page, data = _page_with(
        b"q BT 4 Tr /F 10 Tf 40 780 Td (Kirpan) Tj 0 -12 Td (Metin) Tj ET Q "
        b"q BT /F 10 Tf 40 700 Td (Duz) Tj ET Q"
    )
    chunk, own = _chunk(page, "Geri", (120, 62))
    placed = place_in_order(page, data, chunk, ("K", 40.0, 62.0), own)
    assert placed is not None
    assert placed.index(b"(Metin)") < placed.index(b"(Geri)") < placed.index(b"(Duz)")
    assert _shown(page, placed) == ["Kirpan", "Metin", "Geri", "Duz"]
    document.close()


def test_a_word_under_a_clip_inside_tagged_content_at_the_top_leaves_and_reenters_it() -> None:
    document, page, data = _page_with(
        b"/P <</MCID 0>> BDC 0 0 1 1 re W n 1 1 1 rg 0 0 595 842 re f"
        b" q BT /F 10 Tf 40 780 Td (Tek) Tj ET Q EMC"
    )
    chunk, own = _chunk(page, "Yok", (40, 50))
    assert place_in_order(page, data, chunk, None, None) is None
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.index(b"/MCID 0") < placed.index(b"(Yok)") < placed.index(b"/MCID 1")
    assert placed.index(b"/MCID 1") < placed.index(b"(Tek)")
    assert placed.count(b"BDC") == placed.count(b"EMC")
    assert placed.count(b"q") == placed.count(b"Q")
    assert _shown(page, placed) == ["Yok"]
    document.close()


def test_a_word_under_a_clip_opened_outside_any_save_goes_to_the_start() -> None:
    document, page, data = _page_with(b"0 0 1 1 re W n q BT /F 10 Tf 40 780 Td (Tek) Tj ET Q")
    chunk, own = _chunk(page, "Yok", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.index(b"(Yok)") < placed.index(b"re W n") < placed.index(b"(Tek)")
    assert _shown(page, placed) == ["Yok"]
    document.close()


def test_a_word_goes_before_a_clip_when_what_is_drawn_inside_it_lies_elsewhere() -> None:
    document, page, data = _page_with(
        b"q 0 0 1 1 re W n 0 0 1 rg 500 0 20 20 re f BT /F 10 Tf 40 780 Td (Tek) Tj ET Q "
        b"q BT /F 10 Tf 40 700 Td (Son) Tj ET Q"
    )
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.index(b"(Once)") < placed.index(b"re W n") < placed.index(b"(Tek)")
    assert _shown(page, placed) == ["Once", "Son"]
    document.close()


def test_a_word_under_a_shading_inside_the_clip_leaves_the_clip_and_comes_back() -> None:
    document, page, data = _page_with(
        b"q 0 0 1 1 re W n /Sh1 sh BT /F 10 Tf 40 780 Td (Tek) Tj ET Q"
    )
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.index(b"sh") < placed.index(b"(Once)") < placed.index(b"(Tek)")
    assert placed.count(b"0 0 1 1 re W n") == 2
    assert _shown(page, placed) == ["Once"]
    document.close()


def test_a_word_under_a_clip_opened_before_the_first_text_goes_before_that_clip() -> None:
    document, page, data = _page_with(
        b"q 0 0 1 1 re W n BT /F 10 Tf 40 780 Td (Tek) Tj ET Q "
        b"q BT /F 10 Tf 40 700 Td (Son) Tj ET Q"
    )
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.index(b"(Once)") < placed.index(b"re W n") < placed.index(b"(Tek)")
    assert _shown(page, placed) == ["Once", "Son"]
    document.close()


def test_a_word_under_a_fill_inside_the_clip_is_drawn_over_it_outside_the_clip() -> None:
    document, page, data = _page_with(
        b"q 2 0 0 2 0 0 cm 0 0 300 300 re W* n 0 0 1 rg 0.5 w [2] 0 d"
        b" 0 0 300 421 re f q 0 1 0 rg 10 10 5 5 re f Q"
        b" BT /F 10 Tf 20 280 Td (Tek) Tj ET 1 0 0 rg 0 0 10 10 re f Q"
    )
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    head = placed[: placed.index(b"(Tek)")]
    assert head.index(b"0 0 300 421 re f") < head.index(b"(Once)")
    assert head[head.index(b"(Once)") :].count(b"2 0 0 2 0 0 cm") == 1
    assert b"0 0 300 300 re W* n" in head[head.index(b"(Once)") :]
    assert b"10 10 5 5 re" not in head[head.index(b"(Once)") :]
    assert _shown(page, placed) == ["Once", "Tek"]
    document.close()


def test_a_word_leaves_marked_content_open_inside_the_clip_and_reopens_it() -> None:
    document, page, data = _page_with(
        b"q 0 0 1 1 re W n /Artifact BMC 1 1 1 rg 0 0 595 842 re f"
        b" /OC /oc1 BDC /Span <</Lang (tr)>> BDC /X BMC EMC"
        b" BT /F 10 Tf 40 780 Td (Tek) Tj ET EMC EMC EMC Q"
    )
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    head = placed[: placed.index(b"(Tek)")]
    assert head.index(b"re f") < head.index(b"EMC\nEMC\nEMC\nQ") < head.index(b"(Once)")
    reopened = head[head.index(b"(Once)") :]
    assert reopened.index(b"0 0 1 1 re W n") < reopened.index(b"/Artifact BMC")
    assert reopened.index(b"/Artifact BMC") < reopened.index(b"/OC /oc1 BDC")
    assert reopened.index(b"/OC /oc1 BDC") < reopened.index(b"/Span <</Lang (tr)>> BDC")
    assert b"/X BMC" not in reopened
    assert placed.count(b"BMC") + placed.count(b"BDC") == placed.count(b"EMC")
    assert _shown(page, placed) == ["Once"]
    document.close()


TAGGED_INSIDE_CLIP = (
    b"q 0 0 1 1 re W n /P <</MCID 2>> BDC 1 1 1 rg 0 0 595 842 re f"
    b" BT /F 10 Tf 40 780 Td (Tek) Tj ET EMC Q"
)


def _tag_page(
    document: pymupdf.Document, page: pymupdf.Page, direct_array: bool = False
) -> tuple[int, int]:
    element = document.get_new_xref()
    root = document.get_new_xref()
    document.update_object(element, f"<</Type/StructElem/S/P/P {root} 0 R/Pg {page.xref} 0 R/K 2>>")
    parents = f"[null null {element} 0 R]"
    if not direct_array:
        array = document.get_new_xref()
        document.update_object(array, parents)
        parents = f"{array} 0 R"
    document.update_object(
        root,
        f"<</Type/StructTreeRoot/K {element} 0 R/ParentTree<</Nums[0 {parents}]>>"
        "/ParentTreeNextKey 1>>",
    )
    document.xref_set_key(document.pdf_catalog(), "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(page.xref, "StructParents", "0")
    return element, root


def _parent_array(document: pymupdf.Document, root: int) -> str:
    kind, value = document.xref_get_key(root, "ParentTree/Nums")
    assert kind == "array"
    array = int(value.strip("[]").split()[1])
    return document.xref_object(array, compressed=True)


@pytest.mark.parametrize("direct_array", [False, True])
def test_tagged_content_open_inside_the_clip_is_continued_under_a_new_mcid(
    direct_array: bool,
) -> None:
    document, page, data = _page_with(TAGGED_INSIDE_CLIP)
    element, root = _tag_page(document, page, direct_array)
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    head = placed[: placed.index(b"(Tek)")]
    assert head.index(b"/MCID 2") < head.index(b"EMC\nQ") < head.index(b"(Once)")
    assert head.index(b"(Once)") < head.index(b"/P <</MCID 3>> BDC")
    assert placed.count(b"BDC") == placed.count(b"EMC")
    assert document.xref_get_key(element, "K") == ("array", "[2 3]")
    assert _parent_array(document, root) == f"[null null {element} 0 R {element} 0 R]"
    assert _shown(page, placed) == ["Once"]
    document.close()


def test_a_named_tag_with_an_mcid_is_reopened_inline_with_a_new_mcid() -> None:
    document, page, data = _page_with(TAGGED_INSIDE_CLIP.replace(b"<</MCID 2>>", b"/MC0"))
    resources = int(document.xref_get_key(page.xref, "Resources")[1].split()[0])
    document.xref_set_key(resources, "Properties", "<</MC0<</MCID 2/Lang(tr)>>>>")
    element, _root = _tag_page(document, page)
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    reopened = placed[placed.index(b"(Once)") : placed.index(b"(Tek)")]
    assert b"/P <</MCID 3/Lang(tr)>> BDC" in reopened
    assert document.xref_get_key(element, "K") == ("array", "[2 3]")
    document.close()


def test_tagged_content_without_a_structure_tree_is_reopened_under_a_fresh_mcid() -> None:
    document, page, data = _page_with(TAGGED_INSIDE_CLIP)
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.count(b"/MCID 2") == 1 and placed.count(b"/MCID 3") == 1
    document.close()


def test_a_word_stays_out_of_order_when_its_tag_has_no_element_to_continue() -> None:
    document, page, data = _page_with(TAGGED_INSIDE_CLIP)
    element, _root = _tag_page(document, page)
    document.xref_set_key(element, "K", "5")
    chunk, own = _chunk(page, "Once", (40, 50))
    assert place_in_order(page, data, chunk, None, own) is None
    assert document.xref_get_key(element, "K") == ("int", "5")
    document.close()


def test_a_word_under_a_clip_outside_any_save_and_a_fill_is_drawn_over_the_fill() -> None:
    document, page, data = _page_with(
        b"0.5 w 0 0 1 1 re W n 1 1 1 rg 0 0 595 842 re f q BT /F 10 Tf 40 780 Td (Tek) Tj ET Q"
    )
    chunk, own = _chunk(page, "Yok", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.startswith(b"q\n")
    assert placed.index(b"re f") < placed.index(b"(Yok)") < placed.index(b"(Tek)")
    assert placed.count(b"0 0 1 1 re W n") == 2
    assert placed.count(b"0.5 w") == 2
    assert placed.count(b"q") == placed.count(b"Q")
    assert _shown(page, placed) == ["Yok"]
    document.close()


def test_a_word_leaves_and_reenters_more_than_thirty_two_saved_states() -> None:
    document, page, data = _page_with(
        b"q " * 40 + b"0 0 1 1 re W n /Sh1 sh BT /F 10 Tf 40 780 Td (Tek) Tj ET" + b" Q" * 40
    )
    chunk, own = _chunk(page, "Once", (40, 50))
    placed = place_in_order(page, data, chunk, None, own)
    assert placed is not None
    assert placed.index(b"sh") < placed.index(b"(Once)") < placed.index(b"(Tek)")
    assert placed.count(b"0 0 1 1 re W n") == 2
    assert placed.count(b"q") == placed.count(b"Q")
    assert _shown(page, placed) == ["Once"]
    document.close()


def test_a_word_inside_clipping_text_waits_for_the_restore_that_lifts_the_clip() -> None:
    inside = b"q Q " * 8 + b"Q"
    nested = b"q " * 10 + b"q BT 4 Tr /F 10 Tf 40 780 Td (Kirpan) Tj ET " + inside + b" Q" * 10
    document, page, data = _page_with(nested + b" q BT /F 10 Tf 40 700 Td (Duz) Tj ET Q")
    chunk, own = _chunk(page, "Geri", (120, 62))
    placed = place_in_order(page, data, chunk, ("K", 40.0, 62.0), own)
    assert placed is not None
    lifted = placed.index(inside) + len(inside)
    assert lifted <= placed.index(b"(Geri)") < placed.index(b"(Duz)")
    assert _shown(page, placed) == ["Kirpan", "Geri", "Duz"]
    document.close()


def test_a_word_inside_clipping_text_that_is_never_lifted_goes_before_that_text() -> None:
    document, page, data = _page_with(
        b"BT 4 Tr /F 10 Tf 40 780 Td (Kirpan) Tj ET q BT /F 10 Tf 40 700 Td (Duz) Tj ET Q"
    )
    chunk, own = _chunk(page, "Geri", (120, 62))
    placed = place_in_order(page, data, chunk, ("K", 40.0, 62.0), own)
    assert placed is not None
    assert placed.index(b"(Geri)") < placed.index(b"(Kirpan)")
    assert _shown(page, placed) == ["Geri", "Kirpan"]
    document.close()
