import hashlib
import json
import os
import re
import shutil
import stat
import threading
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import OrderedDict
from pathlib import Path, PurePosixPath
from typing import NamedTuple

from pydantic import Field

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops.translate_catalog import CATALOG, CATALOG_BY_ID, CatalogEntry
from vivepdf.ops.tts import split_sentences
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

PIVOT = "en"
DOWNLOAD_TIMEOUT = 60
CHUNK = 1024 * 256
MAX_DOWNLOAD_BYTES = 400 * 1024 * 1024
MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024
MAX_TEXT_CHARS = 5000
BATCH_SENTENCES = 8
BEAM_SIZE = 2
UNSPACED_CHUNK = 400
UNSPACED_LANGUAGES = {"ja", "zh", "zt"}
REDUPLICATING_LANGUAGES = {"id", "ms"}
SPACED_HYPHEN = re.compile(r"\b([^\W\d_]+)(?: -|- | - )([^\W\d_]+)\b")
SHARED_STEM = 3
DOTTED_I_LANGUAGES = {"tr", "az"}
SHOUTING_MIN_LETTERS = 4
MERGED_SENTENCE_MAX = 400
UNKNOWN_PIECE = "<unk>"
PIECE_SPACE = "▁"
PAIR_ID_RE = re.compile(r"^[a-z]{2,3}_[a-z]{2,3}$")
LANGUAGE_RE = r"^[a-z]{2,3}$"
ALLOWED_HOSTS = {
    "argos-net.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}
MODEL_FILE = "model/model.bin"
TOKENIZER_FILE = "sentencepiece.model"
METADATA_FILE = "metadata.json"
REQUIRED_FILES = (MODEL_FILE, TOKENIZER_FILE, METADATA_FILE)
KEPT_FILES = {TOKENIZER_FILE, METADATA_FILE, "README.md"}
KEPT_FOLDER = "model"
PACKAGE_SUFFIX = ".argosmodel"


class _LoadedModel(NamedTuple):
    translator: object
    tokenizer: object
    target_prefix: str | None
    source_prefix: str | None = None


_LOADED_MAX = 2
_loaded_lock = threading.Lock()
_loaded: "OrderedDict[str, _LoadedModel]" = OrderedDict()


def models_dir() -> Path:
    directory = user_data_dir() / "translate"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _pair_id(source: str, target: str) -> str:
    return f"{source}_{target}"


def _is_installed(directory: Path) -> bool:
    return all((directory / name).is_file() for name in REQUIRED_FILES)


def installed_ids() -> list[str]:
    return sorted(
        path.name
        for path in models_dir().iterdir()
        if path.is_dir() and PAIR_ID_RE.match(path.name) and _is_installed(path)
    )


class TranslateModelInfo(RpcModel):
    id: str
    source: str
    target: str
    version: str
    size_mb: int
    installed: bool
    origin: str = "catalog"


class ModelsParams(RpcModel):
    pass


class ModelsResult(RpcModel):
    directory: str
    models: list[TranslateModelInfo]


@op("translate.models", ModelsParams)
def models(_params: ModelsParams, _progress: Progress) -> ModelsResult:
    installed = set(installed_ids())
    items = [
        TranslateModelInfo(
            id=entry.id,
            source=entry.source,
            target=entry.target,
            version=entry.version,
            size_mb=entry.size_mb,
            installed=entry.id in installed,
        )
        for entry in CATALOG
    ]
    items.extend(_custom_model(model_id) for model_id in sorted(installed - CATALOG_BY_ID.keys()))
    return ModelsResult(directory=str(models_dir()), models=items)


def _folder_bytes(directory: Path) -> int:
    return sum(path.stat().st_size for path in directory.rglob("*") if path.is_file())


def _custom_model(model_id: str) -> TranslateModelInfo:
    directory = models_dir() / model_id
    source, target = model_id.split("_")
    try:
        metadata = _read_metadata(directory, source, target)
    except OpError:
        metadata = {}
    return TranslateModelInfo(
        id=model_id,
        source=source,
        target=target,
        version=str(metadata.get("package_version") or ""),
        size_mb=max(1, round(_folder_bytes(directory) / (1024 * 1024))),
        installed=True,
        origin="custom",
    )


class ModelIdParams(RpcModel):
    id: str = Field(min_length=5, max_length=7)


class ModelChangedResult(RpcModel):
    id: str
    installed: list[str]


def _host_allowed(host: str | None) -> bool:
    return bool(host) and host.lower() in ALLOWED_HOSTS


def _assert_trusted_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not _host_allowed(parsed.hostname):
        raise OpError(
            ErrorCode.NETWORK,
            f"blocked untrusted host: {parsed.hostname}",
            {"url": url, "reason": "translationUntrustedHost"},
        )


class _AllowlistRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        _assert_trusted_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_AllowlistRedirectHandler)


def _too_large(url: str) -> OpError:
    return OpError(
        ErrorCode.NETWORK,
        "download exceeded size cap",
        {"url": url, "reason": "translationDownloadTooLarge"},
    )


def _fetch_archive(entry: CatalogEntry, target: Path, progress: Progress) -> None:
    _assert_trusted_url(entry.url)
    request = urllib.request.Request(entry.url, headers={"User-Agent": "vivePDF"})
    try:
        response = _OPENER.open(request, timeout=DOWNLOAD_TIMEOUT)
    except OpError:
        raise
    except (OSError, urllib.error.URLError) as error:
        raise OpError(ErrorCode.NETWORK, f"download failed: {error}", {"url": entry.url}) from error
    total = int(response.headers.get("Content-Length") or 0) or entry.size_bytes
    if total > MAX_DOWNLOAD_BYTES:
        response.close()
        raise _too_large(entry.url)
    done = 0
    digest = hashlib.sha256()
    with response, open(target, "wb") as handle:
        while True:
            progress.check_cancelled()
            chunk = response.read(CHUNK)
            if not chunk:
                break
            done += len(chunk)
            if done > MAX_DOWNLOAD_BYTES:
                raise _too_large(entry.url)
            handle.write(chunk)
            digest.update(chunk)
            progress.report(
                min(done / total, 1.0) if total else 0.0,
                "progress.downloading",
                {"label": entry.id, "done": done, "total": total},
            )
    if digest.hexdigest() != entry.sha256:
        raise OpError(
            ErrorCode.NETWORK,
            "checksum mismatch",
            {"url": entry.url, "reason": "translationChecksumMismatch"},
        )


def _package_invalid(message: str) -> OpError:
    return OpError(ErrorCode.UNSUPPORTED, message, {"reason": "translationPackageInvalid"})


def _kept_path(member: zipfile.ZipInfo, root: str) -> PurePosixPath | None:
    name = member.filename
    if not name.startswith(root + "/"):
        raise _package_invalid(f"unexpected archive entry: {name}")
    relative = PurePosixPath(name[len(root) + 1 :])
    if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name:
        raise _package_invalid(f"unsafe archive entry: {name}")
    if stat.S_ISLNK(member.external_attr >> 16):
        raise _package_invalid(f"symbolic link in archive: {name}")
    if member.is_dir() or not relative.parts:
        return None
    if str(relative) in KEPT_FILES or (
        len(relative.parts) == 2 and relative.parts[0] == KEPT_FOLDER
    ):
        return relative
    return None


def _archive_root(archive: zipfile.ZipFile) -> str:
    roots = {name.split("/", 1)[0] for name in archive.namelist() if name}
    if len(roots) != 1:
        raise _package_invalid("archive must hold a single package folder")
    return roots.pop()


def _copy_member(
    archive: zipfile.ZipFile, member: zipfile.ZipInfo, target: Path, budget: int
) -> int:
    written = 0
    with archive.open(member) as source, open(target, "wb") as handle:
        while chunk := source.read(CHUNK):
            written += len(chunk)
            if written > budget:
                raise _package_invalid("package expands beyond the size cap")
            handle.write(chunk)
    return written


def _load_metadata(directory: Path) -> dict:
    try:
        metadata = json.loads((directory / METADATA_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise _package_invalid(f"unreadable package metadata: {error}") from error
    if not isinstance(metadata, dict):
        raise _package_invalid("package metadata is not an object")
    return metadata


def _read_metadata(directory: Path, source: str, target: str) -> dict:
    metadata = _load_metadata(directory)
    if (metadata.get("from_code"), metadata.get("to_code")) != (source, target):
        raise _package_invalid("package metadata does not match the requested pair")
    return metadata


def _metadata_pair(directory: Path) -> tuple[str, str]:
    metadata = _load_metadata(directory)
    source, target = metadata.get("from_code"), metadata.get("to_code")
    for code in (source, target):
        if not isinstance(code, str) or not re.fullmatch(LANGUAGE_RE, code):
            raise _package_invalid(f"unsupported language code in package: {code!r}")
    if source == target:
        raise _package_invalid("package translates a language into itself")
    return source, target


def _extract(archive_path: Path, staging: Path, progress: Progress) -> None:
    staging.mkdir(parents=True)
    boundary = staging.resolve()
    remaining = MAX_EXTRACTED_BYTES
    try:
        archive = zipfile.ZipFile(archive_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise _package_invalid(f"not a zip archive: {error}") from error
    with archive:
        root = _archive_root(archive)
        for member in archive.infolist():
            progress.check_cancelled()
            relative = _kept_path(member, root)
            if relative is None:
                continue
            target = staging.joinpath(*relative.parts)
            if not target.resolve().is_relative_to(boundary):
                raise _package_invalid(f"archive entry escapes the model folder: {member.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            remaining -= _copy_member(archive, member, target, remaining)
    if not _is_installed(staging):
        raise _package_invalid("package is missing the model, tokenizer or metadata")


def _unknown_model(model_id: str) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        f"unknown translation model: {model_id}",
        {"reason": "unknownTranslationModel"},
    )


@op("translate.download", ModelIdParams)
def download(params: ModelIdParams, progress: Progress) -> ModelChangedResult:
    entry = CATALOG_BY_ID.get(params.id)
    if entry is None:
        raise _unknown_model(params.id)
    directory = models_dir()
    archive = directory / f".{entry.id}.argosmodel.part"
    staging = directory / f".{entry.id}.tmp"
    final = directory / entry.id
    shutil.rmtree(staging, ignore_errors=True)
    try:
        _fetch_archive(entry, archive, progress.within(0.0, 0.9))
        progress.report(0.9, "progress.installing", {"label": entry.id})
        _extract(archive, staging, progress)
        _read_metadata(staging, entry.source, entry.target)
        _install(staging, final)
    finally:
        archive.unlink(missing_ok=True)
        shutil.rmtree(staging, ignore_errors=True)
    progress.report(1.0, "progress.installing", {"label": entry.id})
    return ModelChangedResult(id=entry.id, installed=installed_ids())


def _install(staging: Path, final: Path) -> None:
    with _loaded_lock:
        _loaded.pop(final.name, None)
        shutil.rmtree(final, ignore_errors=True)
        staging.replace(final)


class ImportParams(RpcModel):
    path: str = Field(min_length=1)


@op("translate.import", ImportParams)
def import_model(params: ImportParams, progress: Progress) -> ModelChangedResult:
    source = Path(params.path)
    if not source.is_file() or source.suffix.lower() != PACKAGE_SUFFIX:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"not an Argos model package: {params.path}",
            {"path": params.path, "reason": "translationPackageInvalid"},
        )
    if source.stat().st_size > MAX_DOWNLOAD_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "model package too large",
            {
                "path": params.path,
                "reason": "translationPackageTooLarge",
                "limitMb": MAX_DOWNLOAD_BYTES // (1024 * 1024),
            },
        )
    directory = models_dir()
    staging = directory / f".import-{os.getpid()}-{threading.get_ident()}.tmp"
    shutil.rmtree(staging, ignore_errors=True)
    try:
        progress.report(0.0, "progress.installing", {"label": source.name})
        _extract(source, staging, progress)
        model_id = _pair_id(*_metadata_pair(staging))
        final = directory / model_id
        if _is_installed(final):
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"translation model already installed: {model_id}",
                {"id": model_id, "reason": "translationModelExists"},
            )
        _install(staging, final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    progress.report(1.0, "progress.installing", {"label": source.name})
    return ModelChangedResult(id=model_id, installed=installed_ids())


@op("translate.remove", ModelIdParams)
def remove(params: ModelIdParams, _progress: Progress) -> ModelChangedResult:
    if not PAIR_ID_RE.match(params.id):
        raise _unknown_model(params.id)
    if params.id not in CATALOG_BY_ID and params.id not in installed_ids():
        raise _unknown_model(params.id)
    root = models_dir().resolve()
    target = (root / params.id).resolve()
    if target.parent != root:
        raise OpError(ErrorCode.PERMISSION_DENIED, "invalid model path", {"reason": "invalidPath"})
    with _loaded_lock:
        _loaded.pop(params.id, None)
        shutil.rmtree(target, ignore_errors=True)
    return ModelChangedResult(id=params.id, installed=installed_ids())


def _prefix_token(metadata: dict, key: str) -> str | None:
    value = metadata.get(key)
    return value if isinstance(value, str) and value else None


def _load(model_id: str) -> _LoadedModel:
    with _loaded_lock:
        cached = _loaded.get(model_id)
        if cached is not None:
            _loaded.move_to_end(model_id)
            return cached
        directory = models_dir() / model_id
        source, target = model_id.split("_")
        if not _is_installed(directory):
            raise _pair_missing(source, target, [model_id])
        metadata = _read_metadata(directory, source, target)
        target_prefix = _prefix_token(metadata, "target_prefix")
        source_prefix = _prefix_token(metadata, "source_prefix")
        import ctranslate2
        import sentencepiece

        try:
            translator = ctranslate2.Translator(
                str(directory / "model"),
                device="cpu",
                compute_type="int8",
                intra_threads=min(4, os.cpu_count() or 1),
            )
            tokenizer = sentencepiece.SentencePieceProcessor(
                model_file=str(directory / TOKENIZER_FILE)
            )
        except (RuntimeError, OSError, ValueError) as error:
            raise _package_invalid(f"model could not be loaded: {error}") from error
        loaded = _LoadedModel(translator, tokenizer, target_prefix, source_prefix)
        _loaded[model_id] = loaded
        while len(_loaded) > _LOADED_MAX:
            _loaded.popitem(last=False)
        return loaded


def _pair_missing(source: str, target: str, missing: list[str]) -> OpError:
    return OpError(
        ErrorCode.UNSUPPORTED,
        f"no translation model for {source} -> {target}",
        {
            "reason": "translationPairMissing",
            "source": source,
            "target": target,
            "missing": missing,
        },
    )


def _route(source: str, target: str) -> list[str]:
    installed = set(installed_ids())
    direct = _pair_id(source, target)
    if direct in installed:
        return [direct]
    if PIVOT in (source, target):
        raise _pair_missing(source, target, [direct])
    hops = [_pair_id(source, PIVOT), _pair_id(PIVOT, target)]
    missing = [hop for hop in hops if hop not in installed]
    if missing:
        raise _pair_missing(source, target, [direct] if direct in CATALOG_BY_ID else missing)
    return hops


def paragraphs(text: str) -> list[str]:
    joined = re.sub(r"(\w)-[ \t]*\r?\n[ \t]*(\w)", r"\1\2", text)
    blocks = re.split(r"\r?\n[ \t]*\r?\n", joined)
    return [re.sub(r"\s+", " ", block).strip() for block in blocks if block.strip()]


def _continues(previous: str, sentence: str) -> bool:
    return sentence[:1].islower() and len(previous) + 1 + len(sentence) <= MERGED_SENTENCE_MAX


def _merged(sentences_in_piece: list[str]) -> list[str]:
    merged: list[str] = []
    for sentence in sentences_in_piece:
        if merged and _continues(merged[-1], sentence):
            merged[-1] = f"{merged[-1]} {sentence}"
        else:
            merged.append(sentence)
    return merged


def sentences(block: str) -> list[str]:
    result: list[str] = []
    for piece in re.split(r"(?<=[。！？；])", block):
        for sentence in _merged(split_sentences(piece)):
            result.extend(
                sentence[start : start + UNSPACED_CHUNK]
                for start in range(0, len(sentence), UNSPACED_CHUNK)
            )
    return result


def _lower(text: str, language: str) -> str:
    if language in DOTTED_I_LANGUAGES:
        text = text.replace("I", "ı").replace("İ", "i")
    return text.lower()


def _upper(text: str, language: str) -> str:
    if language in DOTTED_I_LANGUAGES:
        text = text.replace("i", "İ")
    return text.upper()


def is_shouting(sentence: str) -> bool:
    cased = [char for char in sentence if char.isupper() or char.islower()]
    return len(cased) >= SHOUTING_MIN_LETTERS and all(char.isupper() for char in cased)


def sentence_case(sentence: str, language: str) -> str:
    lowered = _lower(sentence, language)
    return _upper(lowered[:1], language) + lowered[1:]


def _join(parts: list[str], language: str) -> str:
    return ("" if language in UNSPACED_LANGUAGES else " ").join(parts)


def _detokenize(pieces: list[str], language: str) -> str:
    text = "".join(piece for piece in pieces if piece != UNKNOWN_PIECE)
    text = re.sub(r" {2,}", " ", text.replace(PIECE_SPACE, " ")).strip()
    if language in UNSPACED_LANGUAGES:
        text = re.sub(r"(?<=[^\x00-\x7f])\s+|\s+(?=[^\x00-\x7f])", "", text)
    if language in REDUPLICATING_LANGUAGES:
        text = SPACED_HYPHEN.sub(_joined_reduplication, text)
    return text


def _joined_reduplication(found: re.Match[str]) -> str:
    left, right = found.group(1), found.group(2)
    folded_left, folded_right = left.casefold(), right.casefold()
    shared = min(len(left), len(right)) >= SHARED_STEM and (
        folded_left[:SHARED_STEM] == folded_right[:SHARED_STEM]
    )
    repeated = len(folded_right) >= SHARED_STEM and folded_left.endswith(folded_right)
    if folded_left == folded_right or shared or repeated:
        return f"{left}-{right}"
    return found.group(0)


def _translate_batch(model: _LoadedModel, sentences: list[str], language: str) -> list[str]:
    lead = [model.source_prefix] if model.source_prefix else []
    tokens = [lead + model.tokenizer.encode(sentence, out_type=str) for sentence in sentences]
    prefix = [[model.target_prefix]] * len(tokens) if model.target_prefix else None
    results = model.translator.translate_batch(tokens, target_prefix=prefix, beam_size=BEAM_SIZE)
    output = []
    for result in results:
        hypothesis = list(result.hypotheses[0])
        if model.target_prefix and hypothesis[:1] == [model.target_prefix]:
            hypothesis = hypothesis[1:]
        output.append(_detokenize(hypothesis, language))
    return output


class TranslateTextParams(RpcModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    source: str = Field(pattern=LANGUAGE_RE)
    target: str = Field(pattern=LANGUAGE_RE)


class TranslateTextResult(RpcModel):
    text: str
    source: str
    target: str
    route: list[str]


@op("translate.text", TranslateTextParams)
def translate_text(params: TranslateTextParams, progress: Progress) -> TranslateTextResult:
    blocks = [sentences(block) for block in paragraphs(params.text)]
    if params.source == params.target or not blocks:
        return TranslateTextResult(
            text="\n\n".join(_join(block, params.source) for block in blocks),
            source=params.source,
            target=params.target,
            route=[],
        )
    route = _route(params.source, params.target)
    loaded = [_load(model_id) for model_id in route]
    shouting = [[is_shouting(sentence) for sentence in block] for block in blocks]
    blocks = [
        [
            sentence_case(sentence, params.source) if loud else sentence
            for sentence, loud in zip(block, flags, strict=True)
        ]
        for block, flags in zip(blocks, shouting, strict=True)
    ]
    total = sum(len(block) for block in blocks) * len(loaded) or 1
    done = 0
    for model_id, model in zip(route, loaded, strict=True):
        language = model_id.split("_")[1]
        translated_blocks = []
        for block in blocks:
            translated: list[str] = []
            for start in range(0, len(block), BATCH_SENTENCES):
                progress.check_cancelled()
                batch = block[start : start + BATCH_SENTENCES]
                translated.extend(_translate_batch(model, batch, language))
                done += len(batch)
                progress.report(done / total, "progress.translating")
            translated_blocks.append(translated)
        blocks = translated_blocks
    blocks = [
        [
            _upper(sentence, params.target) if loud else sentence
            for sentence, loud in zip(block, flags, strict=True)
        ]
        for block, flags in zip(blocks, shouting, strict=True)
    ]
    return TranslateTextResult(
        text="\n\n".join(_join(block, params.target) for block in blocks),
        source=params.source,
        target=params.target,
        route=route,
    )


def clear_model_cache() -> None:
    with _loaded_lock:
        _loaded.clear()
