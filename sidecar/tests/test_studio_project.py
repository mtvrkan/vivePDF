import base64
import io
import json
import zipfile
from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops import _studio_project, _studio_thumbnails, studio_project
from vivepdf.ops._studio_models import (
    StudioProjectOpenParams,
    StudioProjectSaveParams,
    StudioRenderParams,
    StudioThumbnailParams,
)
from vivepdf.ops.studio import render
from vivepdf.ops.studio_project import design_of, open_project, render_thumbnail, save_project
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

PREVIEW = {
    "width": 200,
    "height": 100,
    "items": [
        {
            "kind": "vector",
            "x": 0,
            "y": 0,
            "width": 200,
            "height": 100,
            "paths": [
                {
                    "d": "M0 0 L200 0 L200 100 L0 100 Z",
                    "fill": {"type": "solid", "color": "#0000ff"},
                }
            ],
        }
    ],
}


@pytest.fixture(autouse=True)
def _data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "appdata"
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(directory))
    return directory


def _picture(folder: Path, colour: tuple[int, int, int] = (255, 0, 0)) -> Path:
    path = folder / "photo.png"
    Image.fromarray(np.full((20, 30, 3), colour, dtype=np.uint8)).save(path)
    return path


def _design(picture: str) -> dict:
    return {
        "version": 1,
        "name": "Poster",
        "pages": [{"id": "p1", "elements": [{"id": "e1", "kind": "image", "src": picture}]}],
        "background": {"image": {"src": picture}},
    }


def _save(folder: Path, design: dict, assets: list[str], **extra) -> Path:
    payload = {
        "design": design,
        "assets": assets,
        "output": str(folder / "poster"),
        "overwrite": True,
        **extra,
    }
    result = save_project(StudioProjectSaveParams.model_validate(payload), silent_progress())
    return Path(result.output)


def _open(path: Path, password: str | None = None):
    return open_project(
        StudioProjectOpenParams(path=str(path), password=password), silent_progress()
    )


def _archive(folder: Path, entries: dict[str, bytes]) -> Path:
    path = folder / "crafted.vivedesign"
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return path


def _document(design: dict, version: int = 1) -> bytes:
    return json.dumps({"format": "vivedesign", "version": version, "design": design}).encode()


def test_a_design_round_trips_with_its_pictures_and_a_thumbnail(tmp_path: Path, _data_dir: Path):
    picture = _picture(tmp_path)
    saved = _save(tmp_path, _design(str(picture)), [str(picture)], preview=PREVIEW)
    assert saved.suffix == ".vivedesign"
    with zipfile.ZipFile(saved) as archive:
        stored = json.loads(archive.read("design.json"))["design"]
        assert str(picture) not in json.dumps(stored)
    picture.unlink()

    opened = _open(saved)
    assert opened.source == "project"
    restored = Path(opened.design["pages"][0]["elements"][0]["src"])
    assert restored.parent == _data_dir / "studio-assets"
    assert restored.read_bytes()[:4] == bytes([0x89, 0x50, 0x4E, 0x47])
    assert opened.design["background"]["image"]["src"] == str(restored)
    assert opened.design["name"] == "Poster"
    thumbnail = Image.open(io.BytesIO(base64.b64decode(opened.thumbnail)))
    assert max(thumbnail.size) == 320
    assert thumbnail.getpixel((160, 80))[2] > 200


def test_saving_needs_overwrite_and_reports_missing_pictures(tmp_path: Path):
    picture = _picture(tmp_path)
    _save(tmp_path, _design(str(picture)), [str(picture)])
    with pytest.raises(OpError) as caught:
        _save(tmp_path, _design(str(picture)), [str(picture)], overwrite=False)
    assert caught.value.data["exists"] is True

    with pytest.raises(OpError) as caught:
        _save(tmp_path, _design("gone.png"), [str(tmp_path / "gone.png")])
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND
    assert caught.value.data["reason"] == "missingImage"


@pytest.mark.parametrize(
    ("entries", "reason"),
    [
        ({"readme.txt": b"hello"}, "notProject"),
        ({"design.json": b"{not json"}, "notProject"),
        ({"design.json": json.dumps({"format": "other", "design": {}}).encode()}, "notProject"),
        ({"design.json": _document({}, version=99)}, "newerProject"),
        ({"design.json": b"[" * 100_000 + b"]" * 100_000}, "notProject"),
    ],
)
def test_foreign_or_newer_files_are_refused(tmp_path: Path, entries: dict, reason: str):
    with pytest.raises(OpError) as caught:
        _open(_archive(tmp_path, entries))
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data["reason"] == reason


def test_a_file_that_is_not_a_zip_is_refused(tmp_path: Path):
    path = tmp_path / "plain.vivedesign"
    path.write_text("hello", encoding="utf-8")
    with pytest.raises(OpError) as caught:
        _open(path)
    assert caught.value.data["reason"] == "notProject"


def test_crafted_asset_names_and_forged_contents_are_never_extracted(
    tmp_path: Path, _data_dir: Path
):
    forged = "0" * 64
    design = {"src": f"vivepdf-asset:assets/{forged}.png"}
    path = _archive(
        tmp_path,
        {
            "design.json": _document(design),
            "assets/../../escaped.png": b"x",
            f"assets/{forged}.png": b"not the right bytes",
            f"assets/{'1' * 64}.exe": b"MZ",
        },
    )
    opened = _open(path)
    assert not (tmp_path / "escaped.png").exists()
    extracted = list((_data_dir / "studio-assets").glob("*"))
    assert extracted == []
    assert opened.design["src"] == str(_data_dir / "studio-assets" / f"{forged}.png")


def test_an_oversized_design_is_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(_studio_project, "MAX_DESIGN_JSON", 100)
    with pytest.raises(OpError) as caught:
        _open(_archive(tmp_path, {"design.json": _document({"name": "x" * 200})}))
    assert caught.value.data["reason"] == "projectTooLarge"


def _exported(folder: Path, embed: dict | None, name: str = "design.pdf") -> Path:
    payload = {
        "pages": [PREVIEW],
        "output": str(folder / name),
        "overwrite": True,
        "embed": embed,
    }
    return Path(render(StudioRenderParams.model_validate(payload), silent_progress()).output)


def test_an_exported_pdf_carries_its_design_back_to_studio(tmp_path: Path):
    picture = _picture(tmp_path, (0, 255, 0))
    pdf = _exported(tmp_path, {"design": _design(str(picture)), "assets": [str(picture)]})
    found = design_of(StudioProjectOpenParams(path=str(pdf)), silent_progress())
    assert found.found is True

    opened = _open(pdf)
    assert opened.source == "pdf"
    restored = Path(opened.design["pages"][0]["elements"][0]["src"])
    assert restored.is_file()

    with pymupdf.open(pdf) as document:
        document.save(tmp_path / "resaved.pdf", garbage=4, deflate=True)
    assert _open(tmp_path / "resaved.pdf").design["name"] == "Poster"


def test_plain_and_locked_pdfs_hold_no_design(tmp_path: Path):
    plain = _exported(tmp_path, None, "plain.pdf")
    assert design_of(StudioProjectOpenParams(path=str(plain)), silent_progress()).found is False
    with pytest.raises(OpError) as caught:
        _open(plain)
    assert caught.value.data["reason"] == "noDesign"

    picture = _picture(tmp_path)
    source = _exported(tmp_path, {"design": _design(str(picture)), "assets": []}, "source.pdf")
    locked = tmp_path / "locked.pdf"
    with pymupdf.open(source) as document:
        document.save(locked, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="pw")
    assert design_of(StudioProjectOpenParams(path=str(locked)), silent_progress()).found is False
    with pytest.raises(OpError) as caught:
        _open(locked)
    assert caught.value.code == ErrorCode.NEEDS_PASSWORD
    assert _open(locked, "pw").design["name"] == "Poster"


def test_missing_files_are_reported(tmp_path: Path):
    with pytest.raises(OpError) as caught:
        _open(tmp_path / "absent.vivedesign")
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND


def test_a_thumbnail_is_a_jpeg_of_the_page_at_the_requested_size():
    result = render_thumbnail(
        StudioThumbnailParams.model_validate({"page": PREVIEW, "side": 160}), silent_progress()
    )
    image = Image.open(io.BytesIO(base64.b64decode(result.image)))
    assert image.format == "JPEG"
    assert (result.width, result.height) == image.size == (160, 80)
    red, green, blue = image.convert("RGB").getpixel((80, 40))
    assert blue > 200 and red < 40 and green < 40


def test_an_empty_page_still_gives_a_white_thumbnail():
    page = {"width": 100, "height": 300, "items": []}
    result = render_thumbnail(
        StudioThumbnailParams.model_validate({"page": page, "side": 60}), silent_progress()
    )
    image = Image.open(io.BytesIO(base64.b64decode(result.image))).convert("RGB")
    assert image.size == (20, 60)
    assert min(image.getpixel((10, 30))) > 240


@pytest.mark.parametrize("side", [8, 5000])
def test_a_thumbnail_size_out_of_range_is_refused(side: int):
    with pytest.raises(ValidationError):
        StudioThumbnailParams.model_validate({"page": PREVIEW, "side": side})


def test_a_thumbnail_is_kept_and_served_again_until_the_page_changes(
    _data_dir: Path, monkeypatch: pytest.MonkeyPatch
):
    params = StudioThumbnailParams.model_validate({"page": PREVIEW, "side": 100})
    first = render_thumbnail(params, silent_progress())
    monkeypatch.setattr(
        studio_project, "_rendered_thumbnail", lambda *_: pytest.fail("rendered again")
    )

    second = render_thumbnail(params, silent_progress())

    assert second == first
    assert len(list((_data_dir / "cache" / "thumbnails").glob("*.jpg"))) == 1
    changed = StudioThumbnailParams.model_validate({"page": PREVIEW, "side": 101})
    with pytest.raises(pytest.fail.Exception):
        render_thumbnail(changed, silent_progress())


def test_the_thumbnail_cache_keeps_only_the_newest_files(
    _data_dir: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(_studio_thumbnails, "CACHE_LIMIT", 2)

    for side in (40, 41, 42):
        render_thumbnail(
            StudioThumbnailParams.model_validate({"page": PREVIEW, "side": side}), silent_progress()
        )

    assert len(list((_data_dir / "cache" / "thumbnails").glob("*.jpg"))) == 2
