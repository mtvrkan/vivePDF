import base64
import hashlib
import importlib.util
import io
import json
import re
import shutil
import threading
import urllib.error
import urllib.parse
import urllib.request
import wave
from collections import OrderedDict
from pathlib import Path
from typing import NamedTuple

from pydantic import Field

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops.tts_catalog import CATALOG, CATALOG_BY_ID
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

VOICES_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve"
VOICES_REVISION = "v1.0.0"
DOWNLOAD_TIMEOUT = 60
CHUNK = 1024 * 256
MAX_TEXT_CHARS = 20000
MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024
SENTENCE_MAX_CHARS = 400
VOICE_ID_RE = re.compile(r"^[\w.\-]{2,120}$")
MODEL_SUFFIX = ".onnx"
CONFIG_SUFFIX = ".onnx.json"
ALLOWED_HOSTS = {
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.huggingface.co",
    "cdn-lfs-eu-1.huggingface.co",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}
HELPERS_BASE_URL = "https://github.com/mtvrkan/vivepdf-models/releases/download/tts-helpers-2026.09"


class VoiceHelper(NamedTuple):
    name: str
    package_dir: str
    file_name: str
    sha256: str
    size_bytes: int
    companions: tuple[str, ...] = ()


NAKDIMON = VoiceHelper(
    "nakdimon",
    "hebrew",
    "nakdimon.onnx",
    "9ff491dcc7d66392019d427a98b97d5de10c0d721628ae740858174ae22b190e",
    21312753,
)
TASHKEEL = VoiceHelper(
    "tashkeel",
    "tashkeel",
    "model.onnx",
    "52c40d42ca094ff9ff07a091d0a1eafd7baa5cf2388e60a9cc89bacd8e5e955f",
    4788213,
    ("input_id_map.json", "target_id_map.json", "hint_id_map.json"),
)
HELPER_BY_LANGUAGE = {"he": NAKDIMON, "ar": TASHKEEL}
ABBREVIATIONS = {
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "sr",
    "jr",
    "vs",
    "etc",
    "eg",
    "ie",
    "no",
    "st",
    "vol",
    "fig",
    "cf",
    "approx",
    "sn",
    "sy",
    "dt",
    "op",
}


class VoiceSpeaker(RpcModel):
    id: int
    name: str


class VoiceInfo(RpcModel):
    id: str
    language: str
    locale: str
    name: str
    quality: str
    size_mb: int
    installed: bool
    source: str
    speakers: int = 1
    speaker_choices: list[VoiceSpeaker] = Field(default_factory=list)


_LOADED_MAX = 3
_loaded_lock = threading.Lock()
_loaded: "OrderedDict[str, object]" = OrderedDict()


def voices_dir() -> Path:
    directory = user_data_dir() / "tts"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _voice_paths(voice_id: str) -> tuple[Path, Path]:
    directory = voices_dir()
    return directory / f"{voice_id}.onnx", directory / f"{voice_id}.onnx.json"


def _remote_base(voice_id: str, revision: str = VOICES_REVISION) -> str:
    locale, name, quality = voice_id.split("-", 2)
    language = locale.split("_")[0]
    segments = "/".join(
        urllib.parse.quote(part) for part in (language, locale, name, quality, voice_id)
    )
    return f"{VOICES_BASE_URL}/{urllib.parse.quote(revision)}/{segments}"


def _valid_voice_id(voice_id: str) -> bool:
    return bool(VOICE_ID_RE.match(voice_id)) and ".." not in voice_id


def _read_voice_config(path: Path) -> dict:
    try:
        with open(path, encoding="utf-8") as handle:
            config = json.load(handle)
    except (OSError, ValueError) as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"invalid voice config: {error}",
            {"reason": "voiceConfigInvalid"},
        ) from error
    audio = config.get("audio") if isinstance(config, dict) else None
    sample_rate = audio.get("sample_rate") if isinstance(audio, dict) else None
    has_symbols = isinstance(config, dict) and (
        "phoneme_id_map" in config or "num_symbols" in config
    )
    if not isinstance(sample_rate, int) or sample_rate <= 0 or not has_symbols:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "voice config is not a Piper voice",
            {"reason": "voiceConfigInvalid"},
        )
    return config


