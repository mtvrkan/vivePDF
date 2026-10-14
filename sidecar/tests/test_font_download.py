import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path

import pytest

from vivepdf.ops import _font_download
from vivepdf.ops._font_download import fetch_font_file
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


@dataclass(frozen=True)
class Entry:
    name: str
    size: int
    sha256: str


@pytest.fixture
def mirror(tmp_path: Path) -> Path:
    folder = tmp_path / "mirror"
    folder.mkdir()
    return folder


@pytest.fixture
def target(tmp_path: Path) -> Path:
    folder = tmp_path / "fonts"
    folder.mkdir()
    return folder


def _published(mirror: Path, payload: bytes) -> Entry:
    (mirror / "Small.otf").write_bytes(payload)
    return Entry("Small.otf", len(payload), hashlib.sha256(payload).hexdigest())


def _fetch(entry: Entry, base: str, target: Path, progress: Progress | None = None) -> None:
    fetch_font_file(
        "small", entry, target, progress or silent_progress(), 0, max(entry.size, 1), base
    )


def test_a_verified_file_lands_under_its_own_name(mirror: Path, target: Path) -> None:
    payload = b"\x00\x01OTTO" * 50_000
    entry = _published(mirror, payload)

    _fetch(entry, mirror.as_uri(), target)

    assert (target / "Small.otf").read_bytes() == payload
    assert [path.name for path in target.iterdir()] == ["Small.otf"]


def test_a_file_with_the_wrong_digest_is_refused_and_left_nowhere(
    mirror: Path, target: Path
) -> None:
    entry = _published(mirror, b"genuine font bytes")
    (mirror / "Small.otf").write_bytes(b"tampered font byte")

    with pytest.raises(OpError) as caught:
        _fetch(entry, mirror.as_uri(), target)

    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data == {"set": "small", "reason": "fontChecksum"}
    assert list(target.iterdir()) == []


def test_a_file_larger_than_expected_stops_the_download(mirror: Path, target: Path) -> None:
    entry = _published(mirror, b"abc")
    (mirror / "Small.otf").write_bytes(b"abc" * 1000)

    with pytest.raises(OpError) as caught:
        _fetch(entry, mirror.as_uri(), target)

    assert caught.value.data == {"set": "small", "reason": "fontChecksum"}
    assert list(target.iterdir()) == []


def test_an_unreachable_mirror_is_a_network_error(
    mirror: Path, target: Path, tmp_path: Path
) -> None:
    entry = _published(mirror, b"abc")

    with pytest.raises(OpError) as caught:
        _fetch(entry, (tmp_path / "missing").as_uri(), target)

    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data == {"set": "small"}
    assert list(target.iterdir()) == []


def test_a_cancelled_download_leaves_no_partial_file(mirror: Path, target: Path) -> None:
    entry = _published(mirror, b"x" * (_font_download.CHUNK_SIZE * 3))
    cancel = threading.Event()

    with pytest.raises(OpError) as caught:
        _fetch(entry, mirror.as_uri(), target, Progress(lambda *_args: cancel.set(), cancel))

    assert caught.value.code == ErrorCode.CANCELLED
    assert list(target.iterdir()) == []
