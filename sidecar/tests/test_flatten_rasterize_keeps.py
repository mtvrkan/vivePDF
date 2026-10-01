from pathlib import Path

import pymupdf

from vivepdf.ops.flatten import FlattenParams, flatten
from vivepdf.rpc.progress import silent_progress


def _protected_rotated(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for rotation in (0, 90):
        page = document.new_page(width=600, height=800)
        page.insert_text((50, 60), "SECRETWORD", fontsize=14)
        page.insert_link(
            {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(50, 45, 150, 65), "uri": "https://x.y"}
        )
        page.add_text_annot((300, 300), "note")
        page.set_rotation(rotation)
    document.set_toc([[1, "One", 1], [1, "Two", 2]])
    document.set_metadata({"title": "Kept title"})
    path = tmp_path / "protected.pdf"
    document.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="user", owner_pw="owner")
    document.close()
    return path


def test_rasterised_copy_keeps_links_bookmarks_properties_and_password(tmp_path: Path) -> None:
    source = _protected_rotated(tmp_path)
    before = pymupdf.open(source)
    before.authenticate("user")
    rects = [page.rect for page in before]
    links = [page.get_links()[0]["from"] for page in before]
    before.close()
    output = tmp_path / "flat.pdf"
    flatten(
        FlattenParams(
            path=str(source), password="user", output=str(output), rasterize=True, dpi=72
        ),
        silent_progress(),
    )
    document = pymupdf.open(output)
    assert document.needs_pass
    assert document.authenticate("user")
    assert [entry[1] for entry in document.get_toc()] == ["One", "Two"]
    assert document.metadata["title"] == "Kept title"
    for index, page in enumerate(document):
        assert page.get_text().strip() == ""
        assert len(page.get_images()) == 1
        assert list(page.annots()) == []
        assert page.rect == rects[index]
        assert page.get_links()[0]["from"] == links[index]
    document.close()