def _speaker_choices(config: dict) -> list[VoiceSpeaker]:
    mapping = config.get("speaker_id_map")
    if not isinstance(mapping, dict) or len(mapping) < 2:
        return []
    choices = [
        VoiceSpeaker(id=value, name=str(name))
        for name, value in mapping.items()
        if isinstance(value, int) and value >= 0
    ]
    return sorted(choices, key=lambda item: item.id)


def _installed_speakers(config_path: Path) -> list[VoiceSpeaker]:
    try:
        return _speaker_choices(_read_voice_config(config_path))
    except OpError:
        return []


def _custom_voice_info(voice_id: str, model: Path, config_path: Path) -> VoiceInfo | None:
    try:
        config = _read_voice_config(config_path)
    except OpError:
        return None
    language = config.get("language") if isinstance(config.get("language"), dict) else {}
    locale = str(language.get("code") or "")
    family = str(language.get("family") or locale.split("_")[0] or "")
    audio = config.get("audio") if isinstance(config.get("audio"), dict) else {}
    quality = str(audio.get("quality") or "custom")
    try:
        size_mb = max(1, round(model.stat().st_size / 1_000_000))
    except OSError:
        size_mb = 0
    choices = _speaker_choices(config)
    return VoiceInfo(
        id=voice_id,
        language=family,
        locale=locale,
        name=voice_id,
        quality=quality,
        size_mb=size_mb,
        installed=True,
        source="custom",
        speakers=max(1, len(choices)),
        speaker_choices=choices,
    )


def installed_voice_ids() -> list[str]:
    return sorted(
        path.name[: -len(".onnx")]
        for path in voices_dir().glob("*.onnx")
        if path.with_name(path.name + ".json").exists()
    )


class VoicesParams(RpcModel):
    pass


class VoicesResult(RpcModel):
    directory: str
    voices: list[VoiceInfo]


@op("tts.voices", VoicesParams)
def voices(_params: VoicesParams, _progress: Progress) -> VoicesResult:
    installed = set(installed_voice_ids())
    items = [
        VoiceInfo(
            id=entry.id,
            language=entry.language,
            locale=entry.locale,
            name=entry.name,
            quality=entry.quality,
            size_mb=entry.size_mb + _pending_helper_mb(entry.language),
            installed=entry.id in installed,
            source="catalog",
            speakers=entry.speakers,
            speaker_choices=(
                _installed_speakers(_voice_paths(entry.id)[1])
                if entry.id in installed and entry.speakers > 1
                else []
            ),
        )
        for entry in CATALOG
    ]
    for voice_id in sorted(installed - set(CATALOG_BY_ID)):
        if not _valid_voice_id(voice_id):
            continue
        model, config = _voice_paths(voice_id)
        info = _custom_voice_info(voice_id, model, config)
        if info is not None:
            items.append(info)
    return VoicesResult(directory=str(voices_dir()), voices=items)


class VoiceIdParams(RpcModel):
    id: str = Field(min_length=3)


class VoiceChangedResult(RpcModel):
    id: str
    installed: list[str]


def _host_allowed(host: str | None) -> bool:
    if not host:
        return False
    host = host.lower()
    return host in ALLOWED_HOSTS or host.endswith(".hf.co")


def _assert_trusted_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not _host_allowed(parsed.hostname):
        raise OpError(
            ErrorCode.NETWORK,
            f"blocked untrusted host: {parsed.hostname}",
            {"url": url, "reason": "untrustedHost"},
        )


class _AllowlistRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        _assert_trusted_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_AllowlistRedirectHandler)


