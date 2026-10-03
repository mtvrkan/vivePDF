import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf
from fontTools.ttLib import TTFont

from vivepdf.ops._studio_models import StudioRun, StudioSegment, StudioTextItem
from vivepdf.ops.create_bulk import PLACEHOLDER, fill_placeholders
from vivepdf.ops.fonts import resolve_face

OBLIQUE_SLANT = 0.25
MIN_SHRINK_SIZE = 4.0
SHRINK_STEP = 0.5
FIT_TOLERANCE = 0.01
TOKEN = re.compile(r"\n|[ \t]+|[^ \t\n]+")
DOTLESS_LANGUAGES = {"tr", "az"}


@dataclass(frozen=True)
class Style:
    bold: bool
    italic: bool
    underline: bool
    color: str


@dataclass
class Face:
    font: pymupdf.Font
    oblique: bool
    ascender: float
    descender: float
    underline_position: float
    underline_thickness: float


@dataclass
class Atom:
    text: str
    style: Style
    space: bool


@dataclass
class Line:
    atoms: list[Atom]
    wrapped: bool


@dataclass
class Placed:
    text: str
    x: float
    baseline: float
    size: float
    style: Style
    letter_spacing: float


@dataclass
class TextFaces:
    font_id: str | None
    cache: dict[tuple[bool, bool], Face] = field(default_factory=dict)

    def get(self, bold: bool, italic: bool) -> Face:
        key = (bold, italic)
        if key not in self.cache:
            path, real_italic = resolve_face(self.font_id, bold, italic)
            self.cache[key] = _face(path, italic and not real_italic)
        return self.cache[key]

    def of(self, style: Style) -> Face:
        return self.get(style.bold, style.italic)


_metrics: dict[str, tuple[float, float]] = {}


def _underline_metrics(path: Path) -> tuple[float, float]:
    key = str(path)
    if key not in _metrics:
        try:
            with TTFont(key, lazy=True, fontNumber=0) as font:
                units = font["head"].unitsPerEm
                post = font["post"]
                _metrics[key] = (
                    -post.underlinePosition / units,
                    max(post.underlineThickness / units, 0.02),
                )
        except Exception:  # noqa: BLE001
            _metrics[key] = (0.1, 0.05)
    return _metrics[key]


def _face(path: Path, oblique: bool) -> Face:
    font = pymupdf.Font(fontfile=str(path))
    position, thickness = _underline_metrics(path)
    ascender, descender = font.ascender, font.descender
    if ascender - descender <= 0:
        ascender, descender = 0.8, -0.2
    return Face(font, oblique, ascender, descender, position, thickness)


def upper(text: str, language: str) -> str:
    if language.split("-")[0].lower() in DOTLESS_LANGUAGES:
        text = text.replace("i", "İ")
    return text.upper()


def has_placeholders(item: StudioTextItem) -> bool:
    return any(PLACEHOLDER.search(run.text) for run in item.runs)


def _style(run: StudioRun | StudioSegment) -> Style:
    return Style(run.bold, run.italic, run.underline, run.color)


def _atoms(item: StudioTextItem, values: dict[str, str], language: str) -> list[Atom]:
    atoms: list[Atom] = []
    for run in item.runs:
        text = fill_placeholders(run.text, values) if values else run.text
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        if item.uppercase:
            text = upper(text, language)
        style = _style(run)
        for token in TOKEN.findall(text):
            atoms.append(Atom(token, style, token == "\n" or token[0] in " \t"))
    return atoms


def _width(faces: TextFaces, atom: Atom, size: float, spacing: float) -> float:
    text = atom.text.replace("\t", " ")
    return faces.of(atom.style).font.text_length(text, fontsize=size) + spacing * len(text)


def _split_word(
    faces: TextFaces, word: list[Atom], size: float, spacing: float, width: float
) -> list[list[Atom]]:
    chunks: list[list[Atom]] = []
    current: list[Atom] = []
    used = 0.0
    for atom in word:
        for char in atom.text:
            piece = Atom(char, atom.style, False)
            advance = _width(faces, piece, size, spacing)
            if current and used + advance > width + FIT_TOLERANCE:
                chunks.append(current)
                current, used = [], 0.0
            if current and current[-1].style == atom.style:
                current[-1] = Atom(current[-1].text + char, atom.style, False)
            else:
                current.append(piece)
            used += advance
    if current:
        chunks.append(current)
    return chunks


