import argparse
import hashlib
import json
import math
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

INDEX_COMMIT = "ff90de60728f7c1338ff6b75974e4c89b2442d22"
INDEX_URL = (
    f"https://raw.githubusercontent.com/argosopentech/argospm-index/{INDEX_COMMIT}/index.json"
)
PIVOT = "en"
MODELS_RELEASES = "https://github.com/mtvrkan/vivepdf-models/releases/download"
TURKISH_RELEASE = f"{MODELS_RELEASES}/translate-tr-2026.09"
OPUS_RELEASE = f"{MODELS_RELEASES}/translate-opus-2026.09"
OPUS_LANGUAGES = ("ar", "cs", "da", "fi", "hu", "id", "ko", "lt", "pl", "ro", "uk")
OPUS_PAIRS = tuple(
    pair for code in OPUS_LANGUAGES for pair in (f"{code}_{PIVOT}", f"{PIVOT}_{code}")
)
PACKAGE_OVERRIDES = {
    "en_tr": ("2.0", f"{TURKISH_RELEASE}/translate-en_tr-2_0.argosmodel"),
    "tr_en": ("2.0", f"{TURKISH_RELEASE}/translate-tr_en-2_0.argosmodel"),
    **{pair: ("2.0", f"{OPUS_RELEASE}/translate-{pair}-2_0.argosmodel") for pair in OPUS_PAIRS},
}
REQUIRED_MEMBERS = ("model/model.bin", "sentencepiece.model", "metadata.json")
VERSION_OVERRIDES = {
    "es_en": "1.0",
}
TARGET = (
    Path(__file__).resolve().parent.parent / "sidecar" / "vivepdf" / "ops" / "translate_catalog.py"
)

HEADER = """from typing import NamedTuple


class CatalogEntry(NamedTuple):
    id: str
    source: str
    target: str
    version: str
    url: str
    size_mb: int
    size_bytes: int
    sha256: str


CATALOG: list[CatalogEntry] = [
"""

FOOTER = """]
CATALOG_BY_ID = {item.id: item for item in CATALOG}
"""


def load_index(source: str | None) -> list[dict]:
    if source:
        return json.loads(Path(source).read_text(encoding="utf-8"))
    request = urllib.request.Request(INDEX_URL, headers={"User-Agent": "vivePDF"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def is_translation(entry: dict) -> bool:
    return entry.get("type", "translate") == "translate"


def paired_languages(index: list[dict]) -> set[str]:
    into = {
        entry["from_code"] for entry in index if is_translation(entry) and entry["to_code"] == PIVOT
    }
    out = {
        entry["to_code"] for entry in index if is_translation(entry) and entry["from_code"] == PIVOT
    }
    return into & out


def wanted(entry: dict, languages: set[str]) -> bool:
    if not is_translation(entry):
        return False
    pair = (entry["from_code"], entry["to_code"])
    return (pair[0] == PIVOT and pair[1] in languages) or (
        pair[1] == PIVOT and pair[0] in languages
    )


def pinned(entry: dict) -> dict:
    pair = f"{entry['from_code']}_{entry['to_code']}"
    if pair in PACKAGE_OVERRIDES:
        version, link = PACKAGE_OVERRIDES[pair]
        return {**entry, "package_version": version, "links": [link]}
    version = VERSION_OVERRIDES.get(pair)
    if version is None:
        return entry
    stem = f"translate-{entry['from_code']}_{entry['to_code']}-{version.replace('.', '_')}"
    return {
        **entry,
        "package_version": version,
        "links": [f"https://argos-net.com/v1/{stem}.argosmodel"],
    }


def https_link(entry: dict) -> str:
    return next(link for link in entry["links"] if link.startswith("https://"))


def fetch(url: str, cache: Path) -> Path:
    target = cache / url.rsplit("/", 1)[-1]
    if target.exists():
        return target
    partial = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "vivePDF"})
    with urllib.request.urlopen(request, timeout=120) as response, open(partial, "wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)
    partial.replace(target)
    return target


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def package_problem(path: Path) -> str | None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
    roots = {name.split("/", 1)[0] for name in names}
    if len(roots) != 1:
        return f"{path.name}: expected one top-level folder, found {sorted(roots)}"
    root = roots.pop()
    missing = [member for member in REQUIRED_MEMBERS if f"{root}/{member}" not in names]
    return f"{path.name}: missing {missing}" if missing else None


def rows(index: list[dict], cache: Path) -> list[tuple]:
    result = []
    problems = []
    languages = paired_languages(index)
    selected = sorted(
        (pinned(entry) for entry in index if wanted(entry, languages)),
        key=lambda item: (item["from_code"], item["to_code"]),
    )
    for entry in selected:
        url = https_link(entry)
        archive = fetch(url, cache)
        if problem := package_problem(archive):
            problems.append(problem)
            print(problem, flush=True)
            continue
        size = archive.stat().st_size
        result.append(
            (
                f"{entry['from_code']}_{entry['to_code']}",
                entry["from_code"],
                entry["to_code"],
                str(entry["package_version"]),
                url,
                math.ceil(size / 1_000_000),
                size,
                sha256_of(archive),
            )
        )
        print(f"{result[-1][0]} {size} bytes", flush=True)
    if problems:
        raise SystemExit("unsupported packages:\n" + "\n".join(problems))
    return result


def render(items: list[tuple]) -> str:
    body = "".join(
        "    CatalogEntry(" + ", ".join(json.dumps(value) for value in row) + "),\n"
        for row in items
    )
    return HEADER + body + FOOTER


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index-json", default=None)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--output", default=str(TARGET))
    arguments = parser.parse_args()
    cache = Path(arguments.cache)
    cache.mkdir(parents=True, exist_ok=True)
    items = rows(load_index(arguments.index_json), cache)
    output = Path(arguments.output)
    output.write_bytes(render(items).encode("utf-8"))
    subprocess.run(
        ["uv", "run", "ruff", "format", str(output)],
        cwd=TARGET.parent.parent.parent,
        check=False,
        shell=False,
    )
    print(f"{len(items)} packages written to {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
