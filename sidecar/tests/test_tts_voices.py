import hashlib
import json
import threading
from pathlib import Path

import pytest

from vivepdf.ops import tts
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

VALID_CONFIG = {
    "audio": {"sample_rate": 22050, "quality": "medium"},
    "language": {"code": "tr_TR", "family": "tr"},
    "num_symbols": 256,
    "phoneme_id_map": {"_": [0]},
}


@pytest.fixture(autouse=True)
def _data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "data"
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(directory))
    return directory


def _write_voice(directory: Path, stem: str, config: dict | None = VALID_CONFIG) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    model = directory / f"{stem}.onnx"
    model.write_bytes(b"onnx" * 64)
    if config is not None:
        (directory / f"{stem}.onnx.json").write_text(json.dumps(config), encoding="utf-8")
    return model


def test_catalog_entries_are_unique_and_well_formed() -> None:
    ids = [entry.id for entry in tts.CATALOG]
    assert len(ids) == len(set(ids))
    assert len(ids) > 100
    for entry in tts.CATALOG:
        assert entry.id.startswith(f"{entry.locale}-")
        assert entry.locale.split("_")[0] == entry.language
        assert len(entry.checksum_md5) == 32
        assert entry.size_mb > 0


def test_remote_base_quotes_non_ascii_ids() -> None:
    base = tts._remote_base("pt_PT-tugão-medium")
    assert base.endswith("/pt/pt_PT/tug%C3%A3o/medium/pt_PT-tug%C3%A3o-medium")
    assert "/resolve/v1.0.0/" in base


def test_a_voice_newer_than_the_catalogue_release_downloads_from_its_own_pinned_commit(
    monkeypatch: pytest.MonkeyPatch, _data_dir: Path
) -> None:
    config_bytes = json.dumps(VALID_CONFIG).encode("utf-8")
    model_bytes = b"m" * 64
    hebrew = tts.CATALOG_BY_ID["he_IL-saspeech-medium"]
    entry = hebrew._replace(
        config_md5=hashlib.md5(config_bytes).hexdigest(),
        checksum_md5=hashlib.md5(model_bytes).hexdigest(),
    )
    monkeypatch.setitem(tts.CATALOG_BY_ID, entry.id, entry)
    requested: list[str] = []

    def _open(request, **_kwargs):
        requested.append(request.full_url)
        return _FakeDownload(config_bytes if request.full_url.endswith(".json") else model_bytes)

    monkeypatch.setattr(tts._OPENER, "open", _open)

    result = tts.download(tts.VoiceIdParams(id=entry.id), silent_progress())

    assert entry.id in result.installed
    assert len(hebrew.revision) == 40
    assert requested == [
        f"{tts.VOICES_BASE_URL}/{hebrew.revision}/he/he_IL/saspeech/medium/{entry.id}{suffix}"
        for suffix in (".onnx.json", ".onnx")
    ]
    assert all(
        voice.revision == tts.VOICES_REVISION
        for voice in tts.CATALOG
        if voice.id != "he_IL-saspeech-medium"
    )


def test_voices_lists_catalog_and_custom_voices(_data_dir: Path) -> None:
    _write_voice(_data_dir / "tts", "my_voice")
    _write_voice(_data_dir / "tts", "tr_TR-fettah-medium")

    result = tts.voices(tts.VoicesParams(), silent_progress())

    by_id = {voice.id: voice for voice in result.voices}
    assert by_id["tr_TR-fettah-medium"].installed is True
    assert by_id["tr_TR-fettah-medium"].source == "catalog"
    assert by_id["tr_TR-fettah-medium"].locale == "tr_TR"
    custom = by_id["my_voice"]
    assert custom.source == "custom"
    assert custom.installed is True
    assert custom.language == "tr"
    assert custom.locale == "tr_TR"
    assert custom.quality == "medium"
    assert custom.size_mb >= 1


def test_voices_skips_custom_voice_with_broken_config(_data_dir: Path) -> None:
    model = _write_voice(_data_dir / "tts", "broken", config=None)
    model.with_name("broken.onnx.json").write_text("{not json", encoding="utf-8")

    result = tts.voices(tts.VoicesParams(), silent_progress())

    assert all(voice.id != "broken" for voice in result.voices)


