from vivepdf.ops._studio_models import StudioTextItem
from vivepdf.ops._studio_text import (
    LIST_INDENT,
    MIN_SHRINK_SIZE,
    REGULAR_WEIGHT,
    SHRINK_STEP,
    TOKEN,
    Atom,
    Band,
    Face,
    Line,
    Paragraph,
    Placed,
    Style,
    TextFaces,
    TextLayout,
    segment_style,
)
from vivepdf.ops._studio_text_paragraphs import text_paragraphs

FIT_TOLERANCE = 0.01
UNBOUNDED = 1e9


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
            segment_style(item, segment),
            segment.letter_spacing,
        )
        for segment in item.segments or []
    ]
    bands = [Band(band.x, band.y, band.width, band.height) for band in item.bands or []]
    return TextLayout(placed, bands)
