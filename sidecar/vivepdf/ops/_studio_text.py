import re
import unicodedata
from dataclasses import dataclass, field, replace
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
LIST_INDENT = 1.6
REGULAR_WEIGHT = 400
BOLD_WEIGHT = 700
BOLD_FROM = 600
DEFAULT_FONT_ID = "bundled:dejavu-sans"
BULLETS = {"bullet": "•", "dash": "–", "check": "✓"}
WORD_MARKS = {"'", "’", "ʼ"}
ROMAN = (
    (1000, "m"),
    (900, "cm"),
    (500, "d"),
    (400, "cd"),
    (100, "c"),
    (90, "xc"),
    (50, "l"),
    (40, "xl"),
    (10, "x"),
    (9, "ix"),
    (5, "v"),
    (4, "iv"),
    (1, "i"),
)
UNBOUNDED = 1e9
STRIKE_RISE = 1 / 3
LINE_WIDTH = re.compile(rb"(?m)^[0-9.]+ w$")


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


def _dotless(language: str) -> bool:
    return language.split("-")[0].lower() in DOTLESS_LANGUAGES


def _upper_char(char: str, language: str) -> str:
    return "İ" if char == "i" and _dotless(language) else char.upper()


def _lower_char(char: str, language: str) -> str:
    if _dotless(language) and char in ("I", "İ"):
        return "ı" if char == "I" else "i"
    return char.lower()


def _inside_word(char: str) -> bool:
    return bool(char) and (unicodedata.category(char)[0] in "LNM" or char in WORD_MARKS)


def case_texts(texts: list[str], mode: str, language: str) -> list[str]:
    if mode == "none":
        return texts
    previous = ""
    result: list[str] = []
    for text in texts:
        chars: list[str] = []
        for char in text:
            if mode == "upper":
                chars.append(_upper_char(char, language))
            elif mode == "lower":
                chars.append(_lower_char(char, language))
            elif unicodedata.category(char).startswith("L") and not _inside_word(previous):
                chars.append(_upper_char(char, language))
            else:
                chars.append(char)
            previous = char
        result.append("".join(chars))
    return result


def upper(text: str, language: str) -> str:
    return case_texts([text], "upper", language)[0]


def _alpha(count: int) -> str:
    label = ""
    while count > 0:
        count -= 1
        label = chr(97 + count % 26) + label
        count //= 26
    return label


def _roman(count: int) -> str:
    label = ""
    for amount, symbol in ROMAN:
        while count >= amount:
            label += symbol
            count -= amount
    return label


def marker_text(kind: str, count: int) -> str | None:
    if kind == "none":
        return None
    if kind in BULLETS:
        return BULLETS[kind]
    if kind == "decimal":
        return f"{count}."
    if kind == "alpha":
        return f"{_alpha(count)})"
    return f"{_roman(count)}."


def list_markers(paragraphs: list[tuple[str, int]]) -> list[str | None]:
    counters: list[tuple[str, int]] = []
    markers: list[str | None] = []
    for kind, level in paragraphs:
        if kind == "none":
            counters = []
            markers.append(None)
            continue
        counters = counters[: level + 1]
        while len(counters) <= level:
            counters.append(("none", 0))
        current_kind, current_count = counters[level]
        count = current_count + 1 if current_kind == kind else 1
        counters[level] = (kind, count)
        markers.append(marker_text(kind, count))
    return markers


def has_placeholders(item: StudioTextItem) -> bool:
    return any(PLACEHOLDER.search(run.text) for run in item.runs)


def item_language(item: StudioTextItem, language: str) -> str:
    return item.language or language


def run_style(item: StudioTextItem, run: StudioRun) -> Style:
    font_id = run.font_id if "font_id" in run.model_fields_set else item.font_id
    weight = run.weight if run.weight is not None else (BOLD_WEIGHT if run.bold else REGULAR_WEIGHT)
    size = run.size if run.size is not None else item.font_size
    return Style(font_id, weight, run.italic, run.underline, run.strike, run.color, size)


