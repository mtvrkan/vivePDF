import argparse
import hashlib
import io
import subprocess
import sys
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

COMMIT = "b5efa9c32e8f9b63005f5cdb1ad5527a77d2cd04"
RAW = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl"
RELEASE = "fonts-2"
ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "sidecar" / "vivepdf" / "ops" / "font_library_catalog.py"
DEFAULT_OUTPUT = ROOT / "sidecar" / "build" / RELEASE
TURKISH = "ÇçĞğİıÖöŞşÜüÂâÎîÛû"
STYLES = {"regular": (400, False), "bold": (700, False), "italic": (400, True), "boldItalic": (700, True)}
STYLE_NAMES = {"regular": "Regular", "bold": "Bold", "italic": "Italic", "boldItalic": "Bold Italic"}

FAMILIES = (
    ("inter", "Inter", "sans", "inter", "Inter[opsz,wght].ttf", "Inter-Italic[opsz,wght].ttf"),
    ("montserrat", "Montserrat", "sans", "montserrat", "Montserrat[wght].ttf", "Montserrat-Italic[wght].ttf"),
    ("poppins", "Poppins", "sans", "poppins", None, None),
    ("raleway", "Raleway", "sans", "raleway", "Raleway[wght].ttf", "Raleway-Italic[wght].ttf"),
    ("nunito", "Nunito", "sans", "nunito", "Nunito[wght].ttf", "Nunito-Italic[wght].ttf"),
    ("josefin-sans", "Josefin Sans", "sans", "josefinsans", "JosefinSans[wght].ttf", "JosefinSans-Italic[wght].ttf"),
    ("oswald", "Oswald", "display", "oswald", "Oswald[wght].ttf", None),
    ("bebas-neue", "Bebas Neue", "display", "bebasneue", "BebasNeue-Regular.ttf", None),
    ("abril-fatface", "Abril Fatface", "display", "abrilfatface", "AbrilFatface-Regular.ttf", None),
    ("cinzel", "Cinzel", "display", "cinzel", "Cinzel[wght].ttf", None),
    ("playfair-display", "Playfair Display", "serif", "playfairdisplay", "PlayfairDisplay[wght].ttf", "PlayfairDisplay-Italic[wght].ttf"),
    ("lora", "Lora", "serif", "lora", "Lora[wght].ttf", "Lora-Italic[wght].ttf"),
    ("merriweather", "Merriweather", "serif", "merriweather", "Merriweather[opsz,wdth,wght].ttf", "Merriweather-Italic[opsz,wdth,wght].ttf"),
    ("libre-baskerville", "Libre Baskerville", "serif", "librebaskerville", "LibreBaskerville[wght].ttf", "LibreBaskerville-Italic[wght].ttf"),
    ("cormorant-garamond", "Cormorant Garamond", "serif", "cormorantgaramond", "CormorantGaramond[wght].ttf", "CormorantGaramond-Italic[wght].ttf"),
    ("eb-garamond", "EB Garamond", "serif", "ebgaramond", "EBGaramond[wght].ttf", "EBGaramond-Italic[wght].ttf"),
    ("source-serif-4", "Source Serif 4", "serif", "sourceserif4", "SourceSerif4[opsz,wght].ttf", "SourceSerif4-Italic[opsz,wght].ttf"),
    ("great-vibes", "Great Vibes", "script", "greatvibes", "GreatVibes-Regular.ttf", None),
    ("dancing-script", "Dancing Script", "script", "dancingscript", "DancingScript[wght].ttf", None),
    ("parisienne", "Parisienne", "script", "parisienne", "Parisienne-Regular.ttf", None),
    ("allura", "Allura", "script", "allura", "Allura-Regular.ttf", None),
    ("alex-brush", "Alex Brush", "script", "alexbrush", "AlexBrush-Regular.ttf", None),
    ("caveat", "Caveat", "handwriting", "caveat", "Caveat[wght].ttf", None),
    ("pacifico", "Pacifico", "handwriting", "pacifico", "Pacifico-Regular.ttf", None),
)
POPPINS = {"regular": "Poppins-Regular.ttf", "bold": "Poppins-Bold.ttf", "italic": "Poppins-Italic.ttf", "boldItalic": "Poppins-BoldItalic.ttf"}

HEADER = '''from typing import NamedTuple


class LibraryFile(NamedTuple):
    style: str
    name: str
    size: int
    sha256: str


class LibraryFamily(NamedTuple):
    id: str
    name: str
    category: str
    files: tuple[LibraryFile, ...]


LIBRARY_RELEASE = "{release}"
FAMILIES: tuple[LibraryFamily, ...] = (
'''