def _fetch(
    url: str,
    target: Path,
    progress: Progress,
    label: str,
    weight: tuple[float, float],
    expected_md5: str | None = None,
    expected_sha256: str | None = None,
) -> None:
    _assert_trusted_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "vivePDF"})
    try:
        response = _OPENER.open(request, timeout=DOWNLOAD_TIMEOUT)
    except OpError:
        raise
    except (OSError, urllib.error.URLError) as error:
        raise OpError(ErrorCode.NETWORK, f"download failed: {error}", {"url": url}) from error
    total = int(response.headers.get("Content-Length") or 0)
    if total > MAX_DOWNLOAD_BYTES:
        response.close()
        raise OpError(
            ErrorCode.NETWORK,
            f"download too large: {total} bytes",
            {"url": url, "reason": "downloadTooLarge"},
        )
    done = 0
    expected = expected_sha256 or expected_md5
    digest = hashlib.new("sha256" if expected_sha256 else "md5") if expected else None
    temporary = target.with_suffix(target.suffix + ".part")
    start, end = weight
    with response, open(temporary, "wb") as handle:
        while True:
            progress.check_cancelled()
            chunk = response.read(CHUNK)
            if not chunk:
                break
            done += len(chunk)
            if done > MAX_DOWNLOAD_BYTES:
                handle.close()
                temporary.unlink(missing_ok=True)
                raise OpError(
                    ErrorCode.NETWORK,
                    "download exceeded size cap",
                    {"url": url, "reason": "downloadTooLarge"},
                )
            handle.write(chunk)
            if digest is not None:
                digest.update(chunk)
            fraction = done / total if total else 0.0
            progress.report(
                start + (end - start) * fraction,
                "progress.downloading",
                {"label": label, "done": done, "total": total},
            )
    if digest is not None and digest.hexdigest() != expected:
        temporary.unlink(missing_ok=True)
        raise OpError(
            ErrorCode.NETWORK,
            "checksum mismatch",
            {"url": url, "reason": "checksumMismatch"},
        )
    if target.exists():
        target.unlink()
    temporary.replace(target)


def _helper_for(phoneme_type: str | None, espeak_voice: str | None) -> VoiceHelper | None:
    kind = phoneme_type or "espeak"
    if kind == "hebrew":
        return NAKDIMON
    if kind == "espeak" and espeak_voice == "ar":
        return TASHKEEL
    return None


def _helper_for_config(config: dict) -> VoiceHelper | None:
    espeak = config.get("espeak") if isinstance(config.get("espeak"), dict) else {}
    phoneme_type = config.get("phoneme_type")
    return _helper_for(
        phoneme_type if isinstance(phoneme_type, str) else None,
        espeak.get("voice") if isinstance(espeak.get("voice"), str) else None,
    )


def _piper_dir() -> Path | None:
    spec = importlib.util.find_spec("piper")
    locations = list(spec.submodule_search_locations or []) if spec else []
    return Path(locations[0]) if locations else None


def _bundled_helper_dir(helper: VoiceHelper) -> Path | None:
    piper = _piper_dir()
    return piper / helper.package_dir if piper is not None else None


def _downloaded_helper_dir(helper: VoiceHelper) -> Path:
    return voices_dir() / "helpers" / helper.name


def _helper_complete(helper: VoiceHelper, directory: Path) -> bool:
    return all((directory / name).is_file() for name in (helper.file_name, *helper.companions))


def _helper_dir(helper: VoiceHelper) -> Path | None:
    for directory in (_bundled_helper_dir(helper), _downloaded_helper_dir(helper)):
        if directory is not None and _helper_complete(helper, directory):
            return directory
    return None


def _pending_helper_mb(language: str) -> int:
    helper = HELPER_BY_LANGUAGE.get(language)
    if helper is None or _helper_dir(helper) is not None:
        return 0
    return max(1, round(helper.size_bytes / 1_000_000))


def _ensure_helper(
    helper: VoiceHelper, progress: Progress, label: str, weight: tuple[float, float]
) -> Path:
    available = _helper_dir(helper)
    if available is not None:
        return available
    directory = _downloaded_helper_dir(helper)
    directory.mkdir(parents=True, exist_ok=True)
    bundled = _bundled_helper_dir(helper)
    for name in helper.companions:
        source = bundled / name if bundled is not None else None
        if source is None or not source.is_file():
            raise OpError(
                ErrorCode.INTERNAL,
                f"voice helper file missing: {name}",
                {"reason": "voiceHelperMissing"},
            )
        shutil.copyfile(source, directory / name)
    target = directory / helper.file_name
    try:
        _fetch(
            f"{HELPERS_BASE_URL}/{helper.name}.onnx",
            target,
            progress,
            label,
            weight,
            expected_sha256=helper.sha256,
        )
    except BaseException:
        target.with_name(target.name + ".part").unlink(missing_ok=True)
        raise
    return directory


def _ensure_voice_helper(
    config_path: Path, progress: Progress, label: str, weight: tuple[float, float]
) -> None:
    if not config_path.is_file():
        return
    helper = _helper_for_config(_read_voice_config(config_path))
    if helper is not None:
        _ensure_helper(helper, progress, label, weight)


def _prune_helpers() -> None:
    needed = set()
    for voice_id in installed_voice_ids():
        try:
            helper = _helper_for_config(_read_voice_config(_voice_paths(voice_id)[1]))
        except OpError:
            continue
        if helper is not None:
            needed.add(helper.name)
    for helper in (NAKDIMON, TASHKEEL):
        if helper.name not in needed:
            shutil.rmtree(_downloaded_helper_dir(helper), ignore_errors=True)


@op("tts.download", VoiceIdParams)
def download(params: VoiceIdParams, progress: Progress) -> VoiceChangedResult:
    entry = CATALOG_BY_ID.get(params.id)
    if entry is None:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"unknown voice: {params.id}", {"reason": "unknownVoice"}
        )
    model, config = _voice_paths(params.id)
    base = _remote_base(params.id, entry.revision)
    try:
        _fetch(f"{base}.onnx.json", config, progress, params.id, (0.0, 0.02), entry.config_md5)
        helper = _helper_for_config(_read_voice_config(config))
        pending = helper is not None and _helper_dir(helper) is None
        voice_end = 0.8 if pending else 1.0
        _fetch(f"{base}.onnx", model, progress, params.id, (0.02, voice_end), entry.checksum_md5)
        if helper is not None:
            _ensure_helper(helper, progress, params.id, (voice_end, 1.0))
    except BaseException:
        for path in (
            model,
            config,
            model.with_suffix(".onnx.part"),
            config.with_suffix(".json.part"),
        ):
            if path.exists():
                path.unlink()
        raise
    return VoiceChangedResult(id=params.id, installed=installed_voice_ids())


class ImportParams(RpcModel):
    path: str = Field(min_length=1)


def _copy_voice_file(source: Path, target: Path) -> None:
    temporary = target.with_name(target.name + ".part")
    try:
        shutil.copyfile(source, temporary)
        temporary.replace(target)
    except OSError as error:
        temporary.unlink(missing_ok=True)
        raise OpError(ErrorCode.INTERNAL, f"copy failed: {error}", {"path": str(source)}) from error


@op("tts.import", ImportParams)
def import_voice(params: ImportParams, progress: Progress) -> VoiceChangedResult:
    source = Path(params.path)
    if not source.is_file() or source.suffix.lower() != MODEL_SUFFIX:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"not a Piper model: {params.path}",
            {"path": params.path, "reason": "voiceModelInvalid"},
        )
    source_config = source.with_name(source.name + ".json")
    if not source_config.is_file():
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"missing voice config next to {source.name}",
            {"path": str(source_config), "reason": "voiceConfigMissing"},
        )
    if source.stat().st_size > MAX_DOWNLOAD_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "voice model too large",
            {"path": params.path, "reason": "voiceTooLarge"},
        )
    helper = _helper_for_config(_read_voice_config(source_config))
    voice_id = re.sub(r"[^\w.\-]+", "-", source.stem).strip("-.")
    if not _valid_voice_id(voice_id):
        voice_id = "custom-voice"
    model, config = _voice_paths(voice_id)
    if model.exists() or config.exists():
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"voice already installed: {voice_id}",
            {"id": voice_id, "reason": "voiceExists"},
        )
    _copy_voice_file(source_config, config)
    try:
        _copy_voice_file(source, model)
        if helper is not None:
            _ensure_helper(helper, progress, voice_id, (0.0, 1.0))
    except BaseException:
        config.unlink(missing_ok=True)
        model.unlink(missing_ok=True)
        raise
    return VoiceChangedResult(id=voice_id, installed=installed_voice_ids())


@op("tts.remove", VoiceIdParams)
def remove(params: VoiceIdParams, _progress: Progress) -> VoiceChangedResult:
    if not _valid_voice_id(params.id):
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"invalid voice id: {params.id}", {"reason": "unknownVoice"}
        )
    if params.id not in CATALOG_BY_ID and params.id not in installed_voice_ids():
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"unknown voice: {params.id}", {"reason": "unknownVoice"}
        )
    model, config = _voice_paths(params.id)
    directory = voices_dir().resolve()
    for path in (model, config):
        if path.resolve().parent != directory:
            raise OpError(
                ErrorCode.PERMISSION_DENIED, "invalid voice path", {"reason": "invalidPath"}
            )
    with _loaded_lock:
        _loaded.pop(params.id, None)
    for path in (model, config):
        if path.exists():
            path.unlink()
    _prune_helpers()
    return VoiceChangedResult(id=params.id, installed=installed_voice_ids())


def _load_voice(voice_id: str):
    with _loaded_lock:
        cached = _loaded.get(voice_id)
        if cached is not None:
            _loaded.move_to_end(voice_id)
            return cached
        model, config = _voice_paths(voice_id)
        if not model.exists() or not config.exists():
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"voice not installed: {voice_id}",
                {"reason": "voiceMissing"},
            )
        from piper import PiperVoice

        voice = PiperVoice.load(str(model), config_path=str(config))
        _attach_helper(voice)
        _loaded[voice_id] = voice
        _loaded.move_to_end(voice_id)
        while len(_loaded) > _LOADED_MAX:
            _loaded.popitem(last=False)
        return voice


def _attach_helper(voice) -> None:
    config = voice.config
    phoneme_type = getattr(config.phoneme_type, "value", config.phoneme_type)
    helper = _helper_for(phoneme_type, config.espeak_voice)
    if helper is None:
        return
    directory = _helper_dir(helper)
    if directory is None:
        raise OpError(
            ErrorCode.INTERNAL,
            f"voice helper missing: {helper.name}",
            {"reason": "voiceHelperMissing"},
        )
    if helper is NAKDIMON:
        from piper.phonemize_hebrew import HebrewPhonemizer

        voice._hebrew_phonemizer = HebrewPhonemizer(directory / helper.file_name)
    else:
        from piper.tashkeel import TashkeelDiacritizer

        voice.tashkeel_diacritizier = TashkeelDiacritizer(directory)


def split_sentences(text: str, max_chars: int = SENTENCE_MAX_CHARS) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    ender = re.compile(r"[.!?…]+")
    sentences: list[str] = []
    start = 0
    for match in ender.finditer(normalized):
        end = match.end()
        word_match = re.search(r"([A-Za-zÇĞİÖŞÜçğıöşü]+)$", normalized[start : match.start()])
        word = word_match.group(1).lower() if word_match else ""
        next_char = normalized[end : end + 1]
        if word in ABBREVIATIONS and next_char != "":
            continue
        if next_char and not next_char.isspace() and next_char not in ('"', "'", ")", "”"):
            continue
        sentence = normalized[start:end].strip()
        if sentence:
            sentences.append(sentence)
        start = end
    tail = normalized[start:].strip()
    if tail:
        sentences.append(tail)
    return _cap_sentence_length(sentences, max_chars)


