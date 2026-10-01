import hashlib
import io
import json
import threading
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from vivepdf.ops import translate
from vivepdf.ops.translate_catalog import CatalogEntry
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

ROOT = "translate-en_tr-1_5"
METADATA = {"from_code": "en", "to_code": "tr", "package_version": "1.5"}


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path / "data"))
    translate.clear_model_cache()
    return tmp_path / "data"


def _package(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def _valid_members(metadata: dict | None = None) -> dict[str, bytes]:
    return {
        f"{ROOT}/model/model.bin": b"weights",
        f"{ROOT}/model/shared_vocabulary.txt": b"vocab",
        f"{ROOT}/sentencepiece.model": b"tokenizer",
        f"{ROOT}/metadata.json": json.dumps(metadata or METADATA).encode(),
        f"{ROOT}/README.md": b"credits",
        f"{ROOT}/stanza/en/tokenize/ewt.pt": b"stanza",
    }


def _entry(payload: bytes, model_id: str = "en_tr") -> CatalogEntry:
    source, target = model_id.split("_")
    return CatalogEntry(
        model_id,
        source,
        target,
        "1.5",
        f"https://argos-net.com/v1/translate-{model_id}-1_5.argosmodel",
        1,
        len(payload),
        hashlib.sha256(payload).hexdigest(),
    )


def _serve(monkeypatch: pytest.MonkeyPatch, payload: bytes, entry: CatalogEntry) -> None:
    monkeypatch.setitem(translate.CATALOG_BY_ID, entry.id, entry)

    def fake_fetch(_entry: CatalogEntry, target: Path, _progress: Progress) -> None:
        target.write_bytes(payload)

    monkeypatch.setattr(translate, "_fetch_archive", fake_fetch)


def _install(data_dir: Path, *model_ids: str) -> None:
    for model_id in model_ids:
        folder = data_dir / "translate" / model_id
        (folder / "model").mkdir(parents=True)
        for name in translate.REQUIRED_FILES:
            (folder / name).write_bytes(b"x")


class _FakeTokenizer:
    def encode(self, text: str, out_type: type) -> list[str]:
        return text.split(" ")

    def decode(self, tokens: list[str]) -> str:
        return " ".join(tokens)


class _FakeTranslator:
    def __init__(self, tag: str, calls: list[str]) -> None:
        self.tag = tag
        self.calls = calls

    def translate_batch(self, batch, target_prefix=None, beam_size=1):  # noqa: ANN001, ANN201
        self.calls.append(self.tag)
        return [
            SimpleNamespace(hypotheses=[[f"{self.tag}({' '.join(tokens)})"]]) for tokens in batch
        ]


def _fake_models(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    def fake_load(model_id: str) -> translate._LoadedModel:
        return translate._LoadedModel(_FakeTranslator(model_id, calls), _FakeTokenizer(), None)

    monkeypatch.setattr(translate, "_load", fake_load)
    return calls


def test_models_lists_catalog_and_marks_installed(data_dir: Path) -> None:
    _install(data_dir, "en_tr")
    result = translate.models(translate.ModelsParams(), silent_progress())
    by_id = {item.id: item for item in result.models}
    assert by_id["en_tr"].installed is True
    assert by_id["tr_en"].installed is False
    assert len(result.models) == len(translate.CATALOG)
    assert result.directory == str(data_dir / "translate")


def test_catalog_pairs_every_language_with_english() -> None:
    assert all(translate.PIVOT in (entry.source, entry.target) for entry in translate.CATALOG)
    assert all(len(entry.sha256) == 64 for entry in translate.CATALOG)
    assert all(
        entry.url.startswith(("https://argos-net.com/", "https://github.com/"))
        for entry in translate.CATALOG
    )
    for entry in translate.CATALOG:
        translate._assert_trusted_url(entry.url)
        assert entry.size_bytes <= translate.MAX_DOWNLOAD_BYTES


def test_catalog_offers_every_language_in_both_directions() -> None:
    ids = set(translate.CATALOG_BY_ID)
    languages = {entry.source for entry in translate.CATALOG} - {translate.PIVOT}
    assert len(languages) > 40
    assert all({f"{code}_en", f"en_{code}"} <= ids for code in languages)
    assert len(ids) == 2 * len(languages)


def test_turkish_comes_from_the_project_opus_mt_release() -> None:
    for model_id in ("en_tr", "tr_en"):
        entry = translate.CATALOG_BY_ID[model_id]
        assert entry.version == "2.0"
        assert entry.url == (
            "https://github.com/mtvrkan/vivepdf-models/releases/download/"
            f"translate-tr-2026.09/translate-{model_id}-2_0.argosmodel"
        )


@pytest.mark.parametrize("language", ["ar", "ko", "lt", "ro"])
def test_languages_argos_serves_poorly_come_from_the_project_opus_release(language: str) -> None:
    for model_id in (f"en_{language}", f"{language}_en"):
        entry = translate.CATALOG_BY_ID[model_id]
        assert entry.version == "2.0"
        assert entry.url == (
            "https://github.com/mtvrkan/vivepdf-models/releases/download/"
            f"translate-opus-2026.09/translate-{model_id}-2_0.argosmodel"
        )


def test_japanese_stays_on_argos_where_it_scores_higher() -> None:
    assert translate.CATALOG_BY_ID["en_ja"].url.startswith("https://argos-net.com/")


def test_download_installs_only_model_files(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = _package(_valid_members())
    _serve(monkeypatch, payload, _entry(payload))
    result = translate.download(translate.ModelIdParams(id="en_tr"), silent_progress())
    folder = data_dir / "translate" / "en_tr"
    assert result.installed == ["en_tr"]
    assert (folder / "model" / "model.bin").read_bytes() == b"weights"
    assert (folder / "README.md").exists()
    assert not (folder / "stanza").exists()
    assert sorted(path.name for path in (data_dir / "translate").iterdir()) == ["en_tr"]


def test_download_rejects_unknown_model() -> None:
    with pytest.raises(OpError) as caught:
        translate.download(translate.ModelIdParams(id="xx_yy"), silent_progress())
    assert caught.value.data == {"reason": "unknownTranslationModel"}


def test_fetch_rejects_checksum_mismatch_and_cleans_up(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = _package(_valid_members())
    entry = _entry(payload)._replace(sha256="0" * 64)
    monkeypatch.setitem(translate.CATALOG_BY_ID, entry.id, entry)
    response = io.BytesIO(payload)
    response.headers = {"Content-Length": str(len(payload))}
    monkeypatch.setattr(translate._OPENER, "open", lambda _request, timeout: response)
    with pytest.raises(OpError) as caught:
        translate.download(translate.ModelIdParams(id="en_tr"), silent_progress())
    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data["reason"] == "translationChecksumMismatch"
    assert list((data_dir / "translate").iterdir()) == []


def test_download_honours_cancellation(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    payload = _package(_valid_members())
    entry = _entry(payload)
    monkeypatch.setitem(translate.CATALOG_BY_ID, entry.id, entry)
    response = io.BytesIO(payload)
    response.headers = {"Content-Length": str(len(payload))}
    monkeypatch.setattr(translate._OPENER, "open", lambda _request, timeout: response)
    cancelled = threading.Event()
    cancelled.set()
    with pytest.raises(OpError) as caught:
        translate.download(
            translate.ModelIdParams(id="en_tr"), Progress(lambda *_: None, cancelled)
        )
    assert caught.value.code == ErrorCode.CANCELLED
    assert list((data_dir / "translate").iterdir()) == []


@pytest.mark.parametrize(
    "extra",
    [
        {f"{ROOT}/model/../../../escaped.bin": b"evil"},
        {f"{ROOT}/C:/escaped.bin": b"evil"},
        {"other-root/model/model.bin": b"evil"},
    ],
)
def test_download_rejects_unsafe_archives(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch, extra: dict[str, bytes]
) -> None:
    payload = _package({**_valid_members(), **extra})
    _serve(monkeypatch, payload, _entry(payload))
    with pytest.raises(OpError) as caught:
        translate.download(translate.ModelIdParams(id="en_tr"), silent_progress())
    assert caught.value.data == {"reason": "translationPackageInvalid"}
    assert not any(data_dir.rglob("escaped.bin"))
    assert list((data_dir / "translate").iterdir()) == []


def test_download_rejects_package_expanding_past_cap(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(translate, "MAX_EXTRACTED_BYTES", 10)
    payload = _package(_valid_members())
    _serve(monkeypatch, payload, _entry(payload))
    with pytest.raises(OpError) as caught:
        translate.download(translate.ModelIdParams(id="en_tr"), silent_progress())
    assert caught.value.data == {"reason": "translationPackageInvalid"}
    assert list((data_dir / "translate").iterdir()) == []


def test_download_rejects_package_missing_model(monkeypatch: pytest.MonkeyPatch) -> None:
    members = _valid_members()
    del members[f"{ROOT}/model/model.bin"]
    payload = _package(members)
    _serve(monkeypatch, payload, _entry(payload))
    with pytest.raises(OpError) as caught:
        translate.download(translate.ModelIdParams(id="en_tr"), silent_progress())
    assert caught.value.data == {"reason": "translationPackageInvalid"}


def test_download_rejects_metadata_for_another_pair(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = _package(_valid_members({"from_code": "en", "to_code": "de"}))
    _serve(monkeypatch, payload, _entry(payload))
    with pytest.raises(OpError) as caught:
        translate.download(translate.ModelIdParams(id="en_tr"), silent_progress())
    assert caught.value.data == {"reason": "translationPackageInvalid"}


def test_remove_deletes_installed_model(data_dir: Path) -> None:
    _install(data_dir, "en_tr", "tr_en")
    result = translate.remove(translate.ModelIdParams(id="en_tr"), silent_progress())
    assert result.installed == ["tr_en"]
    assert not (data_dir / "translate" / "en_tr").exists()


@pytest.mark.parametrize("model_id", ["..\\..", "../..", "xx_yy"])
def test_remove_rejects_unknown_or_escaping_ids(data_dir: Path, model_id: str) -> None:
    (data_dir / "keep.txt").parent.mkdir(parents=True, exist_ok=True)
    (data_dir / "keep.txt").write_text("keep")
    with pytest.raises(OpError) as caught:
        translate.remove(translate.ModelIdParams(id=model_id), silent_progress())
    assert caught.value.data == {"reason": "unknownTranslationModel"}
    assert (data_dir / "keep.txt").exists()


def test_route_prefers_direct_then_english_pivot(data_dir: Path) -> None:
    _install(data_dir, "tr_en", "en_de")
    assert translate._route("tr", "en") == ["tr_en"]
    assert translate._route("tr", "de") == ["tr_en", "en_de"]


def test_route_reports_missing_models(data_dir: Path) -> None:
    _install(data_dir, "tr_en")
    with pytest.raises(OpError) as caught:
        translate._route("tr", "de")
    assert caught.value.code == ErrorCode.UNSUPPORTED
    assert caught.value.data["reason"] == "translationPairMissing"
    assert caught.value.data["missing"] == ["en_de"]
    with pytest.raises(OpError) as direct:
        translate._route("en", "tr")
    assert direct.value.data["missing"] == ["en_tr"]


def test_translate_text_keeps_paragraphs_and_joins_hyphenation(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install(data_dir, "en_tr")
    _fake_models(monkeypatch)
    result = translate.translate_text(
        translate.TranslateTextParams(
            text="The installa-\ntion works.\nIt is fast.\n\nSecond part.", source="en", target="tr"
        ),
        silent_progress(),
    )
    assert result.route == ["en_tr"]
    assert result.text == (
        "en_tr(The installation works.) en_tr(It is fast.)\n\nen_tr(Second part.)"
    )


def test_translate_text_chains_through_english(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install(data_dir, "tr_en", "en_de")
    calls = _fake_models(monkeypatch)
    result = translate.translate_text(
        translate.TranslateTextParams(text="Merhaba dünya.", source="tr", target="de"),
        silent_progress(),
    )
    assert result.route == ["tr_en", "en_de"]
    assert result.text == "en_de(tr_en(Merhaba dünya.))"
    assert calls == ["tr_en", "en_de"]


def test_translate_text_same_language_returns_text(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _fake_models(monkeypatch)
    result = translate.translate_text(
        translate.TranslateTextParams(text="Aynı  dil.", source="tr", target="tr"),
        silent_progress(),
    )
    assert result.text == "Aynı dil."
    assert result.route == []
    assert calls == []


def test_translate_text_honours_cancellation(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install(data_dir, "en_tr")
    _fake_models(monkeypatch)
    cancelled = threading.Event()
    cancelled.set()
    with pytest.raises(OpError) as caught:
        translate.translate_text(
            translate.TranslateTextParams(text="Hello.", source="en", target="tr"),
            Progress(lambda *_: None, cancelled),
        )
    assert caught.value.code == ErrorCode.CANCELLED


def test_translate_text_rejects_oversized_or_malformed_input() -> None:
    with pytest.raises(ValidationError):
        translate.TranslateTextParams(
            text="a" * (translate.MAX_TEXT_CHARS + 1), source="en", target="tr"
        )
    with pytest.raises(ValidationError):
        translate.TranslateTextParams(text="a", source="../en", target="tr")


def test_sentences_keep_ordinals_and_abbreviations_inside_the_sentence() -> None:
    assert translate.sentences("Osmanlı 15. yüzyılda büyüdü. Sonra vb. konular geldi.") == [
        "Osmanlı 15. yüzyılda büyüdü.",
        "Sonra vb. konular geldi.",
    ]
    assert translate.sentences("It hires staff, e.g. engineers. They stay.") == [
        "It hires staff, e.g. engineers.",
        "They stay.",
    ]


def test_sentences_stop_merging_at_the_length_cap() -> None:
    first = "a" * 300 + "."
    second = "b" * 150 + "."
    assert translate.sentences(f"{first} {second}") == [first, second]


def test_shouting_detection_needs_four_cased_capitals() -> None:
    assert translate.is_shouting("BÖLÜM 3: GENEL HÜKÜMLER")
    assert translate.is_shouting("NATO")
    assert not translate.is_shouting("PDF")
    assert not translate.is_shouting("Read the PDF MANUAL")
    assert not translate.is_shouting("你好世界。")


def test_sentence_case_follows_turkish_dotted_i() -> None:
    assert translate.sentence_case("İÇİNDEKİLER IŞIK", "tr") == "İçindekiler ışık"
    assert translate.sentence_case("TABLE OF CONTENTS", "en") == "Table of contents"
    assert translate.sentence_case("ISLAND", "tr") == "Island"


def test_translate_text_translates_capitals_in_sentence_case_and_restores_them(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install(data_dir, "tr_en", "en_tr")
    _fake_models(monkeypatch)
    to_english = translate.translate_text(
        translate.TranslateTextParams(
            text="İÇİNDEKİLER LİSTESİ. Normal cümle.", source="tr", target="en"
        ),
        silent_progress(),
    )
    assert to_english.text == "TR_EN(İÇINDEKILER LISTESI.) tr_en(Normal cümle.)"
    to_turkish = translate.translate_text(
        translate.TranslateTextParams(text="TERMS OF SALE", source="en", target="tr"),
        silent_progress(),
    )
    assert to_turkish.text == "EN_TR(TERMS OF SALE)"


def test_translate_batch_puts_the_source_prefix_before_every_sentence() -> None:
    calls: list[str] = []
    model = translate._LoadedModel(
        _FakeTranslator("tr_fr", calls), _FakeTokenizer(), None, ">>fra<<"
    )
    assert translate._translate_batch(model, ["Merhaba dünya.", "Nasılsın?"], "fr") == [
        "tr_fr(>>fra<< Merhaba dünya.)",
        "tr_fr(>>fra<< Nasılsın?)",
    ]


@pytest.mark.parametrize(
    ("metadata", "expected"),
    [
        ({"source_prefix": ">>ron<<"}, ">>ron<<"),
        ({"source_prefix": ""}, None),
        ({"source_prefix": [">>ron<<"]}, None),
        ({}, None),
    ],
)
def test_prefix_tokens_are_read_only_from_non_empty_strings(
    metadata: dict, expected: str | None
) -> None:
    assert translate._prefix_token(metadata, "source_prefix") == expected


def test_detokenize_drops_unknown_pieces() -> None:
    pieces = ["▁Sorumlu", "<unk>", "luk", "▁", "<unk>", "▁sınırı"]
    assert translate._detokenize(pieces, "tr") == "Sorumluluk sınırı"


def test_sentences_split_cjk_text_without_spaces() -> None:
    assert translate.sentences("你好。今天天气很好！") == ["你好。", "今天天气很好！"]
    long_text = "字" * 900
    assert [len(part) for part in translate.sentences(long_text)] == [400, 400, 100]


def test_untrusted_hosts_are_blocked() -> None:
    for url in ("http://argos-net.com/x", "https://example.com/x", "https://argos-net.com.evil/x"):
        with pytest.raises(OpError) as caught:
            translate._assert_trusted_url(url)
        assert caught.value.data["reason"] == "translationUntrustedHost"
    translate._assert_trusted_url("https://argos-net.com/v1/translate-en_tr-1_5.argosmodel")
    translate._assert_trusted_url(
        "https://release-assets.githubusercontent.com/github-production-release-asset/1/2"
    )
    for url in ("https://github.com.evil/x", "https://githubusercontent.com/x"):
        with pytest.raises(OpError):
            translate._assert_trusted_url(url)


def _package_file(tmp_path: Path, members: dict[str, bytes], name: str = "cy.argosmodel") -> Path:
    path = tmp_path / name
    path.write_bytes(_package(members))
    return path


def test_import_installs_a_package_under_its_metadata_pair(data_dir: Path, tmp_path: Path) -> None:
    metadata = {"from_code": "en", "to_code": "cy", "package_version": "1.8"}
    source = _package_file(tmp_path, _valid_members(metadata))
    result = translate.import_model(translate.ImportParams(path=str(source)), silent_progress())
    assert result.id == "en_cy"
    assert result.installed == ["en_cy"]
    assert source.exists()
    assert not (data_dir / "translate" / "en_cy" / "stanza").exists()
    listed = translate.models(translate.ModelsParams(), silent_progress()).models
    custom = [item for item in listed if item.origin == "custom"]
    assert [(item.id, item.version, item.installed) for item in custom] == [("en_cy", "1.8", True)]
    assert sorted(path.name for path in (data_dir / "translate").iterdir()) == ["en_cy"]


def test_import_refuses_an_installed_pair_and_keeps_it(data_dir: Path, tmp_path: Path) -> None:
    _install(data_dir, "en_tr")
    source = _package_file(tmp_path, _valid_members())
    with pytest.raises(OpError) as caught:
        translate.import_model(translate.ImportParams(path=str(source)), silent_progress())
    assert caught.value.data["reason"] == "translationModelExists"
    assert (data_dir / "translate" / "en_tr" / "model" / "model.bin").read_bytes() == b"x"
    assert sorted(path.name for path in (data_dir / "translate").iterdir()) == ["en_tr"]


@pytest.mark.parametrize(
    ("name", "members"),
    [
        ("model.zip", _valid_members()),
        (
            "bpe.argosmodel",
            {
                key: value
                for key, value in _valid_members().items()
                if not key.endswith("sentencepiece.model")
            },
        ),
        ("code.argosmodel", _valid_members({"from_code": "../x", "to_code": "tr"})),
        ("same.argosmodel", _valid_members({"from_code": "tr", "to_code": "tr"})),
        ("slip.argosmodel", {**_valid_members(), f"{ROOT}/../evil.txt": b"x"}),
    ],
)
def test_import_rejects_invalid_packages(
    data_dir: Path, tmp_path: Path, name: str, members: dict[str, bytes]
) -> None:
    source = _package_file(tmp_path, members, name)
    with pytest.raises(OpError) as caught:
        translate.import_model(translate.ImportParams(path=str(source)), silent_progress())
    assert caught.value.data["reason"] == "translationPackageInvalid"
    assert list(translate.models_dir().iterdir()) == []


def test_import_rejects_a_missing_file(tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        translate.import_model(
            translate.ImportParams(path=str(tmp_path / "none.argosmodel")), silent_progress()
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_an_imported_pair_joins_the_english_route(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install(data_dir, "nl_en", "en_tr")
    calls = _fake_models(monkeypatch)
    result = translate.translate_text(
        translate.TranslateTextParams(text="Hallo.", source="nl", target="tr"), silent_progress()
    )
    assert result.route == ["nl_en", "en_tr"]
    assert calls == ["nl_en", "en_tr"]


@pytest.mark.parametrize(
    ("pieces", "expected"),
    [
        (["▁orang", "▁-", "▁orang", "▁itu"], "orang-orang itu"),
        (["▁Anak", "▁-", "▁anak", "nya"], "Anak-anaknya"),
        (["▁ber", "lari", "▁-", "▁lari"], "berlari-lari"),
        (["▁buku", "-", "▁buku"], "buku-buku"),
        (["▁sayur", "▁-", "▁mayur"], "sayur - mayur"),
        (["▁tahun", "▁2019", "▁-", "▁2020"], "tahun 2019 - 2020"),
        (["▁Jakarta", "▁-", "▁Bandung"], "Jakarta - Bandung"),
    ],
)
def test_indonesian_reduplication_loses_the_spaces_around_its_hyphen(
    pieces: list[str], expected: str
) -> None:
    assert translate._detokenize(pieces, "id") == expected


def test_spaced_hyphens_stay_in_languages_without_reduplication() -> None:
    assert translate._detokenize(["▁orang", "▁-", "▁orang"], "en") == "orang - orang"
