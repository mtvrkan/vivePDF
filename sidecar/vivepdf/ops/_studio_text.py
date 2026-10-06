import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf
from fontTools.ttLib import TTFont

from vivepdf.ops._studio_models import StudioRun, StudioSegment, StudioTextItem
from vivepdf.ops.fonts import resolve_face

MIN_SHRINK_SIZE = 4.0
SHRINK_STEP = 0.5
TOKEN = re.compile(r"\n|[ \t]+|[^ \t\n]+")
LIST_INDENT = 1.6
REGULAR_WEIGHT = 400
BOLD_WEIGHT = 700
BOLD_FROM = 600


@dataclass(frozen=True)
class Style:
    font_id: str | None
    weight: int
    italic: bool
    underline: bool
    strike: bool
    color: str
    size: float


@dataclass
class Face:
    font: pymupdf.Font
    oblique: bool
    ascender: float
    descender: float
    underline_position: float
    underline_thickness: float
    strike_thickness: float


@dataclass
class Atom:
    text: str
    style: Style
    space: bool


@dataclass
class Paragraph:
    kind: str
    level: int
    pieces: list[tuple[str, Style]]
    marker: str | None
    marker_style: Style


@dataclass
class Line:
    atoms: list[Atom]
    wrapped: bool
    indent: float
    marker: Atom | None


@dataclass
class Placed:
    text: str
    x: float
    baseline: float
    size: float
    style: Style
    letter_spacing: float


@dataclass
class Band:
    x: float
    y: float
    width: float
    height: float


@dataclass
class TextLayout:
    placed: list[Placed]
    bands: list[Band] = field(default_factory=list)


_metrics: dict[str, tuple[float, float, float]] = {}


def _decoration_metrics(path: Path) -> tuple[float, float, float]:
    key = str(path)
    if key not in _metrics:
        try:
            with TTFont(key, lazy=True, fontNumber=0) as font:
                units = font["head"].unitsPerEm
                post = font["post"]
                underline = max(post.underlineThickness / units, 0.02)
                strike = font["OS/2"].yStrikeoutSize / units if "OS/2" in font else 0.0
                _metrics[key] = (
                    -post.underlinePosition / units,
                    underline,
                    strike if strike > 0 else underline,
                )
        except Exception:  # noqa: BLE001
            _metrics[key] = (0.1, 0.05, 0.05)
    return _metrics[key]


def _face(path: Path, oblique: bool) -> Face:
    font = pymupdf.Font(fontfile=str(path))
    position, thickness, strike = _decoration_metrics(path)
    ascender, descender = font.ascender, font.descender
    if ascender - descender <= 0:
        ascender, descender = 0.8, -0.2
    return Face(font, oblique, ascender, descender, position, thickness, strike)


class TextFaces:
    def __init__(self, font_id: str | None = None, store: dict | None = None) -> None:
        self.font_id = font_id
        self.store: dict = store if store is not None else {}

    def face(self, font_id: str | None, weight: int, italic: bool) -> Face:
        key = ("style", font_id, weight, italic)
        if key not in self.store:
            explicit = None if weight in (REGULAR_WEIGHT, BOLD_WEIGHT) else weight
            path, real_italic = resolve_face(font_id, weight >= BOLD_FROM, italic, explicit)
            oblique = italic and not real_italic
            loaded = ("file", str(path), oblique)
            if loaded not in self.store:
                self.store[loaded] = _face(path, oblique)
            self.store[key] = self.store[loaded]
        return self.store[key]

    def get(self, bold: bool, italic: bool) -> Face:
        return self.face(self.font_id, BOLD_WEIGHT if bold else REGULAR_WEIGHT, italic)

    def of(self, style: Style) -> Face:
        return self.face(style.font_id, style.weight, style.italic)


def run_style(item: StudioTextItem, run: StudioRun) -> Style:
    font_id = run.font_id if "font_id" in run.model_fields_set else item.font_id
    weight = run.weight if run.weight is not None else (BOLD_WEIGHT if run.bold else REGULAR_WEIGHT)
    size = run.size if run.size is not None else item.font_size
    return Style(font_id, weight, run.italic, run.underline, run.strike, run.color, size)


def segment_style(item: StudioTextItem, segment: StudioSegment) -> Style:
    font_id = segment.font_id if "font_id" in segment.model_fields_set else item.font_id
    weight = segment.weight
    if weight is None:
        weight = BOLD_WEIGHT if segment.bold else REGULAR_WEIGHT
    return Style(
        font_id,
        weight,
        segment.italic,
        segment.underline,
        segment.strike,
        segment.color,
        segment.size,
    )


def base_style(item: StudioTextItem) -> Style:
    weight = item.weight or REGULAR_WEIGHT
    return Style(item.font_id, weight, False, False, False, item.color, item.font_size)
