import shutil
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.layers import LayersListParams, list_layers
from vivepdf.ops.viewing import LayerChoice, ViewPrepareParams, prepare_view, restore_view
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

RED = (1, 0, 0)
BLUE = (0, 0, 1)
GREEN = (0, 1, 0)


def _layered(tmp_path: Path, name: str = "layered.pdf", order: str | None = None) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=500, height=300)
    base = document.add_ocg("Base", on=True)
    notes = document.add_ocg("Notes", on=True)
    hidden = document.add_ocg("Hidden", on=False)
    page.draw_rect(pymupdf.Rect(50, 50, 150, 150), color=RED, fill=RED, oc=base)
    page.draw_rect(pymupdf.Rect(200, 50, 300, 150), color=BLUE, fill=BLUE, oc=notes)
    page.draw_rect(pymupdf.Rect(350, 50, 450, 150), color=GREEN, fill=GREEN, oc=hidden)
    catalog = document.pdf_catalog()
    document.xref_set_key(
        catalog,
        "OCProperties/D/Order",
        order or f"[{base} 0 R [(Review) {notes} 0 R {hidden} 0 R]]",
    )
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def _rows(path: Path) -> list[tuple]:
    rows = list_layers(LayersListParams(path=str(path)), silent_progress()).layers
    return [(row.name, row.kind, row.depth, row.on, row.locked) for row in rows]


def _ids(path: Path) -> dict[str, int]:
    rows = list_layers(LayersListParams(path=str(path)), silent_progress()).layers
    return {row.name: row.id for row in rows if row.id is not None}


def _colour_at(path: Path, point: tuple[float, float]) -> tuple[int, int, int]:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(dpi=36)
        scale = 36 / 72
        return pixmap.pixel(int(point[0] * scale), int(point[1] * scale))


def _states(path: Path) -> dict[str, bool]:
    with pymupdf.open(path) as document:
        return {info["name"]: info["on"] for info in document.get_ocgs().values()}


def test_layers_are_listed_in_panel_order_with_groups_and_state(tmp_path: Path):
    assert _rows(_layered(tmp_path)) == [
        ("Base", "layer", 0, True, False),
        ("Review", "label", 0, False, False),
        ("Notes", "layer", 1, True, False),
        ("Hidden", "layer", 1, False, False),
    ]


def test_a_locked_layer_is_reported(tmp_path: Path):
    path = _layered(tmp_path)
    with pymupdf.open(path) as document:
        base = _ids(path)["Base"]
        document.xref_set_key(document.pdf_catalog(), "OCProperties/D/Locked", f"[{base} 0 R]")
        document.save(tmp_path / "locked.pdf")
    assert _rows(tmp_path / "locked.pdf")[0] == ("Base", "layer", 0, True, True)


def test_an_order_held_in_its_own_object_is_followed(tmp_path: Path):
    path = _layered(tmp_path)
    with pymupdf.open(path) as document:
        catalog = document.pdf_catalog()
        order = document.xref_get_key(catalog, "OCProperties/D/Order")[1]
        holder = document.get_new_xref()
        document.update_object(holder, order)
        document.xref_set_key(catalog, "OCProperties/D/Order", f"{holder} 0 R")
        document.save(tmp_path / "indirect.pdf")
    assert [row[0] for row in _rows(tmp_path / "indirect.pdf")] == [
        "Base",
        "Review",
        "Notes",
        "Hidden",
    ]


def test_layers_missing_from_the_order_fall_back_to_a_flat_list(tmp_path: Path):
    path = _layered(tmp_path, order="[]")
    assert _rows(path) == [
        ("Base", "layer", 0, True, False),
        ("Notes", "layer", 0, True, False),
        ("Hidden", "layer", 0, False, False),
    ]


def test_a_document_without_layers_lists_none(tmp_path: Path):
    document = pymupdf.open()
    document.new_page()
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()
    assert _rows(path) == []


def test_the_view_copy_shows_the_chosen_layers_and_leaves_the_file_alone(tmp_path: Path):
    path = _layered(tmp_path)
    ids = _ids(path)
    before = path.read_bytes()
    result = prepare_view(
        ViewPrepareParams(
            path=str(path),
            layers=[LayerChoice(id=ids["Notes"], on=False), LayerChoice(id=ids["Hidden"], on=True)],
        ),
        silent_progress(),
    )
    assert result.layers == 2
    view = Path(result.view_path)
    assert _colour_at(view, (250, 100)) == (255, 255, 255)
    assert _colour_at(view, (400, 100)) == (0, 255, 0)
    assert _colour_at(view, (100, 100)) == (255, 0, 0)
    assert path.read_bytes() == before
    assert _states(path) == {"Base": True, "Notes": True, "Hidden": False}


def test_saving_the_view_copy_keeps_the_documents_own_layer_defaults(tmp_path: Path):
    path = _layered(tmp_path)
    ids = _ids(path)
    result = prepare_view(
        ViewPrepareParams(path=str(path), layers=[LayerChoice(id=ids["Base"], on=False)]),
        silent_progress(),
    )
    saved = tmp_path / "saved.pdf"
    shutil.copyfile(result.view_path, saved)
    assert _states(saved)["Base"] is False
    assert restore_view(ViewPrepareParams(path=str(saved)), silent_progress()).restored == 1
    assert _states(saved) == {"Base": True, "Notes": True, "Hidden": False}
    with pymupdf.open(saved) as document:
        kind, _value = document.xref_get_key(
            document.pdf_catalog(), "OCProperties/D/VivePdfLayerBackup"
        )
    assert kind == "null"
    assert restore_view(ViewPrepareParams(path=str(saved)), silent_progress()).restored == 0


def test_choosing_the_current_state_needs_no_view_copy(tmp_path: Path):
    path = _layered(tmp_path)
    ids = _ids(path)
    result = prepare_view(
        ViewPrepareParams(path=str(path), layers=[LayerChoice(id=ids["Base"], on=True)]),
        silent_progress(),
    )
    assert (result.view_path, result.layers) == (None, 0)


def test_an_unknown_layer_is_refused(tmp_path: Path):
    path = _layered(tmp_path)
    with pytest.raises(OpError) as caught:
        prepare_view(
            ViewPrepareParams(path=str(path), layers=[LayerChoice(id=1, on=False)]),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "unknownLayer"}


def test_a_missing_file_is_reported(tmp_path: Path):
    with pytest.raises(OpError) as caught:
        list_layers(LayersListParams(path=str(tmp_path / "gone.pdf")), silent_progress())
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND
