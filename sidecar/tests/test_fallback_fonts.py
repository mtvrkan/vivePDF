import hashlib
import json
import threading
from pathlib import Path

import pytest

from vivepdf.ops import fallback_fonts
from vivepdf.ops.fallback_fonts import (
    FallbackFontSetParams,
    FallbackFontsParams,
    FontFile,
    FontSet,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

MANIFEST = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "desktop"
    / "src"
    / "features"
    / "viewer"
    / "pdf"
    / "fallbackFonts.json"
)


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path / "data"))
    return tmp_path / "data" / "fallback-fonts"


@pytest.fixture
def mirror(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "mirror"
    folder.mkdir()
    monkeypatch.setenv("VIVEPDF_FONTS_URL", folder.as_uri())
    return folder


def _small_set(monkeypatch: pytest.MonkeyPatch, mirror: Path, payload: bytes) -> FontSet:
    (mirror / "Small.otf").write_bytes(payload)
    small = FontSet(
        "small", (FontFile("Small.otf", len(payload), hashlib.sha256(payload).hexdigest()),)
    )
    monkeypatch.setitem(fallback_fonts.FONT_SETS, "small", small)
    return small


def _download(set_id: str, progress: Progress | None = None):
    return fallback_fonts.fallback_fonts_download(
        FallbackFontSetParams(set=set_id), progress or silent_progress()
    )


def test_the_sets_match_the_downloadable_sets_of_the_viewer_manifest() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    expected = {
        entry["id"]: [(item["file"], item["bytes"], item["sha256"]) for item in entry["files"]]
        for entry in manifest["sets"]
        if not entry["bundled"]
    }

    actual = {
        font_set.id: [(item.name, item.size, item.sha256) for item in font_set.files]
        for font_set in fallback_fonts.FONT_SETS.values()
    }

    assert actual == expected
    assert manifest["downloadBase"] == fallback_fonts.DOWNLOAD_BASE


def test_a_downloaded_set_is_verified_installed_listed_and_removed(
    monkeypatch: pytest.MonkeyPatch, mirror: Path, data_dir: Path
) -> None:
    payload = b"\x00\x01OTTO" * 50_000
    _small_set(monkeypatch, mirror, payload)

    result = _download("small")
    listed = fallback_fonts.fallback_fonts(FallbackFontsParams(), silent_progress())
    removed = fallback_fonts.fallback_fonts_remove(
        FallbackFontSetParams(set="small"), silent_progress()
    )

    assert (result.set, result.bytes) == ("small", len(payload))
    assert listed.directory == str(data_dir)
    assert {item.id: item.installed for item in listed.sets}["small"] is True
    assert {item.id: item.installed for item in listed.sets}["ja"] is False
    assert removed.removed is True
    assert not (data_dir / "Small.otf").exists()
    assert list(data_dir.iterdir()) == []


def test_a_file_with_the_wrong_digest_is_refused_and_left_nowhere(
    monkeypatch: pytest.MonkeyPatch, mirror: Path, data_dir: Path
) -> None:
    small = _small_set(monkeypatch, mirror, b"genuine font bytes")
    (mirror / "Small.otf").write_bytes(b"tampered font bytes")
    monkeypatch.setitem(
        fallback_fonts.FONT_SETS,
        "small",
        FontSet("small", (FontFile("Small.otf", 19, small.files[0].sha256),)),
    )

    with pytest.raises(OpError) as caught:
        _download("small")

    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data == {"set": "small", "reason": "fontChecksum"}
    assert list(data_dir.iterdir()) == []


def test_a_file_larger_than_expected_stops_the_download(
    monkeypatch: pytest.MonkeyPatch, mirror: Path, data_dir: Path
) -> None:
    _small_set(monkeypatch, mirror, b"abc")
    (mirror / "Small.otf").write_bytes(b"abc" * 1000)

    with pytest.raises(OpError) as caught:
        _download("small")

    assert caught.value.data == {"set": "small", "reason": "fontChecksum"}
    assert list(data_dir.iterdir()) == []


def test_an_unreachable_mirror_is_a_network_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("VIVEPDF_FONTS_URL", (tmp_path / "missing").as_uri())

    with pytest.raises(OpError) as caught:
        _download("ja")

    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data == {"set": "ja"}


def test_an_unknown_set_is_invalid() -> None:
    for call in (
        fallback_fonts.fallback_fonts_download,
        fallback_fonts.fallback_fonts_remove,
    ):
        with pytest.raises(OpError) as caught:
            call(FallbackFontSetParams(set="../ja"), silent_progress())
        assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_a_cancelled_download_leaves_no_partial_file(
    monkeypatch: pytest.MonkeyPatch, mirror: Path, data_dir: Path
) -> None:
    _small_set(monkeypatch, mirror, b"x" * (fallback_fonts.CHUNK_SIZE * 3))
    cancel = threading.Event()

    with pytest.raises(OpError) as caught:
        _download("small", Progress(lambda *_args: cancel.set(), cancel))

    assert caught.value.code == ErrorCode.CANCELLED
    assert list(data_dir.iterdir()) == []
