from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.pages import (
    AssemblePage,
    AssembleParams,
    AssemblePartsParams,
    AssembleSource,
    PageLabelRule,
    assemble,
    assemble_parts,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _run(sources: list[AssembleSource], pages: list[AssemblePage], output: Path) -> Path:
    assemble(AssembleParams(sources=sources, pages=pages, output=str(output)), silent_progress())
    return output


def _source(path: Path, password: str | None = None) -> list[AssembleSource]:
    return [AssembleSource(id="main", path=str(path), password=password)]


def _pages(numbers: list[int | None]) -> list[AssemblePage]:
    return [
        AssemblePage(kind="blank") if number is None else AssemblePage(source="main", index=number)
        for number in numbers
    ]


def _goto_destination(document: pymupdf.Document, xref: int) -> str:
    kind, value = document.xref_get_key(xref, "A/D")
    assert kind == "array"
    return value


@pytest.fixture
def linked(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(4):
        document.new_page(width=400, height=600).insert_text((72, 72), f"P{index + 1}")
    document[0].set_cropbox(pymupdf.Rect(30, 40, 330, 520))
    document[0].set_rotation(90)
    document[0].insert_link(
        {
            "kind": pymupdf.LINK_GOTO,
            "from": pymupdf.Rect(10, 20, 60, 50),
            "page": 3,
            "to": pymupdf.Point(0, 0),
        }
    )
    document[0].insert_link(
        {
            "kind": pymupdf.LINK_GOTO,
            "from": pymupdf.Rect(70, 20, 90, 50),
            "page": 1,
            "to": pymupdf.Point(0, 0),
        }
    )
    document[0].insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(100, 20, 140, 50), "uri": "https://a.b"}
    )
    tree = document.get_new_xref()
    document.update_object(tree, f"<</Names[(far) [{document[3].xref} 0 R/XYZ 11 22 3]]>>")
    document.xref_set_key(document.pdf_catalog(), "Names", f"<</Dests {tree} 0 R>>")
    document[2].insert_link(
        {
            "kind": pymupdf.LINK_GOTO,
            "from": pymupdf.Rect(10, 10, 50, 50),
            "page": 0,
            "to": pymupdf.Point(0, 0),
        }
    )
    document.xref_set_key(document[2].get_links()[0]["xref"], "A", "<</S/GoTo/D(far)>>")
    links = document[0].get_links()
    document.xref_set_key(
        links[0]["xref"], "A", f"<</S/GoTo/D[{document[3].xref} 0 R/XYZ 15 465 1.5]>>"
    )
    document.set_toc(
        [
            [1, "Start", 1],
            [1, "Removed", 2],
            [
                1,
                "End",
                4,
                {
                    "kind": pymupdf.LINK_GOTO,
                    "to": pymupdf.Point(0, 0),
                    "bold": True,
                    "color": (1, 0, 0),
                },
            ],
        ]
    )
    end_item = document.get_outline_xrefs()[2]
    document.xref_set_key(end_item, "A", f"<</S/GoTo/D[{document[3].xref} 0 R/XYZ 33 44 2]>>")
    document.xref_set_key(end_item, "Dest", "null")
    document.set_metadata({"title": "Ders Notu", "author": "Ayşe", "keywords": "pdf"})
    document.embfile_add("ek.txt", b"ek dosya", filename="ek.txt", ufilename="ek.txt", desc="ek")
    path = tmp_path / "linked.pdf"
    document.save(path)
    document.close()
    return path


def test_a_link_to_a_page_in_another_chunk_survives_with_its_exact_view(
    linked: Path, tmp_path: Path
):
    output = _run(_source(linked), _pages([1, None, 4]), tmp_path / "out.pdf")
    with pymupdf.open(linked) as source, pymupdf.open(output) as result:
        kept = [link for link in result[0].get_links() if link["kind"] == pymupdf.LINK_GOTO]
        assert [link["page"] for link in kept] == [2]
        assert (
            _goto_destination(result, kept[0]["xref"]) == f"[{result[2].xref} 0 R/XYZ 15 465 1.5]"
        )
        original = source[0].get_links()[0]["xref"]
        assert result.xref_get_key(kept[0]["xref"], "Rect") == source.xref_get_key(original, "Rect")
        assert any(link["kind"] == pymupdf.LINK_URI for link in result[0].get_links())


def test_a_named_destination_link_is_rebuilt_to_the_moved_page(linked: Path, tmp_path: Path):
    output = _run(_source(linked), _pages([4, 3]), tmp_path / "out.pdf")
    with pymupdf.open(output) as result:
        links = [link for link in result[1].get_links() if link["kind"] == pymupdf.LINK_GOTO]
        assert [link["page"] for link in links] == [0]
        assert _goto_destination(result, links[0]["xref"]) == f"[{result[0].xref} 0 R/XYZ 11 22 3]"


def test_a_link_to_a_page_left_out_is_dropped(linked: Path, tmp_path: Path):
    output = _run(_source(linked), _pages([1]), tmp_path / "out.pdf")
    with pymupdf.open(output) as result:
        assert [link["kind"] for link in result[0].get_links()] == [pymupdf.LINK_URI]