def _segment_style(item: StudioTextItem, segment: StudioSegment) -> Style:
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


def _base_style(item: StudioTextItem) -> Style:
    weight = item.weight or REGULAR_WEIGHT
    return Style(item.font_id, weight, False, False, False, item.color, item.font_size)


def _lines_of(text: str) -> list[str]:
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


Split = list[tuple[tuple[str, int], list[tuple[str, Style]]]]


def _split(item: StudioTextItem) -> Split:
    def attributes(index: int) -> tuple[str, int]:
        if index < len(item.paragraphs):
            paragraph = item.paragraphs[index]
            return paragraph.list, paragraph.level
        return "none", 0

    split: Split = [(attributes(0), [])]
    for run in item.runs:
        style = run_style(item, run)
        for index, part in enumerate(_lines_of(run.text)):
            if index:
                split.append((attributes(len(split)), []))
            if part:
                split[-1][1].append((part, style))
    return split


def _filled(split: Split, values: dict[str, str]) -> Split:
    filled: Split = []
    for attributes, pieces in split:
        current: Split = [(attributes, [])]
        for part, style in pieces:
            for index, chunk in enumerate(_lines_of(fill_placeholders(part, values))):
                if index:
                    current.append((attributes, []))
                if chunk:
                    current[-1][1].append((chunk, style))
        filled.extend(current)
    return filled


def _marker_style(item: StudioTextItem, kind: str, pieces: list[tuple[str, Style]]) -> Style:
    first = pieces[0][1] if pieces else _base_style(item)
    if kind == "check":
        return Style(
            DEFAULT_FONT_ID, REGULAR_WEIGHT, False, False, False, first.color, item.font_size
        )
    return Style(first.font_id, first.weight, False, False, False, first.color, item.font_size)


def text_paragraphs(item: StudioTextItem, values: dict[str, str], language: str) -> list[Paragraph]:
    split = _split(item)
    if values:
        split = _filled(split, values)
    markers = list_markers([attributes for attributes, _ in split])
    if len(split) > 1 and not split[-1][1]:
        split, markers = split[:-1], markers[:-1]
    texts: list[str] = []
    for _, pieces in split:
        texts.extend(part for part, _ in pieces)
        texts.append("\n")
    cased = iter(case_texts(texts, item.case, item_language(item, language)))
    paragraphs: list[Paragraph] = []
    for ((kind, level), pieces), marker in zip(split, markers, strict=True):
        styled = [(next(cased), style) for _, style in pieces]
        next(cased)
        paragraphs.append(Paragraph(kind, level, styled, marker, _marker_style(item, kind, pieces)))
    return paragraphs


def _atoms(pieces: list[tuple[str, Style]]) -> list[Atom]:
    return [
        Atom(token, style, token[0] in " \t")
        for text, style in pieces
        for token in TOKEN.findall(text)
    ]


def _width(faces: TextFaces, atom: Atom, scale: float, spacing: float) -> float:
    text = atom.text.replace("\t", " ")
    size = atom.style.size * scale
    return faces.of(atom.style).font.text_length(text, fontsize=size) + spacing * len(text)


def _split_word(
    faces: TextFaces, word: list[Atom], scale: float, spacing: float, width: float
) -> list[list[Atom]]:
    chunks: list[list[Atom]] = []
    current: list[Atom] = []
    used = 0.0
    for atom in word:
        for char in atom.text:
            piece = Atom(char, atom.style, False)
            advance = _width(faces, piece, scale, spacing)
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


def _words(atoms: list[Atom]) -> list[tuple[bool, list[Atom]]]:
    tokens: list[tuple[bool, list[Atom]]] = []
    for atom in atoms:
        if tokens and tokens[-1][0] == atom.space:
            tokens[-1][1].append(atom)
        else:
            tokens.append((atom.space, [atom]))
    return tokens


