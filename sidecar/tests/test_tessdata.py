import hashlib
import re
import threading
from pathlib import Path

import pytest

from vivepdf.ops import tessdata
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


@pytest.fixture(autouse=True)
def _writable_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "tessdata"
    monkeypatch.setenv("VIVEPDF_TESSDATA_DIR", str(directory))
    return directory


def test_tessdata_languages_lists_installed_from_temp_dir(_writable_dir: Path) -> None:
    _writable_dir.mkdir(parents=True, exist_ok=True)
    (_writable_dir / "deu.traineddata").write_bytes(b"x")

    result = tessdata.tessdata_languages(tessdata.TessdataLanguagesParams(), silent_progress())

    assert result.directory == str(_writable_dir)
    assert {"deu", "eng", "tur"}.issubset(set(result.installed))
    assert any(language.code == "eng" for language in result.available)
    assert len(result.available) >= 39


def test_tessdata_download_rejects_unknown_code() -> None:
    with pytest.raises(OpError) as excinfo:
        tessdata.tessdata_download(tessdata.TessdataDownloadParams(code="zzz"), silent_progress())

    assert excinfo.value.code == ErrorCode.INVALID_PARAMS


class _FakeResponse:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._position = 0
        self.headers = {"Content-Length": str(len(data))}

    def read(self, size: int) -> bytes:
        chunk = self._data[self._position : self._position + size]
        self._position += len(chunk)
        return chunk

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False


def test_tessdata_download_success(monkeypatch: pytest.MonkeyPatch, _writable_dir: Path) -> None:
    payload = b"x" * (200 * 1024)
    monkeypatch.setattr(
        tessdata.urllib.request, "urlopen", lambda *_args, **_kwargs: _FakeResponse(payload)
    )
    monkeypatch.setitem(tessdata.LANGUAGE_SHA256, "lat", hashlib.sha256(payload).hexdigest())

    result = tessdata.tessdata_download(
        tessdata.TessdataDownloadParams(code="lat"), silent_progress()
    )

    assert result.code == "lat"
    assert result.bytes == len(payload)
    assert Path(result.path).read_bytes() == payload


def test_tessdata_download_network_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(*_args: object, **_kwargs: object) -> None:
        raise OSError("boom")

    monkeypatch.setattr(tessdata.urllib.request, "urlopen", _raise)

    with pytest.raises(OpError) as excinfo:
        tessdata.tessdata_download(tessdata.TessdataDownloadParams(code="lat"), silent_progress())

    assert excinfo.value.code == ErrorCode.NETWORK


def test_tessdata_remove(_writable_dir: Path) -> None:
    _writable_dir.mkdir(parents=True, exist_ok=True)
    (_writable_dir / "lat.traineddata").write_bytes(b"x")

    removed = tessdata.tessdata_remove(tessdata.TessdataRemoveParams(code="lat"), silent_progress())
    missing = tessdata.tessdata_remove(tessdata.TessdataRemoveParams(code="lat"), silent_progress())

    assert removed.removed is True
    assert missing.removed is False


def test_tessdata_download_cancel_removes_partial_file(
    monkeypatch: pytest.MonkeyPatch, _writable_dir: Path
) -> None:
    payload = b"x" * (tessdata.CHUNK_SIZE * 4)
    monkeypatch.setattr(
        tessdata.urllib.request, "urlopen", lambda *_args, **_kwargs: _FakeResponse(payload)
    )
    cancel_event = threading.Event()
    progress = Progress(lambda *_args: cancel_event.set(), cancel_event)

    with pytest.raises(OpError) as excinfo:
        tessdata.tessdata_download(tessdata.TessdataDownloadParams(code="lat"), progress)

    assert excinfo.value.code == ErrorCode.CANCELLED
    assert list(_writable_dir.iterdir()) == []


def test_tessdata_download_write_failure_removes_partial_file(
    monkeypatch: pytest.MonkeyPatch, _writable_dir: Path
) -> None:
    class _BrokenResponse(_FakeResponse):
        def read(self, size: int) -> bytes:
            if self._position:
                raise RuntimeError("disk vanished")
            return super().read(size)

    monkeypatch.setattr(
        tessdata.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _BrokenResponse(b"x" * (tessdata.CHUNK_SIZE * 2)),
    )

    with pytest.raises(RuntimeError):
        tessdata.tessdata_download(tessdata.TessdataDownloadParams(code="lat"), silent_progress())

    assert list(_writable_dir.iterdir()) == []


def test_tessdata_download_rejects_a_file_with_the_wrong_checksum(
    monkeypatch: pytest.MonkeyPatch, _writable_dir: Path
) -> None:
    monkeypatch.setattr(
        tessdata.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _FakeResponse(b"y" * (200 * 1024)),
    )

    with pytest.raises(OpError) as excinfo:
        tessdata.tessdata_download(tessdata.TessdataDownloadParams(code="lat"), silent_progress())

    assert excinfo.value.code == ErrorCode.NETWORK
    assert excinfo.value.data["reason"] == "languageChecksum"
    assert list(_writable_dir.iterdir()) == []


def test_tessdata_download_uses_the_pinned_commit(
    monkeypatch: pytest.MonkeyPatch, _writable_dir: Path
) -> None:
    requested: list[str] = []

    def urlopen(request, **_kwargs):
        requested.append(request.full_url)
        raise OSError("offline")

    monkeypatch.setattr(tessdata.urllib.request, "urlopen", urlopen)

    with pytest.raises(OpError):
        tessdata.tessdata_download(tessdata.TessdataDownloadParams(code="deu"), silent_progress())

    assert requested == [
        f"https://github.com/tesseract-ocr/tessdata_fast/raw/{tessdata.TESSDATA_COMMIT}/deu.traineddata"
    ]


def test_every_language_has_a_sha256_and_bundled_files_match() -> None:
    assert set(tessdata.LANGUAGE_SHA256) == tessdata.LANGUAGE_CODES
    assert all(re.fullmatch(r"[0-9a-f]{64}", value) for value in tessdata.LANGUAGE_SHA256.values())
    for source in tessdata.BUNDLED_TESSDATA_DIR.glob("*.traineddata"):
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        assert digest == tessdata.LANGUAGE_SHA256[source.stem]
