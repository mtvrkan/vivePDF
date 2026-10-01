import hashlib
import json
import urllib.request
import wave
from pathlib import Path

import pytest
from piper import SynthesisConfig

from vivepdf.ops import tts
from vivepdf.ops.tts_catalog import CatalogEntry
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

CONFIG = {
    "audio": {"sample_rate": 22050, "quality": "medium"},
    "language": {"code": "en_GB", "family": "en"},
    "num_symbols": 256,
    "num_speakers": 3,
    "phoneme_id_map": {"_": [0]},
    "speaker_id_map": {"p239": 0, "p236": 1, "p264": 2},
}


@pytest.fixture(autouse=True)
def _data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "data"
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(directory))
    return directory


def test_the_catalogue_carries_config_checksums_and_multi_speaker_voices() -> None:
    assert all(len(entry.config_md5) == 32 for entry in tts.CATALOG)
    multi = {entry.id: entry.speakers for entry in tts.CATALOG if entry.speakers > 1}
    assert multi["en_GB-vctk-medium"] == 109
    assert "en_US-libritts_r-medium" in multi
    assert all(entry.speakers >= 1 for entry in tts.CATALOG)


class _Response:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.headers = {"Content-Length": str(len(payload))}

    def read(self, size: int) -> bytes:
        chunk, self.payload = self.payload[:size], self.payload[size:]
        return chunk

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def close(self) -> None:
        return None


def _serve(monkeypatch: pytest.MonkeyPatch, files: dict[str, bytes]) -> list[str]:
    asked: list[str] = []

    def fake_open(request: urllib.request.Request, timeout: float | None = None) -> _Response:
        url = request.full_url
        asked.append(url)
        return _Response(next(value for key, value in files.items() if url.endswith(key)))

    monkeypatch.setattr(tts._OPENER, "open", fake_open)
    return asked


def test_a_tampered_voice_config_is_refused(
    monkeypatch: pytest.MonkeyPatch, _data_dir: Path
) -> None:
    entry = tts.CATALOG_BY_ID["en_GB-vctk-medium"]
    _serve(monkeypatch, {".onnx.json": json.dumps(CONFIG).encode(), ".onnx": b"model"})
    with pytest.raises(OpError) as caught:
        tts.download(tts.VoiceIdParams(id=entry.id), silent_progress())
    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data["reason"] == "checksumMismatch"
    assert caught.value.data["url"].endswith(".onnx.json")
    assert not list((_data_dir / "tts").glob("en_GB-vctk-medium*"))


def test_a_config_with_the_catalogue_checksum_is_accepted(
    monkeypatch: pytest.MonkeyPatch, _data_dir: Path
) -> None:
    payload = json.dumps(CONFIG).encode()
    model = b"model-bytes"
    fake = CatalogEntry(
        "en_GB-test_multi-medium",
        "en",
        "en_GB",
        "Test Multi",
        "medium",
        1,
        hashlib.md5(model).hexdigest(),
        hashlib.md5(payload).hexdigest(),
        3,
    )
    monkeypatch.setitem(tts.CATALOG_BY_ID, fake.id, fake)
    asked = _serve(monkeypatch, {".onnx.json": payload, ".onnx": model})
    result = tts.download(tts.VoiceIdParams(id=fake.id), silent_progress())
    assert fake.id in result.installed
    assert len(asked) == 2


def test_an_installed_multi_speaker_voice_lists_its_speakers(_data_dir: Path) -> None:
    directory = _data_dir / "tts"
    directory.mkdir(parents=True)
    (directory / "en_GB-vctk-medium.onnx").write_bytes(b"onnx")
    (directory / "en_GB-vctk-medium.onnx.json").write_text(json.dumps(CONFIG), encoding="utf-8")
    (directory / "kendi_sesim.onnx").write_bytes(b"onnx")
    (directory / "kendi_sesim.onnx.json").write_text(json.dumps(CONFIG), encoding="utf-8")
    result = tts.voices(tts.VoicesParams(), silent_progress())
    by_id = {voice.id: voice for voice in result.voices}
    vctk = by_id["en_GB-vctk-medium"]
    assert vctk.speakers == 109
    assert [(item.id, item.name) for item in vctk.speaker_choices] == [
        (0, "p239"),
        (1, "p236"),
        (2, "p264"),
    ]
    assert by_id["kendi_sesim"].speakers == 3
    assert by_id["en_US-libritts_r-medium"].speaker_choices == []


class _Config:
    sample_rate = 22050
    num_speakers = 3


class _Voice:
    config = _Config()

    def __init__(self) -> None:
        self.speakers: list[int | None] = []

    def synthesize_wav(
        self, text: str, handle: wave.Wave_write, syn_config: SynthesisConfig
    ) -> None:
        self.speakers.append(syn_config.speaker_id)
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(22050)
        handle.writeframes(b"\x00\x00" * 100)


def test_synthesis_speaks_with_the_chosen_speaker(monkeypatch: pytest.MonkeyPatch) -> None:
    voice = _Voice()
    monkeypatch.setattr(tts, "_load_voice", lambda _voice_id: voice)
    tts.synthesize(
        tts.SynthesizeParams(
            voiceId="en_GB-vctk-medium", text="Bir. Iki.", speakerId=2, sentences=True
        ),
        silent_progress(),
    )
    tts.synthesize(
        tts.SynthesizeParams(voiceId="en_GB-vctk-medium", text="Bir."), silent_progress()
    )
    assert voice.speakers == [2, 2, None]


def test_a_speaker_outside_the_voice_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tts, "_load_voice", lambda _voice_id: _Voice())
    with pytest.raises(OpError) as caught:
        tts.synthesize(
            tts.SynthesizeParams(voiceId="en_GB-vctk-medium", text="Bir.", speakerId=7),
            silent_progress(),
        )
    assert caught.value.data["reason"] == "unknownSpeaker"
