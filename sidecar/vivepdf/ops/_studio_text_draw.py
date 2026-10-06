import re
from dataclasses import replace

import pymupdf

from vivepdf.ops._studio_models import StudioTextItem
from vivepdf.ops._studio_text import Band, Placed, TextFaces, TextLayout

OBLIQUE_SLANT = 0.25
STRIKE_RISE = 1 / 3
LINE_WIDTH = re.compile(rb"(?m)^[0-9.]+ w$")


def _transform(item: StudioTextItem, baseline: float, oblique: bool) -> pymupdf.Matrix:
    matrix = pymupdf.Matrix(1, 0, 0, 1, 0, 0)
    if oblique:
        matrix = pymupdf.Matrix(1, 0, -OBLIQUE_SLANT, 1, OBLIQUE_SLANT * baseline, 0)
    if item.rotation % 360 or item.flip_x or item.flip_y:
        cx, cy = item.x + item.width / 2, item.y + item.height / 2
        matrix = (
            matrix
            * pymupdf.Matrix(1, 0, 0, 1, -cx, -cy)
            * pymupdf.Matrix(-1 if item.flip_x else 1, 0, 0, -1 if item.flip_y else 1, 0, 0)
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
