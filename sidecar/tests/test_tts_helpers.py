import hashlib
import json
import types
from pathlib import Path

import pytest

from vivepdf.ops import tts
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

HELPER_BYTES = b"helper-model" * 32
BASE_CONFIG = {
    "audio": {"sample_rate": 22050, "quality": "medium"},
    "num_symbols": 256,
    "phoneme_id_map": {"_": [0]},
}
HEBREW_CONFIG = {**BASE_CONFIG, "language": {"code": "he_IL"}, "phoneme_type": "hebrew"}
ARABIC_CONFIG = {
    **BASE_CONFIG,
    "language": {"code": "ar_JO"},
    "phoneme_type": "espeak",
    "espeak": {"voice": "ar"},
}
TURKISH_CONFIG = {**BASE_CONFIG, "language": {"code": "tr_TR"}, "espeak": {"voice": "tr"}}


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


@pytest.fixture(autouse=True)
def _data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "data"
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(directory))
    return directory


@pytest.fixture
def bundled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "piper"
    for helper in (tts.NAKDIMON, tts.TASHKEEL):
        (root / helper.package_dir).mkdir(parents=True)
        for name in helper.companions:
            (root / helper.package_dir / name).write_text("{}", encoding="utf-8")
    monkeypatch.setattr(tts, "_piper_dir", lambda: root)
    digest = hashlib.sha256(HELPER_BYTES).hexdigest()
    monkeypatch.setattr(tts, "NAKDIMON", tts.NAKDIMON._replace(sha256=digest))
    monkeypatch.setattr(tts, "TASHKEEL", tts.TASHKEEL._replace(sha256=digest))
    return root


def _serve(monkeypatch: pytest.MonkeyPatch, files: dict[str, bytes]) -> list[str]:
    requested: list[str] = []

    def _open(request, **_kwargs):
        requested.append(request.full_url)
        for suffix, data in files.items():
            if request.full_url.endswith(suffix):
                return _FakeDownload(data)
        raise AssertionError(request.full_url)

    monkeypatch.setattr(tts._OPENER, "open", _open)
    return requested


def _catalog_voice(monkeypatch: pytest.MonkeyPatch, voice_id: str, config: dict) -> tuple:
    config_bytes = json.dumps(config).encode("utf-8")
    model_bytes = b"m" * 64
    entry = tts.CATALOG_BY_ID[voice_id]._replace(
        config_md5=hashlib.md5(config_bytes).hexdigest(),
        checksum_md5=hashlib.md5(model_bytes).hexdigest(),
    )
    monkeypatch.setitem(tts.CATALOG_BY_ID, entry.id, entry)
    return entry, config_bytes, model_bytes


def _write_voice(directory: Path, stem: str, config: dict) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    model = directory / f"{stem}.onnx"
    model.write_bytes(b"onnx" * 64)
    (directory / f"{stem}.onnx.json").write_text(json.dumps(config), encoding="utf-8")
    return model


@pytest.mark.parametrize(
    ("config", "expected"),
    [
        (HEBREW_CONFIG, "nakdimon"),
        (ARABIC_CONFIG, "tashkeel"),
        ({**ARABIC_CONFIG, "phoneme_type": None}, "tashkeel"),
        (TURKISH_CONFIG, None),
        ({**ARABIC_CONFIG, "phoneme_type": "text"}, None),
        ({**BASE_CONFIG, "espeak": "ar"}, None),
    ],
)
def test_only_hebrew_and_arabic_espeak_voices_need_a_helper(
    config: dict, expected: str | None
) -> None:
    helper = tts._helper_for_config(config)

    assert (helper.name if helper else None) == expected


def test_downloading_a_hebrew_voice_fetches_nakdimon_from_the_models_release(
    monkeypatch: pytest.MonkeyPatch, bundled: Path, _data_dir: Path
) -> None:
    entry, config_bytes, model_bytes = _catalog_voice(
        monkeypatch, "he_IL-saspeech-medium", HEBREW_CONFIG
    )
    requested = _serve(
        monkeypatch,
        {
            ".onnx.json": config_bytes,
            f"{entry.id}.onnx": model_bytes,
            "nakdimon.onnx": HELPER_BYTES,
        },
    )

    result = tts.download(tts.VoiceIdParams(id=entry.id), silent_progress())

    assert entry.id in result.installed
    assert requested[-1] == f"{tts.HELPERS_BASE_URL}/nakdimon.onnx"
    helper = _data_dir / "tts" / "helpers" / "nakdimon" / "nakdimon.onnx"
    assert helper.read_bytes() == HELPER_BYTES
    assert tts._helper_dir(tts.NAKDIMON) == helper.parent


def test_a_helper_checksum_mismatch_rolls_the_whole_voice_back(
    monkeypatch: pytest.MonkeyPatch, bundled: Path, _data_dir: Path
) -> None:
    entry, config_bytes, model_bytes = _catalog_voice(
        monkeypatch, "he_IL-saspeech-medium", HEBREW_CONFIG
    )
    _serve(
        monkeypatch,
        {".onnx.json": config_bytes, f"{entry.id}.onnx": model_bytes, "nakdimon.onnx": b"bad"},
    )

    with pytest.raises(OpError) as caught:
        tts.download(tts.VoiceIdParams(id=entry.id), silent_progress())

    assert caught.value.data["reason"] == "checksumMismatch"
    assert tts.installed_voice_ids() == []
    helpers = _data_dir / "tts" / "helpers" / "nakdimon"
    assert not (helpers / "nakdimon.onnx").exists()
    assert not (helpers / "nakdimon.onnx.part").exists()