def test_import_copies_model_and_config(tmp_path: Path, _data_dir: Path) -> None:
    source = _write_voice(tmp_path / "downloads", "Ses Modeli v2")

    result = tts.import_voice(tts.ImportParams(path=str(source)), silent_progress())

    assert result.id == "Ses-Modeli-v2"
    assert result.id in result.installed
    assert (_data_dir / "tts" / "Ses-Modeli-v2.onnx").read_bytes() == source.read_bytes()
    assert (_data_dir / "tts" / "Ses-Modeli-v2.onnx.json").exists()


def test_import_rejects_duplicate_missing_config_and_invalid_config(
    tmp_path: Path, _data_dir: Path
) -> None:
    source = _write_voice(tmp_path / "downloads", "dup")
    tts.import_voice(tts.ImportParams(path=str(source)), silent_progress())
    with pytest.raises(OpError) as duplicate:
        tts.import_voice(tts.ImportParams(path=str(source)), silent_progress())
    assert duplicate.value.data["reason"] == "voiceExists"

    no_config = _write_voice(tmp_path / "downloads", "lonely", config=None)
    with pytest.raises(OpError) as missing:
        tts.import_voice(tts.ImportParams(path=str(no_config)), silent_progress())
    assert missing.value.data["reason"] == "voiceConfigMissing"

    bad = _write_voice(tmp_path / "downloads", "bad", config={"audio": {"sample_rate": "x"}})
    with pytest.raises(OpError) as invalid:
        tts.import_voice(tts.ImportParams(path=str(bad)), silent_progress())
    assert invalid.value.data["reason"] == "voiceConfigInvalid"

    with pytest.raises(OpError) as not_model:
        tts.import_voice(tts.ImportParams(path=str(tmp_path / "nope.txt")), silent_progress())
    assert not_model.value.code == ErrorCode.INVALID_PARAMS


def test_remove_accepts_custom_voice_and_rejects_traversal(_data_dir: Path) -> None:
    _write_voice(_data_dir / "tts", "my_voice")

    result = tts.remove(tts.VoiceIdParams(id="my_voice"), silent_progress())

    assert "my_voice" not in result.installed
    assert not (_data_dir / "tts" / "my_voice.onnx").exists()
    for bad_id in ("../etc", "..\\x", "a/b", "unknown-voice-id"):
        with pytest.raises(OpError) as excinfo:
            tts.remove(tts.VoiceIdParams(id=bad_id), silent_progress())
        assert excinfo.value.code == ErrorCode.INVALID_PARAMS


class _FakeDownload:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._position = 0
        self.headers = {"Content-Length": str(len(data))}

    def read(self, size: int) -> bytes:
        chunk = self._data[self._position : self._position + size]
        self._position += len(chunk)
        return chunk

    def __enter__(self) -> "_FakeDownload":
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False


def test_download_cancel_removes_config_and_partial_model(
    monkeypatch: pytest.MonkeyPatch, _data_dir: Path
) -> None:
    config_bytes = json.dumps(VALID_CONFIG).encode("utf-8")
    entry = tts.CATALOG[0]._replace(config_md5=hashlib.md5(config_bytes).hexdigest())
    monkeypatch.setitem(tts.CATALOG_BY_ID, entry.id, entry)
    model_bytes = b"m" * (tts.CHUNK * 4)
    monkeypatch.setattr(
        tts._OPENER,
        "open",
        lambda request, **_kwargs: _FakeDownload(
            config_bytes if request.full_url.endswith(".json") else model_bytes
        ),
    )
    cancel_event = threading.Event()

    def _sink(value: float, _message: object, _detail: object) -> None:
        if value > 0.02:
            cancel_event.set()

    with pytest.raises(OpError) as excinfo:
        tts.download(tts.VoiceIdParams(id=entry.id), Progress(_sink, cancel_event))

    assert excinfo.value.code == ErrorCode.CANCELLED
    assert list(tts.voices_dir().iterdir()) == []
    assert entry.id not in tts.installed_voice_ids()
