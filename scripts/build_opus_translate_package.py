import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

import ctranslate2
from ctranslate2.converters import MarianConverter

PACKAGE_VERSION = "2.0"
ZIP_TIMESTAMP = (2022, 3, 17, 0, 0, 0)
TATOEBA = "https://object.pouta.csc.fi/Tatoeba-MT-models"
NAMES = {
    "ar": "Arabic",
    "ca": "Catalan",
    "cs": "Czech",
    "da": "Danish",
    "de": "German",
    "en": "English",
    "es": "Spanish",
    "fi": "Finnish",
    "fr": "French",
    "gl": "Galician",
    "hu": "Hungarian",
    "id": "Indonesian",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "lt": "Lithuanian",
    "pl": "Polish",
    "pt": "Portuguese",
    "ro": "Romanian",
    "tr": "Turkish",
    "uk": "Ukrainian",
}
TARGET_LABELS = {
    "ca": "cat",
    "es": "spa",
    "fr": "fra",
    "gl": "glg",
    "it": "ita",
    "pt": "por",
    "ro": "ron",
}


@dataclass(frozen=True)
class Release:
    directory: str
    name: str
    sha256: str
    card: str

    @property
    def url(self) -> str:
        return f"{TATOEBA}/{self.directory}/{self.name}.zip".replace("+", "%2B")

    @property
    def family(self) -> str:
        return "OPUS-MT tc-big" if "transformer-big" in self.name else "OPUS-MT"