def test_a_bundled_helper_is_used_without_downloading(
    monkeypatch: pytest.MonkeyPatch, bundled: Path
) -> None:
    (bundled / "hebrew" / "nakdimon.onnx").write_bytes(HELPER_BYTES)
    entry, config_bytes, model_bytes = _catalog_voice(
        monkeypatch, "he_IL-saspeech-medium", HEBREW_CONFIG
    )
    requested = _serve(monkeypatch, {".onnx.json": config_bytes, ".onnx": model_bytes})

    tts.download(tts.VoiceIdParams(id=entry.id), silent_progress())

    assert len(requested) == 2
    assert tts._helper_dir(tts.NAKDIMON) == bundled / "hebrew"


def test_importing_an_arabic_voice_fetches_tashkeel_next_to_its_id_maps(
    monkeypatch: pytest.MonkeyPatch, bundled: Path, tmp_path: Path, _data_dir: Path
) -> None:
    source = _write_voice(tmp_path / "downloads", "arabic", ARABIC_CONFIG)
    _serve(monkeypatch, {"tashkeel.onnx": HELPER_BYTES})

    tts.import_voice(tts.ImportParams(path=str(source)), silent_progress())

    directory = _data_dir / "tts" / "helpers" / "tashkeel"
    assert (directory / "model.onnx").read_bytes() == HELPER_BYTES
    assert all((directory / name).is_file() for name in tts.TASHKEEL.companions)


def test_an_import_whose_helper_cannot_download_leaves_nothing_behind(
    monkeypatch: pytest.MonkeyPatch, bundled: Path, tmp_path: Path, _data_dir: Path
) -> None:
    source = _write_voice(tmp_path / "downloads", "arabic", ARABIC_CONFIG)
    _serve(monkeypatch, {"tashkeel.onnx": b"bad"})

    with pytest.raises(OpError):
        tts.import_voice(tts.ImportParams(path=str(source)), silent_progress())

    assert tts.installed_voice_ids() == []


def test_catalogue_sizes_include_a_helper_that_still_has_to_download(bundled: Path) -> None:
    sizes = {
        voice.id: voice.size_mb
        for voice in tts.voices(tts.VoicesParams(), silent_progress()).voices
    }
    entry = tts.CATALOG_BY_ID["he_IL-saspeech-medium"]
    assert sizes[entry.id] == entry.size_mb + 21
    turkish = tts.CATALOG_BY_ID["tr_TR-fettah-medium"]
    assert sizes[turkish.id] == turkish.size_mb

    (bundled / "hebrew" / "nakdimon.onnx").write_bytes(HELPER_BYTES)
    sizes = {
        voice.id: voice.size_mb
        for voice in tts.voices(tts.VoicesParams(), silent_progress()).voices
    }
    assert sizes[entry.id] == entry.size_mb


def test_removing_the_last_voice_that_needs_a_helper_deletes_it(
    monkeypatch: pytest.MonkeyPatch, bundled: Path, _data_dir: Path
) -> None:
    voices = _data_dir / "tts"
    _write_voice(voices, "hebrew-one", HEBREW_CONFIG)
    _write_voice(voices, "hebrew-two", HEBREW_CONFIG)
    helper = voices / "helpers" / "nakdimon"
    helper.mkdir(parents=True)
    (helper / "nakdimon.onnx").write_bytes(HELPER_BYTES)

    tts.remove(tts.VoiceIdParams(id="hebrew-one"), silent_progress())
    assert helper.is_dir()

    tts.remove(tts.VoiceIdParams(id="hebrew-two"), silent_progress())
    assert not helper.exists()


def test_synthesis_fetches_a_missing_helper_before_loading_the_voice(
    monkeypatch: pytest.MonkeyPatch, bundled: Path, _data_dir: Path
) -> None:
    _write_voice(_data_dir / "tts", "hebrew", HEBREW_CONFIG)
    requested = _serve(monkeypatch, {"nakdimon.onnx": HELPER_BYTES})
    order: list[str] = []

    def _load(_voice_id: str):
        order.append(f"load after {len(requested)} downloads")
        raise OpError(tts.ErrorCode.INTERNAL, "stop", {})

    monkeypatch.setattr(tts, "_load_voice", _load)

    with pytest.raises(OpError):
        tts.synthesize(tts.SynthesizeParams(voiceId="hebrew", text="שלום"), silent_progress())

    assert order == ["load after 1 downloads"]


def test_attach_helper_wires_the_bundled_models_into_piper() -> None:
    from piper.phonemize_hebrew import HebrewPhonemizer
    from piper.tashkeel import TashkeelDiacritizer

    hebrew = types.SimpleNamespace(
        config=types.SimpleNamespace(phoneme_type="hebrew", espeak_voice="he")
    )
    arabic = types.SimpleNamespace(
        config=types.SimpleNamespace(phoneme_type="espeak", espeak_voice="ar"),
        tashkeel_diacritizier=None,
    )

    tts._attach_helper(hebrew)
    tts._attach_helper(arabic)

    assert isinstance(hebrew._hebrew_phonemizer, HebrewPhonemizer)
    assert isinstance(arabic.tashkeel_diacritizier, TashkeelDiacritizer)


def test_attach_helper_refuses_a_voice_whose_helper_is_missing(bundled: Path) -> None:
    hebrew = types.SimpleNamespace(
        config=types.SimpleNamespace(phoneme_type="hebrew", espeak_voice="he")
    )

    with pytest.raises(OpError) as caught:
        tts._attach_helper(hebrew)

    assert caught.value.data["reason"] == "voiceHelperMissing"