def test_bookmarks_keep_their_view_colour_and_weight(linked: Path, tmp_path: Path):
    output = _run(_source(linked), _pages([4, 1]), tmp_path / "out.pdf")
    with pymupdf.open(output) as result:
        toc = result.get_toc(simple=False)
        assert [(entry[1], entry[2]) for entry in toc] == [("End", 1), ("Start", 2)]
        assert toc[0][3]["bold"] is True
        assert toc[0][3]["color"] == pytest.approx((1, 0, 0))
        end_item = result.get_outline_xrefs()[0]
        assert _goto_destination(result, end_item) == f"[{result[0].xref} 0 R/XYZ 33 44 2]"


def test_metadata_and_attachments_of_the_main_source_are_kept(linked: Path, tmp_path: Path):
    other = tmp_path / "other.pdf"
    with pymupdf.open() as document:
        document.new_page()
        document.set_metadata({"title": "Other"})
        document.embfile_add("other.txt", b"x")
        document.save(other)
    sources = [*_source(linked), AssembleSource(id="other", path=str(other))]
    pages = [AssemblePage(source="other", index=1), AssemblePage(source="main", index=2)]
    output = _run(sources, pages, tmp_path / "out.pdf")
    with pymupdf.open(output) as result:
        assert result.metadata["title"] == "Ders Notu"
        assert result.metadata["author"] == "Ayşe"
        assert result.embfile_names() == ["ek.txt"]
        assert result.embfile_get("ek.txt") == b"ek dosya"


def _locked(tmp_path: Path) -> Path:
    path = tmp_path / "locked.pdf"
    with pymupdf.open() as document:
        for index in range(3):
            document.new_page().insert_text((72, 72), f"L{index + 1}")
        document.save(
            path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="gizli", owner_pw="sahip"
        )
    return path


def test_a_protected_main_source_gives_a_protected_result(tmp_path: Path):
    locked = _locked(tmp_path)
    output = _run(_source(locked, "gizli"), _pages([3, 1]), tmp_path / "out.pdf")
    with pymupdf.open(output) as result:
        assert result.needs_pass
        assert result.authenticate("gizli")
        assert result.page_count == 2
        assert "L3" in result[0].get_text()


def test_split_parts_of_a_protected_source_stay_protected(tmp_path: Path):
    locked = _locked(tmp_path)
    result = assemble_parts(
        AssemblePartsParams(
            sources=_source(locked, "gizli"),
            pages=_pages([1, 2, 3]),
            cuts=[2],
            output_dir=str(tmp_path / "parts"),
        ),
        silent_progress(),
    )
    for part in result.outputs:
        with pymupdf.open(part.output) as document:
            assert document.needs_pass
            assert document.authenticate("gizli")


def test_a_protected_source_without_its_password_is_refused(tmp_path: Path):
    with pytest.raises(OpError):
        _run(_source(_locked(tmp_path)), _pages([1]), tmp_path / "out.pdf")


def _turned_photo(path: Path, orientation: int) -> Path:
    image = Image.new("RGB", (400, 200), (200, 30, 30))
    image.paste((30, 30, 200), (0, 0, 100, 200))
    exif = Image.Exif()
    exif[0x0112] = orientation
    image.save(path, format="JPEG", exif=exif)
    return path


def test_a_photo_taken_sideways_becomes_an_upright_portrait_page(tmp_path: Path):
    photo = _turned_photo(tmp_path / "o6.jpg", 6)
    sources_path = tmp_path / "host.pdf"
    with pymupdf.open() as host:
        host.new_page()
        host.save(sources_path)
    output = _run(
        _source(sources_path), [AssemblePage(kind="image", path=str(photo))], tmp_path / "out.pdf"
    )
    with pymupdf.open(output) as result:
        page = result[0]
        assert page.rect.width < page.rect.height
        info = page.get_image_info(xrefs=True)[0]
        extracted = result.extract_image(info["xref"])
        assert (extracted["width"], extracted["height"]) == (200, 400)


def test_an_upright_photo_keeps_its_landscape_page(tmp_path: Path):
    photo = _turned_photo(tmp_path / "o1.jpg", 1)
    host = tmp_path / "host.pdf"
    with pymupdf.open() as document:
        document.new_page()
        document.save(host)
    output = _run(
        _source(host), [AssemblePage(kind="image", path=str(photo))], tmp_path / "out.pdf"
    )
    with pymupdf.open(output) as result:
        assert result[0].rect.width > result[0].rect.height


def _labels(path: str) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_label() for page in document]


def test_pages_before_the_first_label_rule_restart_in_every_part(linked: Path, tmp_path: Path):
    result = assemble_parts(
        AssemblePartsParams(
            sources=_source(linked),
            pages=_pages([1, 2, 3, 4]),
            cuts=[1],
            output_dir=str(tmp_path / "parts"),
            labels=[PageLabelRule(start=2, style="r")],
        ),
        silent_progress(),
    )
    assert [_labels(part.output) for part in result.outputs] == [[""], ["1", "i", "ii"]]