def _paragraphs(atoms: list[Atom]) -> list[list[Atom]]:
    paragraphs: list[list[Atom]] = [[]]
    for atom in atoms:
        if atom.text == "\n":
            paragraphs.append([])
        else:
            paragraphs[-1].append(atom)
    return paragraphs


def _words(paragraph: list[Atom]) -> list[tuple[bool, list[Atom]]]:
    tokens: list[tuple[bool, list[Atom]]] = []
    for atom in paragraph:
        if tokens and tokens[-1][0] == atom.space:
            tokens[-1][1].append(atom)
        else:
            tokens.append((atom.space, [atom]))
    return tokens


def wrap(
    faces: TextFaces, atoms: list[Atom], size: float, spacing: float, width: float
) -> tuple[list[Line], bool]:
    lines: list[Line] = []
    broke = False
    for paragraph in _paragraphs(atoms):
        current: list[Atom] = []
        used = 0.0
        pending: list[Atom] = []
        pending_width = 0.0
        for space, token in _words(paragraph):
            token_width = sum(_width(faces, atom, size, spacing) for atom in token)
            if space:
                pending.extend(token)
                pending_width += token_width
                continue
            if current and used + pending_width + token_width > width + FIT_TOLERANCE:
                lines.append(Line(current + pending, True))
                current, used = [], 0.0
            elif current or pending:
                current.extend(pending)
                used += pending_width
            pending, pending_width = [], 0.0
            if token_width > width + FIT_TOLERANCE:
                broke = True
                chunks = _split_word(faces, token, size, spacing, width)
                for chunk in chunks[:-1]:
                    lines.append(Line(current + chunk, True))
                    current, used = [], 0.0
                token = chunks[-1]
                token_width = sum(_width(faces, atom, size, spacing) for atom in token)
            current.extend(token)
            used += token_width
        lines.append(Line(current + pending, False))
    return lines, broke


def _trimmed(atoms: list[Atom]) -> list[Atom]:
    end = len(atoms)
    while end and atoms[end - 1].space:
        end -= 1
    return atoms[:end]


def _line_box(faces: TextFaces, size: float, line_height: float) -> tuple[float, float]:
    face = faces.get(False, False)
    box = size * line_height
    content = (face.ascender - face.descender) * size
    return box, (box - content) / 2 + face.ascender * size


def layout(
    item: StudioTextItem, faces: TextFaces, values: dict[str, str], language: str
) -> list[Placed]:
    atoms = _atoms(item, values, language)
    size = item.font_size
    while True:
        spacing = item.letter_spacing * size / item.font_size
        lines, broke = wrap(faces, atoms, size, spacing, item.width)
        box, baseline = _line_box(faces, size, item.line_height)
        fits = not broke and box * len(lines) <= item.height + FIT_TOLERANCE
        if not item.shrink_to_fit or fits or size <= MIN_SHRINK_SIZE:
            break
        size = max(MIN_SHRINK_SIZE, size - SHRINK_STEP)
    total = box * len(lines)
    top = {"top": 0.0, "middle": (item.height - total) / 2, "bottom": item.height - total}[
        item.vertical_align
    ]
    placed: list[Placed] = []
    for index, line in enumerate(lines):
        visible = _trimmed(line.atoms)
        natural = sum(_width(faces, atom, size, spacing) for atom in visible)
        spaces = sum(len(atom.text) for atom in visible if atom.space)
        extra = 0.0
        x = 0.0
        if item.align == "center":
            x = (item.width - natural) / 2
        elif item.align == "right":
            x = item.width - natural
        elif item.align == "justify" and line.wrapped and spaces:
            extra = max(0.0, (item.width - natural) / spaces)
        y = top + index * box + baseline
        for atom in visible:
            advance = _width(faces, atom, size, spacing)
            if atom.space:
                x += advance + extra * len(atom.text)
                continue
            placed.append(Placed(atom.text, x, y, size, atom.style, spacing))
            x += advance
    return placed


