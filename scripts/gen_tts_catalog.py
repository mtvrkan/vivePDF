import argparse
import json
import math
import subprocess
import sys
import urllib.request
from pathlib import Path

VOICES_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/{revision}/voices.json"
VOICES_REVISION = "v1.0.0"
EXTRA_REVISION = "c10ece1aade47bb51c153c893d14e5bf8e5b7117"
EXTRA_VOICES = ("he_IL-saspeech-medium",)
QUALITY_ORDER = {"x_low": 0, "low": 1, "medium": 2, "high": 3}
TARGET = Path(__file__).resolve().parent.parent / "sidecar" / "vivepdf" / "ops" / "tts_catalog.py"

HEADER = """from typing import NamedTuple


class CatalogEntry(NamedTuple):
    id: str
    language: str
    locale: str
    name: str
    quality: str
    size_mb: int
    checksum_md5: str
    config_md5: str
    speakers: int
    revision: str = "v1.0.0"


CATALOG: list[CatalogEntry] = [
"""

FOOTER = """]
CATALOG_BY_ID = {item.id: item for item in CATALOG}
"""


def load_voices(source: str | None, revision: str) -> dict:
    if source:
        return json.loads(Path(source).read_text(encoding="utf-8"))
    url = VOICES_URL.format(revision=revision)
    request = urllib.request.Request(url, headers={"User-Agent": "vivePDF"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


NAME_OVERRIDES = {
    "ljspeech": "LJ Speech",
    "carlfm": "CarlFM",
    "davefx": "DaveFX",
    "libritts_r": "LibriTTS-R",
    "saspeech": "SASPEECH",
}
WORD_OVERRIDES = {
    "hfc": "HFC",
    "mls": "MLS",
    "dfki": "DFKI",
    "vctk": "VCTK",
    "tts": "TTS",
    "upmc": "UPMC",
    "issai": "ISSAI",
    "arctic": "ARCTIC",
    "l2arctic": "L2-ARCTIC",
    "libritts": "LibriTTS",
}


def display_name(name: str) -> str:
    if name in NAME_OVERRIDES:
        return NAME_OVERRIDES[name]
    return " ".join(WORD_OVERRIDES.get(part, part.capitalize()) for part in name.split("_"))


def file_entry(voice: dict, suffix: str) -> dict:
    return next(value for path, value in voice["files"].items() if path.endswith(suffix))


def entries(voices: dict, extra: dict) -> list[tuple]:
    rows = [_row(key, voice) for key, voice in voices.items()]
    rows += [(*_row(key, extra[key]), EXTRA_REVISION) for key in EXTRA_VOICES if key not in voices]
    rows.sort(key=lambda row: (row[2], row[0].split("-")[1], QUALITY_ORDER.get(row[4], 9)))
    return rows


def _row(key: str, voice: dict) -> tuple:
    model = file_entry(voice, f"{key}.onnx")
    config = file_entry(voice, f"{key}.onnx.json")
    return (
        key,
        voice["language"]["family"],
        voice["language"]["code"],
        display_name(voice["name"]),
        voice["quality"],
        math.ceil(model["size_bytes"] / 1_000_000),
        model["md5_digest"],
        config["md5_digest"],
        int(voice.get("num_speakers") or 1),
    )


def render(rows: list[tuple]) -> str:
    body = "".join(
        "    CatalogEntry("
        + ", ".join(json.dumps(value, ensure_ascii=False) for value in row)
        + "),\n"
        for row in rows
    )
    return HEADER + body + FOOTER


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voices-json", default=None)
    parser.add_argument("--extra-voices-json", default=None)
    parser.add_argument("--output", default=str(TARGET))
    arguments = parser.parse_args()
    rows = entries(
        load_voices(arguments.voices_json, VOICES_REVISION),
        load_voices(arguments.extra_voices_json, EXTRA_REVISION),
    )
    output = Path(arguments.output)
    output.write_bytes(render(rows).encode("utf-8"))
    subprocess.run(
        ["uv", "run", "ruff", "format", str(output)],
        cwd=TARGET.parent.parent.parent,
        check=False,
        shell=False,
    )
    print(f"{len(rows)} voices written to {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