ENG_TUR = Release(
    "eng-tur",
    "opusTCv20210807+bt_transformer-big_2022-02-25",
    "cfa3273c4077870dcaafc97f244f740cc58d7bf5501b83be98b4d91cd1a7d1cb",
    "https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-tr",
)
TUR_ENG = Release(
    "tur-eng",
    "opusTCv20210807+bt_transformer-big_2022-03-17",
    "59a0280099e09d0f32f18688c07ac5a5fc679e3a09bc843facb29f7b63aa9af3",
    "https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-tr-en",
)
DEU_TUR = Release(
    "deu-tur",
    "opusTCv20210807_transformer-big_2022-06-27",
    "9105f299da80ac60fc60598df05cd8d5d137f6989ad6b66ac7085dc0ad3da981",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/deu-tur",
)
TUR_DEU = Release(
    "tur-deu",
    "opusTCv20210807_transformer-big_2022-06-23",
    "0cd82322f4c4962af15456059dd9e813a71233266f7571f70e463a51a416ccb3",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/tur-deu",
)
ITC_TUR = Release(
    "itc-tur",
    "opusTCv20210807_transformer-big_2022-07-28",
    "4dc0e00ed63d60a5982a5e22f7c21163de9d8095a3f47a79d575a67a9ad016f0",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/itc-tur",
)
TUR_ITC = Release(
    "tur-itc",
    "opusTCv20210807_transformer-big_2022-08-23",
    "5d6cf0b3719e84d594ebb81234cb7cf14ac0ff56fee68bd4b02b95d46c531f60",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/tur-itc",
)
ENG_LIT = Release(
    "eng-lit",
    "opusTCv20210807+bt_transformer-big_2022-02-25",
    "a9e87f9f9ba6a68cbb13bafe220086075a50262b23ec927828eec59e4ae1f5c7",
    "https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-lt",
)
LIT_ENG = Release(
    "lit-eng",
    "opusTCv20210807+bt_transformer-big_2022-02-25",
    "9feaf7e951967b9347c6c6cfe41b73a0198d48e9c1979b55d828de7b772e7006",
    "https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-lt-en",
)
ENG_RON = Release(
    "eng-ron",
    "opusTCv20210807+bt_transformer-big_2022-02-25",
    "aa3a05a7dbb08607a11b240b0462fe9a40b8c3fa0066023281affd12bf0943e8",
    "https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ro",
)
ROA_ENG = Release(
    "roa-eng",
    "opusTCv20230926max50+bt+jhubc_transformer-big_2024-08-17",
    "4278d8688812e5f8eada1404c1496a96217a77bf7f4de06b763590fa443edf0c",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/roa-eng",
)
ENG_ARA = Release(
    "eng-ara",
    "opusTCv20210807+bt_transformer-big_2022-02-25",
    "e8733833b816f9ac5bc7c13b196b0683fc42ae392bddf26d6d574e179662a1e5",
    "https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ar",
)
ARA_ENG = Release(
    "ara-eng",
    "opusTCv20210807+bt_transformer-big_2022-03-09",
    "b2440a530982ada0823cd4718d6be2b8669a38db348f11bc289ac4af6d30f0e2",
    "https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-ar-en",
)
ENG_KOR = Release(
    "eng-kor",
    "opusTCv20210807-sepvoc_transformer-big_2022-07-28",
    "41f771fa28e864428dd7589992867b2b6dfa402f1191670e818e019dddfceef7",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-kor",
)
KOR_ENG = Release(
    "kor-eng",
    "opusTCv20210807-sepvoc_transformer-big_2022-07-28",
    "9132ed606b6964656520931d96a4a6afc7ddc7d55ca5438e1d403db0c05492ef",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/kor-eng",
)
ENG_JPN = Release(
    "eng-jpn",
    "opus+bt-2021-04-10",
    "469b1ff7ba84b74dfb11781e6930f9b3a8146d021a53cb7789bf5a9cc63f8a3f",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-jpn",
)
JPN_ENG = Release(
    "jpn-eng",
    "opus-2021-02-18",
    "350c6261b826f7460f63873ae4de6c97791ae21374fb7ce1f3f714016657145d",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/jpn-eng",
)
ENG_CES = Release(
    "eng-ces+slk",
    "opusTCv20210807+bt_transformer-big_2022-03-13",
    "0ba5793f706d52711e15f7c4007535619dfe001e1921cfc8f4943ff244668e9b",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-ces+slk",
)
CES_ENG = Release(
    "ces+slk-eng",
    "opusTCv20210807+bt_transformer-big_2022-03-17",
    "08f695aab7fc750c79b0f8c654db59bbe02d2dbdb44b1ef676e1cc13c4f3919d",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/ces+slk-eng",
)
ENG_GMQ = Release(
    "eng-gmq",
    "opusTCv20210807+bt_transformer-big_2022-03-17",
    "1151a50df1c5df610b832622a23be8d8bc2f734d95e803d7ddaf28355012f440",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-gmq",
)
GMQ_ENG = Release(
    "gmq-eng",
    "opusTCv20230926max50+bt+jhubc_transformer-big_2024-08-17",
    "06138143b765c04dd4d198ab2f8af377998abdcda817c21373897e53d56f08ea",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/gmq-eng",
)
ENG_FIN = Release(
    "eng-fin",
    "opusTCv20210807+news+bt_transformer-big_2023-04-13",
    "8ed155195e88dd353ddfb28ee3de324a685f04cf91880b4e995521fd490897c7",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-fin",
)
FIN_ENG = Release(
    "fin-eng",
    "opusTCv20210807+news+bt_transformer-big_2023-04-13",
    "fdae5c1e03e7768c4e01aad00332bb3a77d6a091ea1f24e219b5b686aaa608de",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/fin-eng",
)
ENG_HUN = Release(
    "eng-hun",
    "opusTCv20210807+bt_transformer-big_2022-02-25",
    "d39df4bdcfce4914103e4f41fb3672c8c854f0edd0d319c92bc929c955686462",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-hun",
)
HUN_ENG = Release(
    "hun-eng",
    "opusTCv20210807+bt_transformer-big_2022-03-09",
    "6c2795566c51b20bd11ca549a2f8d5b139c422e6596f9a5d134bba64245341ac",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/hun-eng",
)
ENG_MSA = Release(
    "eng-msa",
    "opus+bt-2021-04-16",
    "3f0f626a5fa676276d81abba168b42851efe9ed122d627e9f0a318d1ab40fe13",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-msa",
)
POZ_ENG = Release(
    "poz-eng",
    "opusTCv20230926max50+bt+jhubc_transformer-big_2024-08-17",
    "f276026c14127b62b0d37b96af7ca16c956e225a58505fd78282e8371ca3f7a9",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/poz-eng",
)
ENG_POL = Release(
    "eng-pol",
    "opus+bt-2021-04-14",
    "3b7b6311e0c0de40546f62b52baa8f64ac3384c4d3f25f7b5dc8c60a4d37dc99",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-pol",
)
POL_ENG = Release(
    "pol-eng",
    "opusTCv20210807+bt_transformer-big_2022-03-11",
    "a5dd7e044dd7286ccf7b3c0950358b4568469d377da40412b73036c36580e48b",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/pol-eng",
)
ENG_ZLE = Release(
    "eng-zle",
    "opusTCv20210807+bt_transformer-big_2022-03-13",
    "10cb109270a1c96c7a43434f3ebc6d7eac73401d1ef204136e3ea5b198435679",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-zle",
)
ZLE_ENG = Release(
    "zle-eng",
    "opusTCv20210807+bt_transformer-big_2022-03-17",
    "fdbb033dacabfb410887ba667c0727f1ddcf5d7f6c23fd5f22cecd1ff2123f3e",
    "https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/zle-eng",
)
MODELS = {
    "en_tr": ENG_TUR,
    "tr_en": TUR_ENG,
    "de_tr": DEU_TUR,
    "tr_de": TUR_DEU,
    **{f"{code}_tr": ITC_TUR for code in TARGET_LABELS},
    **{f"tr_{code}": TUR_ITC for code in TARGET_LABELS},
    "en_lt": ENG_LIT,
    "lt_en": LIT_ENG,
    "en_ro": ENG_RON,
    "ro_en": ROA_ENG,
    "en_ar": ENG_ARA,
    "ar_en": ARA_ENG,
    "en_ko": ENG_KOR,
    "ko_en": KOR_ENG,
    "en_ja": ENG_JPN,
    "ja_en": JPN_ENG,
    "en_cs": ENG_CES,
    "cs_en": CES_ENG,
    "en_da": ENG_GMQ,
    "da_en": GMQ_ENG,
    "en_fi": ENG_FIN,
    "fi_en": FIN_ENG,
    "en_hu": ENG_HUN,
    "hu_en": HUN_ENG,
    "en_id": ENG_MSA,
    "id_en": POZ_ENG,
    "en_pl": ENG_POL,
    "pl_en": POL_ENG,
    "en_uk": ENG_ZLE,
    "uk_en": ZLE_ENG,
}
SOURCE_PREFIXES = {
    **{f"tr_{code}": f">>{label}<<" for code, label in TARGET_LABELS.items()},
    "en_ro": ">>ron<<",
    "en_ar": ">>ara<<",
    "en_cs": ">>ces<<",
    "en_da": ">>dan<<",
    "en_id": ">>ind<<",
    "en_uk": ">>ukr<<",
}
README = """# {source_name} to {target_name} ({family}, CTranslate2 int8)

This package holds the Helsinki-NLP OPUS-MT model `{release}`
({card}), converted to CTranslate2 with int8 weights and packed in the
Argos Translate package layout so that vivePDF can use it offline.

Original model: {url}

Licence: Creative Commons Attribution 4.0 International (CC-BY-4.0), see LICENSE.
The weights were converted to another numeric format; nothing else was changed.

Please cite:
- Jörg Tiedemann and Santhosh Thottingal. 2020. OPUS-MT: Building open translation
  services for the World. EAMT 2020.
- Jörg Tiedemann. 2020. The Tatoeba Translation Challenge: Realistic Data Sets for Low
  Resource and Multilingual MT. WMT 2020.
"""


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(release: Release, cache: Path) -> Path:
    target = cache / f"{release.directory}_{release.name}.zip"
    if not target.exists():
        partial = target.with_suffix(".part")
        request = urllib.request.Request(release.url, headers={"User-Agent": "vivePDF"})
        with urllib.request.urlopen(request, timeout=120) as response, open(partial, "wb") as out:
            shutil.copyfileobj(response, out, 1024 * 1024)
        partial.replace(target)
    if sha256_of(target) != release.sha256:
        raise SystemExit(f"checksum mismatch for {target.name}")
    return target


