import re

import pymupdf

XFDF_NAMESPACE = "http://ns.adobe.com/xfdf/"
MAX_XFDF_BYTES = 64 * 1024 * 1024
NUMBER = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
SAFE_NAME = re.compile(r"[^A-Za-z0-9_.\-]")

SUBTYPE_TAGS: dict[str, str] = {
    "Text": "text",
    "Highlight": "highlight",
    "Underline": "underline",
    "StrikeOut": "strikeout",
    "Squiggly": "squiggly",
    "Ink": "ink",
    "Square": "square",
    "Circle": "circle",
    "Line": "line",
    "Polygon": "polygon",
    "PolyLine": "polyline",
    "FreeText": "freetext",
    "Stamp": "stamp",
    "Caret": "caret",
}
TAG_SUBTYPES = {tag: subtype for subtype, tag in SUBTYPE_TAGS.items()}
MARKUP_TAGS = {"highlight", "underline", "strikeout", "squiggly"}
APPEARANCE_TAGS = {"stamp"}
DROPPED_KEYS = {"P", "Page", "Popup", "Parent", "IRT", "A", "AA", "StructParent", "OC"}
MAX_GRAPH_OBJECTS = 4000
MAX_FDF_OBJECTS = 200_000
PRINTABLE = set(range(32, 127)) | {9, 10, 13}
BORDER_STYLES = {"S": "solid", "D": "dash", "B": "bevelled", "I": "inset", "U": "underline"}
STYLE_KEYS = {style: key for key, style in BORDER_STYLES.items()}
CLOUDY = "cloudy"
MAX_DASHES = 8
MAX_CLOUD_INTENSITY = 2.0
DUPLICATE_TOLERANCE = 1.0
ENDING_TAGS = ("line", "polyline")

FLAG_NAMES: tuple[tuple[int, str], ...] = (
    (1, "invisible"),
    (2, "hidden"),
    (4, "print"),
    (8, "nozoom"),
    (16, "norotate"),
    (32, "noview"),
    (64, "readonly"),
    (128, "locked"),
    (256, "togglenoview"),
    (512, "lockedcontents"),
)


def _numbers(value: str) -> list[float]:
    return [float(token) for token in NUMBER.findall(value)]


def _format(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def _joined(values: list[float]) -> str:
    return ",".join(_format(value) for value in values)


def _pairs(values: list[float]) -> str:
    return ";".join(
        f"{_format(values[index])},{_format(values[index + 1])}"
        for index in range(0, len(values) - 1, 2)
    )


def _raw(document: pymupdf.Document, xref: int, key: str) -> tuple[str, str]:
    return document.xref_get_key(xref, key)


def _raw_numbers(document: pymupdf.Document, xref: int, key: str) -> list[float] | None:
    kind, value = _raw(document, xref, key)
    if kind != "array":
        return None
    return _numbers(value)


def _hex_color(values: list[float] | None) -> str | None:
    if not values or len(values) < 3:
        return None
    channels = [int(round(max(0.0, min(1.0, part)) * 255)) for part in values[:3]]
    return "#" + "".join(f"{channel:02X}" for channel in channels)


def _flag_names(value: int) -> str:
    return ",".join(name for bit, name in FLAG_NAMES if value & bit)


def _annotation_name(document: pymupdf.Document, xref: int) -> str:
    kind, value = _raw(document, xref, "NM")
    if kind == "string" and value:
        return value
    return f"vivepdf-{xref}"


class _Budget:
    def __init__(self) -> None:
        self.left = MAX_GRAPH_OBJECTS

    def spend(self) -> None:
        self.left -= 1
        if self.left < 0:
            raise ValueError("appearance too large")