def _cap_sentence_length(sentences: list[str], max_chars: int) -> list[str]:
    result: list[str] = []
    for sentence in sentences:
        if len(sentence) <= max_chars:
            result.append(sentence)
            continue
        words = sentence.split(" ")
        chunk = ""
        for word in words:
            candidate = f"{chunk} {word}".strip()
            if len(candidate) > max_chars and chunk:
                result.append(chunk)
                chunk = word
            else:
                chunk = candidate
        if chunk:
            result.append(chunk)
    return result


class SynthesizeParams(RpcModel):
    voice_id: str = Field(min_length=3)
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    rate: float = Field(default=1.0, ge=0.5, le=2.0)
    sentences: bool = False
    speaker_id: int | None = Field(default=None, ge=0)


class SynthesizeChunk(RpcModel):
    text: str
    start: int
    end: int
    wav_base64: str
    duration_ms: int


class SynthesizeResult(RpcModel):
    wav_base64: str = ""
    sample_rate: int = 0
    duration_ms: int = 0
    chunks: list[SynthesizeChunk] = Field(default_factory=list)


def _speaker_for(voice, speaker_id: int | None) -> int | None:
    speakers = int(getattr(voice.config, "num_speakers", 1) or 1)
    if speaker_id is None or speakers <= 1:
        return None
    if speaker_id >= speakers:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"speaker {speaker_id} is not in this voice",
            {"reason": "unknownSpeaker"},
        )
    return speaker_id


def _synthesize_wav(
    voice, text: str, rate: float, sample_rate: int, speaker_id: int | None = None
) -> tuple[str, int]:
    from piper import SynthesisConfig

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        voice.synthesize_wav(
            text,
            handle,
            syn_config=SynthesisConfig(speaker_id=speaker_id, length_scale=1.0 / rate),
        )
    data = buffer.getvalue()
    frames = max(0, (len(data) - 44) // 2)
    duration_ms = int(frames / sample_rate * 1000) if sample_rate else 0
    return base64.b64encode(data).decode("ascii"), duration_ms


@op("tts.synthesize", SynthesizeParams)
def synthesize(params: SynthesizeParams, progress: Progress) -> SynthesizeResult:
    if _valid_voice_id(params.voice_id):
        _ensure_voice_helper(
            _voice_paths(params.voice_id)[1], progress, params.voice_id, (0.0, 0.1)
        )
    voice = _load_voice(params.voice_id)
    sample_rate = int(voice.config.sample_rate)
    speaker_id = _speaker_for(voice, params.speaker_id)
    if params.sentences:
        sentences = split_sentences(params.text)
        normalized = re.sub(r"\s+", " ", params.text).strip()
        chunks: list[SynthesizeChunk] = []
        cursor = 0
        total = len(sentences) or 1
        for index, sentence in enumerate(sentences):
            progress.check_cancelled()
            offset = normalized.find(sentence, cursor)
            if offset == -1:
                offset = cursor
            start = offset
            end = offset + len(sentence)
            cursor = end
            wav_base64, duration_ms = _synthesize_wav(
                voice, sentence, params.rate, sample_rate, speaker_id
            )
            chunks.append(
                SynthesizeChunk(
                    text=sentence,
                    start=start,
                    end=end,
                    wav_base64=wav_base64,
                    duration_ms=duration_ms,
                )
            )
            progress.report((index + 1) / total, "progress.speaking")
        return SynthesizeResult(chunks=chunks)
    progress.report(0.2, "progress.speaking")
    wav_base64, duration_ms = _synthesize_wav(
        voice, params.text, params.rate, sample_rate, speaker_id
    )
    return SynthesizeResult(wav_base64=wav_base64, sample_rate=sample_rate, duration_ms=duration_ms)


def clear_voice_cache() -> None:
    with _loaded_lock:
        _loaded.clear()


def remove_all_voices() -> None:
    clear_voice_cache()
    shutil.rmtree(voices_dir(), ignore_errors=True)