def metadata(pair: str, release: Release) -> dict:
    source, target = pair.split("_")
    data = {
        "package_version": PACKAGE_VERSION,
        "argos_version": "1.9",
        "from_code": source,
        "from_name": NAMES[source],
        "to_code": target,
        "to_name": NAMES[target],
        "type": "translate",
        "license": "CC-BY-4.0",
        "description": (
            f"{release.family} {release.name}, CTranslate2 {ctranslate2.__version__} int8"
        ),
    }
    if pair in SOURCE_PREFIXES:
        data["source_prefix"] = SOURCE_PREFIXES[pair]
    return data


def add(archive: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, data, compresslevel=6)


def yaml_vocab(plain: Path) -> Path:
    lines = plain.read_text(encoding="utf-8").removesuffix("\n").split("\n")
    escaped = (line.replace("\\", "\\\\").replace('"', '\\"') for line in lines)
    target = plain.with_suffix(".vocab.yml")
    target.write_text(
        "".join(f'"{token}": {index}\n' for index, token in enumerate(escaped)), encoding="utf-8"
    )
    return target


def extract(source_zip: Path, work: Path) -> tuple[Path, list[Path]]:
    with zipfile.ZipFile(source_zip) as archive:
        names = archive.namelist()
        model = next(n for n in names if n.endswith(".best-perplexity.npz"))
        shared = [n for n in names if n.endswith(".vocab.yml")]
        separate = [n for n in names if n.endswith((".src.vocab", ".trg.vocab"))]
        for member in (model, *shared, *separate, "source.spm", "LICENSE"):
            archive.extract(member, work)
    if shared:
        return work / model, [work / shared[0]] * 2
    source = next(n for n in separate if n.endswith(".src.vocab"))
    target = next(n for n in separate if n.endswith(".trg.vocab"))
    return work / model, [yaml_vocab(work / source), yaml_vocab(work / target)]