def fetch(directory: str, name: str) -> bytes:
    request = urllib.request.Request(f"{RAW}/{directory}/{urllib.request.quote(name)}", headers={"User-Agent": "vivePDF"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def axis_ranges(font: TTFont) -> dict[str, tuple[float, float, float]]:
    if "fvar" not in font:
        return {}
    return {axis.axisTag: (axis.minValue, axis.defaultValue, axis.maxValue) for axis in font["fvar"].axes}


def rename(font: TTFont, family: str, style: str) -> None:
    label = STYLE_NAMES[style]
    postscript = f"{family.replace(' ', '')}-{label.replace(' ', '')}"
    names = font["name"]
    for record in list(names.names):
        if record.nameID in (16, 17, 21, 22, 25):
            names.removeNames(nameID=record.nameID)
    for name_id, value in ((1, family), (2, label), (3, f"{postscript};{COMMIT[:7]}"), (4, f"{family} {label}"), (6, postscript)):
        names.setName(value, name_id, 3, 1, 0x409)
        names.setName(value, name_id, 1, 0, 0)
    weight, italic = STYLES[style]
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    selection = os2.fsSelection & ~(1 | 32 | 64)
    if italic:
        selection |= 1
    if weight >= 700:
        selection |= 32
    if not italic and weight < 700:
        selection |= 64
    os2.fsSelection = selection
    font["head"].macStyle = (1 if weight >= 700 else 0) | (2 if italic else 0)


def instance(data: bytes, style: str) -> TTFont:
    font = TTFont(io.BytesIO(data))
    ranges = axis_ranges(font)
    if ranges:
        weight = STYLES[style][0]
        location = {tag: default for tag, (_, default, _) in ranges.items()}
        if "wght" in ranges:
            low, _, high = ranges["wght"]
            location["wght"] = min(max(weight, low), high)
        font = instancer.instantiateVariableFont(font, location, updateFontNames=False)
    return font


def covers_turkish(font: TTFont) -> str:
    cmap = font.getBestCmap()
    return "".join(char for char in TURKISH if ord(char) not in cmap)


def wanted_styles(upright: str | None, italic: str | None, data: dict[str, bytes]) -> dict[str, bytes]:
    if upright is None:
        return data
    font = TTFont(io.BytesIO(data["upright"]))
    ranges = axis_ranges(font)
    has_bold = "wght" in ranges and ranges["wght"][2] >= 700
    styles = {"regular": data["upright"]}
    if has_bold:
        styles["bold"] = data["upright"]
    if italic is not None:
        styles["italic"] = data["italic"]
        if has_bold:
            styles["boldItalic"] = data["italic"]
    return styles


def build(output: Path) -> list[tuple[str, str, str, list[tuple[str, str, int, str]]]]:
    output.mkdir(parents=True, exist_ok=True)
    catalog = []
    for family_id, name, category, directory, upright, italic in FAMILIES:
        if upright is None:
            sources = {style: fetch(directory, file) for style, file in POPPINS.items()}
        else:
            sources = {"upright": fetch(directory, upright)}
            if italic is not None:
                sources["italic"] = fetch(directory, italic)
        files = []
        for style, data in wanted_styles(upright, italic, sources).items():
            font = instance(data, style)
            missing = covers_turkish(font)
            if missing:
                sys.exit(f"{name} {style} lacks {missing}")
            rename(font, name, style)
            file_name = f"{name.replace(' ', '')}-{STYLE_NAMES[style].replace(' ', '')}.ttf"
            buffer = io.BytesIO()
            font.save(buffer)
            payload = buffer.getvalue()
            (output / file_name).write_bytes(payload)
            files.append((style, file_name, len(payload), hashlib.sha256(payload).hexdigest()))
        licence = fetch(directory, "OFL.txt")
        licence_name = f"{name.replace(' ', '')}-OFL.txt"
        (output / licence_name).write_bytes(licence)
        files.append(("license", licence_name, len(licence), hashlib.sha256(licence).hexdigest()))
        catalog.append((family_id, name, category, files))
        print(f"{name}: {', '.join(style for style, *_ in files)} ({sum(size for _, _, size, _ in files) // 1024} KB)")
    return catalog


def write_catalog(catalog: list[tuple[str, str, str, list[tuple[str, str, int, str]]]]) -> None:
    lines = [HEADER.format(release=RELEASE)]
    for family_id, name, category, files in catalog:
        lines.append(f"    LibraryFamily(\n        {family_id!r},\n        {name!r},\n        {category!r},\n        (\n")
        lines.extend(f"            LibraryFile({style!r}, {file_name!r}, {size}, {digest!r}),\n" for style, file_name, size, digest in files)
        lines.append("        ),\n    ),\n")
    lines.append(")\n")
    TARGET.write_text("".join(lines).replace("'", '"'), encoding="utf-8", newline="\n")
    subprocess.run(["uv", "run", "ruff", "format", str(TARGET)], cwd=ROOT / "sidecar", check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=f"Build the {RELEASE} font library from google/fonts {COMMIT[:7]}")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    write_catalog(build(arguments.output))
    print(f"wrote {TARGET} and the release files in {arguments.output}")


if __name__ == "__main__":
    main()