def wrap(
    faces: TextFaces, atoms: list[Atom], scale: float, spacing: float, width: float
) -> tuple[list[list[Atom]], list[bool], bool]:
    lines: list[list[Atom]] = []
    wrapped: list[bool] = []
    broke = False
    current: list[Atom] = []
    used = 0.0
    pending: list[Atom] = []
    pending_width = 0.0
    for space, token in _words(atoms):
        token_width = sum(_width(faces, atom, scale, spacing) for atom in token)
        if space:
            pending.extend(token)
            pending_width += token_width
            continue
        if current and used + pending_width + token_width > width + FIT_TOLERANCE:
            lines.append(current + pending)
            wrapped.append(True)
            current, used = [], 0.0
        elif current or pending:
            current.extend(pending)
            used += pending_width
        pending, pending_width = [], 0.0
        if token_width > width + FIT_TOLERANCE:
            broke = True
            chunks = _split_word(faces, token, scale, spacing, width)
            for chunk in chunks[:-1]:
                lines.append(current + chunk)
                wrapped.append(True)
                current, used = [], 0.0
            token = chunks[-1]
            token_width = sum(_width(faces, atom, scale, spacing) for atom in token)
        current.extend(token)
        used += token_width
    lines.append(current + pending)
    wrapped.append(False)
    return lines, wrapped, broke


def _trimmed(atoms: list[Atom]) -> list[Atom]:
    end = len(atoms)
    while end and atoms[end - 1].space:
        end -= 1
    return atoms[:end]


def _lines(
    item: StudioTextItem, faces: TextFaces, paragraphs: list[Paragraph], scale: float
) -> tuple[list[Line], bool]:
    body = item.font_size * scale
    spacing = item.letter_spacing * scale
    lines: list[Line] = []
    broke = False
    for paragraph in paragraphs:
        listed = paragraph.kind != "none"
        indent = (paragraph.level + 1) * LIST_INDENT * body if listed else 0.0
        width = UNBOUNDED if item.auto_width else max(1.0, item.width - indent)
        rows, wrapped, split = wrap(faces, _atoms(paragraph.pieces), scale, spacing, width)
        broke = broke or split
        for index, (row, flag) in enumerate(zip(rows, wrapped, strict=True)):
            marker = None
            if index == 0 and paragraph.marker:
                marker = Atom(paragraph.marker, paragraph.marker_style, False)
            lines.append(Line(row, flag, indent, marker))
    return lines, broke


def _half_leading(face: Face, size: float, line_height: float) -> tuple[float, float]:
    leading = (line_height * size - (face.ascender - face.descender) * size) / 2
    return face.ascender * size + leading, -face.descender * size + leading


def _line_metrics(
    item: StudioTextItem, faces: TextFaces, line: Line, scale: float
) -> tuple[float, float]:
    body = item.font_size * scale
    strut = faces.face(item.font_id, REGULAR_WEIGHT, False)
    above, below = _half_leading(strut, body, item.line_height)
    boxes = [(faces.of(atom.style), atom.style.size * scale) for atom in line.atoms]
    if line.marker:
        boxes.append((faces.of(line.marker.style), body))
    for face, size in boxes:
        top, bottom = _half_leading(face, size, item.line_height)
        above, below = max(above, top), max(below, bottom)
    return above, below


def _band(
    faces: TextFaces, pieces: list[tuple[float, float, Atom]], baseline: float, scale: float
) -> Band | None:
    shown = [entry for entry in pieces if not entry[2].space]
    if not shown:
        return None
    left = min(start for start, _, _ in shown)
    right = max(end for _, end, _ in shown)
    top = max(faces.of(atom.style).ascender * atom.style.size * scale for _, _, atom in shown)
    bottom = max(-faces.of(atom.style).descender * atom.style.size * scale for _, _, atom in shown)
    return Band(left, baseline - top, right - left, top + bottom)