def convert(release: Release, cache: Path, destination: Path) -> Path:
    converted = destination / "model"
    if not (converted / "model.bin").exists():
        work = destination / "source"
        model, vocabularies = extract(fetch(release, cache), work)
        MarianConverter(str(model), [str(path) for path in vocabularies]).convert(
            str(converted), quantization="int8"
        )
        for name in ("source.spm", "LICENSE"):
            shutil.copy(work / name, destination / name)
        shutil.rmtree(work)
    return destination


def build(pair: str, cache: Path, output: Path, scratch: Path) -> Path:
    release = MODELS[pair]
    converted = convert(release, cache, scratch / f"{release.directory}_{release.name}")
    root = f"translate-{pair}-{PACKAGE_VERSION.replace('.', '_')}"
    source_name, target_name = (NAMES[code] for code in pair.split("_"))
    files = {
        "LICENSE": (converted / "LICENSE").read_bytes(),
        "README.md": README.format(
            source_name=source_name,
            target_name=target_name,
            family=release.family,
            release=release.name,
            card=release.card,
            url=release.url.replace("%2B", "+"),
        ).encode("utf-8"),
        "metadata.json": (json.dumps(metadata(pair, release), indent=2) + "\n").encode(),
        "sentencepiece.model": (converted / "source.spm").read_bytes(),
    }
    files.update(
        {
            f"model/{path.name}": path.read_bytes()
            for path in sorted((converted / "model").iterdir())
        }
    )
    package = output / f"{root}.argosmodel"
    with zipfile.ZipFile(package, "w") as archive:
        for name in sorted(files):
            add(archive, f"{root}/{name}", files[name])
    print(f"{package.name} {package.stat().st_size} bytes sha256 {sha256_of(package)}")
    return package


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("pairs", nargs="*", default=sorted(MODELS))
    arguments = parser.parse_args()
    cache, output = Path(arguments.cache), Path(arguments.output)
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        for pair in arguments.pairs:
            build(pair, cache, output, Path(scratch))
    return 0


if __name__ == "__main__":
    sys.exit(main())