def from_segments(segments: list[StudioSegment]) -> list[Placed]:
    return [
        Placed(
            segment.text,
            segment.x,
            segment.y,
            segment.size,
            _style(segment),
            segment.letter_spacing,
        )
        for segment in segments
    ]


def _transform(item: StudioTextItem, baseline: float, oblique: bool) -> pymupdf.Matrix:
    matrix = pymupdf.Matrix(1, 0, 0, 1, 0, 0)
    if oblique:
        matrix = pymupdf.Matrix(1, 0, -OBLIQUE_SLANT, 1, OBLIQUE_SLANT * baseline, 0)
    if item.rotation % 360:
        cx, cy = item.x + item.width / 2, item.y + item.height / 2
        matrix = (
            matrix
            * pymupdf.Matrix(1, 0, 0, 1, -cx, -cy)
            * pymupdf.Matrix(item.rotation)
            * pymupdf.Matrix(1, 0, 0, 1, cx, cy)
        )
    return matrix


def _morph(matrix: pymupdf.Matrix, page_height: float) -> tuple[pymupdf.Point, pymupdf.Matrix]:
    flip = pymupdf.Matrix(1, 0, 0, -1, 0, page_height)
    return pymupdf.Point(0, page_height), flip * matrix * flip


def _missing(font: pymupdf.Font, text: str) -> str:
    return "".join(char for char in text if not char.isspace() and not font.has_glyph(ord(char)))


def draw_text(
    page: pymupdf.Page, item: StudioTextItem, faces: TextFaces, placed: list[Placed]
) -> str:
    writers: dict[tuple[str, bool, float], pymupdf.TextWriter] = {}
    underlines: list[tuple[Placed, float]] = []
    missing: list[str] = []
    for piece in placed:
        face = faces.of(piece.style)
        baseline = item.y + piece.baseline
        key = (piece.style.color, face.oblique, round(baseline, 3) if face.oblique else 0.0)
        writer = writers.setdefault(key, pymupdf.TextWriter(page.rect))
        x = item.x + piece.x
        start = x
        if piece.letter_spacing:
            for char in piece.text:
                writer.append((x, baseline), char, font=face.font, fontsize=piece.size)
                x += face.font.text_length(char, fontsize=piece.size) + piece.letter_spacing
        else:
            writer.append((x, baseline), piece.text, font=face.font, fontsize=piece.size)
            x += face.font.text_length(piece.text, fontsize=piece.size)
        missing.append(_missing(face.font, piece.text))
        if piece.style.underline:
            underlines.append((piece, x - start))
    for (colour, oblique, baseline), writer in writers.items():
        matrix = _transform(item, baseline, oblique)
        writer.write_text(
            page,
            color=_rgb(colour),
            opacity=item.opacity,
            morph=_morph(matrix, page.rect.height),
        )
    if underlines:
        _draw_underlines(page, item, faces, underlines)
    return "".join(dict.fromkeys("".join(missing)))


def _draw_underlines(
    page: pymupdf.Page,
    item: StudioTextItem,
    faces: TextFaces,
    underlines: list[tuple[Placed, float]],
) -> None:
    rotation = _transform(item, 0.0, False)
    shape = page.new_shape()
    for piece, length in underlines:
        face = faces.of(piece.style)
        y = item.y + piece.baseline + face.underline_position * piece.size
        start = pymupdf.Point(item.x + piece.x, y) * rotation
        end = pymupdf.Point(item.x + piece.x + length, y) * rotation
        shape.draw_line(start, end)
        shape.finish(
            color=_rgb(piece.style.color),
            width=face.underline_thickness * piece.size,
            stroke_opacity=item.opacity,
        )
    shape.commit(overlay=True)


def _rgb(colour: str) -> tuple[float, float, float]:
    return tuple(int(colour[index : index + 2], 16) / 255 for index in (1, 3, 5))  # type: ignore[return-value]