def layout(
    item: StudioTextItem, faces: TextFaces, values: dict[str, str], language: str
) -> TextLayout:
    paragraphs = text_paragraphs(item, values, language)
    size = item.font_size
    while True:
        scale = size / item.font_size
        lines, broke = _lines(item, faces, paragraphs, scale)
        metrics = [_line_metrics(item, faces, line, scale) for line in lines]
        total = sum(above + below for above, below in metrics)
        fits = not broke and total <= item.height + FIT_TOLERANCE
        if not item.shrink_to_fit or fits or size <= MIN_SHRINK_SIZE:
            break
        size = max(MIN_SHRINK_SIZE, size - SHRINK_STEP)
    spacing = item.letter_spacing * scale
    body = item.font_size * scale
    hang = LIST_INDENT * body
    top = {"top": 0.0, "middle": (item.height - total) / 2, "bottom": item.height - total}[
        item.vertical_align
    ]
    placed: list[Placed] = []
    bands: list[Band] = []
    for line, (above, below) in zip(lines, metrics, strict=True):
        baseline = top + above
        visible = _trimmed(line.atoms)
        natural = sum(_width(faces, atom, scale, spacing) for atom in visible)
        spaces = sum(len(atom.text) for atom in visible if atom.space)
        room = item.width - line.indent
        x = line.indent
        extra = 0.0
        if item.align == "center":
            x += (room - natural) / 2
        elif item.align == "right":
            x += room - natural
        elif item.align == "justify" and line.wrapped and spaces:
            extra = max(0.0, (room - natural) / spaces)
        drawn: list[tuple[float, float, Atom]] = []
        if line.marker:
            start = x - hang
            marker_width = faces.of(line.marker.style).font.text_length(
                line.marker.text, fontsize=body
            ) + spacing * len(line.marker.text)
            placed.append(
                Placed(line.marker.text, start, baseline, body, line.marker.style, spacing)
            )
            drawn.append((start, start + marker_width, line.marker))
        for atom in visible:
            advance = _width(faces, atom, scale, spacing)
            if atom.space:
                x += advance + extra * len(atom.text)
                continue
            placed.append(
                Placed(atom.text, x, baseline, atom.style.size * scale, atom.style, spacing)
            )
            drawn.append((x, x + advance, atom))
            x += advance
        band = _band(faces, drawn, baseline, scale) if item.highlight else None
        if band:
            bands.append(band)
        top += above + below
    return TextLayout(placed, bands)


def from_segments(item: StudioTextItem) -> TextLayout:
    placed = [
        Placed(
            segment.text,
            segment.x,
            segment.y,
            segment.size,
            _segment_style(item, segment),
            segment.letter_spacing,
        )
        for segment in item.segments or []
    ]
    bands = [Band(band.x, band.y, band.width, band.height) for band in item.bands or []]
    return TextLayout(placed, bands)


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


def _advance(faces: TextFaces, piece: Placed) -> float:
    font = faces.of(piece.style).font
    return font.text_length(piece.text, fontsize=piece.size) + piece.letter_spacing * len(
        piece.text
    )


def _set_line_width(page: pymupdf.Page, width: float) -> None:
    document = page.parent
    xref = page.get_contents()[-1]
    stream = document.xref_stream(xref)
    document.update_stream(xref, LINE_WIDTH.sub(f"{width:.4f} w".encode(), stream))


def _write(
    page: pymupdf.Page,
    item: StudioTextItem,
    faces: TextFaces,
    pieces: list[Placed],
    colour: str | None,
    opacity: float,
    stroke: float = 0.0,
) -> str:
    writers: dict[tuple[str, bool, float], pymupdf.TextWriter] = {}
    missing: list[str] = []
    for piece in pieces:
        face = faces.of(piece.style)
        baseline = item.y + piece.baseline
        key = (
            colour or piece.style.color,
            face.oblique,
            round(baseline, 3) if face.oblique else 0.0,
        )
        writer = writers.setdefault(key, pymupdf.TextWriter(page.rect))
        x = item.x + piece.x
        if piece.letter_spacing:
            for char in piece.text:
                writer.append((x, baseline), char, font=face.font, fontsize=piece.size)
                x += face.font.text_length(char, fontsize=piece.size) + piece.letter_spacing
        else:
            writer.append((x, baseline), piece.text, font=face.font, fontsize=piece.size)
        missing.append(_missing(face.font, piece.text))
    for (shade, oblique, baseline), writer in writers.items():
        writer.write_text(
            page,
            color=_rgb(shade),
            opacity=opacity,
            morph=_morph(_transform(item, baseline, oblique), page.rect.height),
            render_mode=1 if stroke else 0,
        )
        if stroke:
            _set_line_width(page, stroke)
    return "".join(dict.fromkeys("".join(missing)))


def _decorations(
    faces: TextFaces, pieces: list[Placed], kind: str
) -> list[tuple[Placed, float, float]]:
    found: list[tuple[Placed, float, float]] = []
    for index, piece in enumerate(pieces):
        if not getattr(piece.style, kind):
            continue
        end = piece.x + _advance(faces, piece)
        following = pieces[index + 1] if index + 1 < len(pieces) else None
        if (
            following is not None
            and getattr(following.style, kind)
            and abs(following.baseline - piece.baseline) < 0.01
            and following.x > end
        ):
            end = following.x
        found.append((piece, piece.x, end))
    return found


def _draw_lines(
    page: pymupdf.Page,
    item: StudioTextItem,
    faces: TextFaces,
    pieces: list[Placed],
    kind: str,
    colour: str | None,
    opacity: float,
) -> None:
    found = _decorations(faces, pieces, kind)
    if not found:
        return
    rotation = _transform(item, 0.0, False)
    shape = page.new_shape()
    for piece, start, end in found:
        face = faces.of(piece.style)
        if kind == "underline":
            y = item.y + piece.baseline + face.underline_position * piece.size
            width = face.underline_thickness * piece.size
        else:
            y = item.y + piece.baseline - face.ascender * piece.size * STRIKE_RISE
            width = face.strike_thickness * piece.size
        shape.draw_line(
            pymupdf.Point(item.x + start, y) * rotation, pymupdf.Point(item.x + end, y) * rotation
        )
        shape.finish(color=_rgb(colour or piece.style.color), width=width, stroke_opacity=opacity)
    shape.commit(overlay=True)


def draw_bands(page: pymupdf.Page, item: StudioTextItem, bands: list[Band]) -> None:
    if item.highlight is None or not bands:
        return
    rotation = _transform(item, 0.0, False)
    padding = item.highlight.padding
    shape = page.new_shape()
    for band in bands:
        rect = pymupdf.Rect(
            item.x + band.x - padding,
            item.y + band.y - padding,
            item.x + band.x + band.width + padding,
            item.y + band.y + band.height + padding,
        )
        shape.draw_quad(rect.quad * rotation)
    shape.finish(color=None, fill=_rgb(item.highlight.color), fill_opacity=item.opacity)
    shape.commit(overlay=True)


def draw_text(
    page: pymupdf.Page, item: StudioTextItem, faces: TextFaces, text_layout: TextLayout
) -> str:
    placed = text_layout.placed
    draw_bands(page, item, text_layout.bands)
    shadow = item.shadow
    if shadow is not None and shadow.opacity > 0:
        moved = [
            replace(piece, x=piece.x + shadow.x, baseline=piece.baseline + shadow.y)
            for piece in placed
        ]
        opacity = item.opacity * shadow.opacity
        _draw_lines(page, item, faces, moved, "underline", shadow.color, opacity)
        _write(page, item, faces, moved, shadow.color, opacity)
        _draw_lines(page, item, faces, moved, "strike", shadow.color, opacity)
    _draw_lines(page, item, faces, placed, "underline", None, item.opacity)
    if item.outline is not None:
        _write(page, item, faces, placed, item.outline.color, item.opacity, item.outline.width * 2)
    missing = _write(page, item, faces, placed, None, item.opacity)
    _draw_lines(page, item, faces, placed, "strike", None, item.opacity)
    return missing


def _rgb(colour: str) -> tuple[float, float, float]:
    return tuple(int(colour[index : index + 2], 16) / 255 for index in (1, 3, 5))  # type: ignore[return-value]
