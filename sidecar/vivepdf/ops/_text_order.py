from collections.abc import Callable
from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._content import Token, content_tokens
from vivepdf.ops._struct_marks import MarkReopener, OpenTag

TEXT_SHOWS = frozenset({b"Tj", b"TJ", b"'", b'"'})
PAINTS = TEXT_SHOWS | {b"Do"}
NON_OPERATORS = frozenset({b"true", b"false", b"null", b"[", b"]", b"{", b"}"})
GLYPH_FLAGS = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_MEDIABOX_CLIP
VISIBLE_FLAGS = GLYPH_FLAGS | pymupdf.TEXT_CLIP
CLIP_EXIT_TRIES = 8
MAX_LEVELS = 32
PATH_ENDS = frozenset({b"n", b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*", b"S", b"s"})
PAINTING = PATH_ENDS - {b"n"} | {b"sh", b"Do", b"EI", b"BI"}
PATH_BUILDING = frozenset({b"m", b"l", b"c", b"v", b"y", b"h", b"re"})
CLIPPING = frozenset({b"W", b"W*"})
STATE_SETTING = frozenset(
    {
        *(b"cm", b"w", b"J", b"j", b"M", b"d", b"ri", b"i", b"gs"),
        *(b"CS", b"cs", b"SC", b"SCN", b"sc", b"scn", b"G", b"g", b"RG", b"rg", b"K", b"k"),
        *(b"Tc", b"Tw", b"Tz", b"TL", b"Tf", b"Tr", b"Ts"),
    }
)
MARK_OPENING = frozenset({b"BMC", b"BDC"})
COMPARE_DPI = 50
ORIGIN_TOLERANCE = 0.05
PROBE_REACH = 3.0

Glyph = tuple[str, float, float]


@dataclass
class TextState:
    ctm: pymupdf.Matrix = field(default_factory=lambda: pymupdf.Matrix(1, 0, 0, 1, 0, 0))
    line: pymupdf.Matrix = field(default_factory=lambda: pymupdf.Matrix(1, 0, 0, 1, 0, 0))
    size: float = 0.0
    scale: float = 100.0
    leading: float = 0.0
    render: int = 0
    in_text: bool = False
    saved: list[tuple] = field(default_factory=list)


def _number(token: Token) -> float | None:
    try:
        return float(token[2])
    except ValueError:
        return None


def _is_operator(token: Token) -> bool:
    text = token[2]
    if not text or text in NON_OPERATORS:
        return False
    first = text[:1]
    if first in (b"/", b"(", b"<", b"%"):
        return False
    return _number(token) is None


def _matrix(operands: list[Token]) -> pymupdf.Matrix | None:
    values = [_number(token) for token in operands[-6:]]
    if len(values) != 6 or any(value is None for value in values):
        return None
    return pymupdf.Matrix(*values)


def _apply(state: TextState, operator: bytes, operands: list[Token]) -> None:
    if operator == b"q":
        state.saved.append(
            (pymupdf.Matrix(state.ctm), state.size, state.scale, state.leading, state.render)
        )
    elif operator == b"Q":
        if state.saved:
            ctm, state.size, state.scale, state.leading, state.render = state.saved.pop()
            state.ctm = ctm
    elif operator == b"cm":
        matrix = _matrix(operands)
        if matrix is not None:
            state.ctm = matrix * state.ctm
    elif operator == b"BT":
        state.in_text = True
        state.line = pymupdf.Matrix(1, 0, 0, 1, 0, 0)
    elif operator == b"ET":
        state.in_text = False
    elif operator == b"Tm":
        matrix = _matrix(operands)
        if matrix is not None:
            state.line = matrix
    elif operator in (b"Td", b"TD"):
        values = [_number(token) for token in operands[-2:]]
        if len(values) == 2 and None not in values:
            if operator == b"TD":
                state.leading = -values[1]
            state.line = pymupdf.Matrix(1, 0, 0, 1, values[0], values[1]) * state.line
    elif operator in (b"T*", b"'", b'"'):
        state.line = pymupdf.Matrix(1, 0, 0, 1, 0, -state.leading) * state.line
    elif operator == b"Tf":
        value = _number(operands[-1]) if operands else None
        if value is not None:
            state.size = value
    elif operator == b"Tz":
        value = _number(operands[-1]) if operands else None
        if value is not None:
            state.scale = value
    elif operator == b"TL":
        value = _number(operands[-1]) if operands else None
        if value is not None:
            state.leading = value
    elif operator == b"Tr":
        value = _number(operands[-1]) if operands else None
        if value is not None:
            state.render = int(value)


def state_before(tokens: list[Token], stop: int) -> TextState:
    state = TextState()
    operands: list[Token] = []
    for token in tokens[:stop]:
        if _is_operator(token):
            _apply(state, token[2], operands)
            operands = []
        else:
            operands.append(token)
    return state


def _format(value: float) -> bytes:
    text = f"{value:.5f}".rstrip("0").rstrip(".")
    return (text if text not in ("", "-0") else "0").encode("ascii")


def _matrix_bytes(matrix: pymupdf.Matrix) -> bytes:
    return b" ".join(_format(value) for value in tuple(matrix))


def wrapped_chunk(chunk: bytes, ctm: pymupdf.Matrix) -> bytes | None:
    if abs(ctm.a * ctm.d - ctm.b * ctm.c) < 1e-9:
        return None
    if tuple(ctm) == (1.0, 0.0, 0.0, 1.0, 0.0, 0.0):
        return b"q\n" + chunk.strip() + b"\nQ\n"
    return b"q\n" + _matrix_bytes(~ctm) + b" cm\n" + chunk.strip() + b"\nQ\n"


class _Probe:
    def __init__(self, page: pymupdf.Page) -> None:
        self.page = page
        self.document = page.parent
        self.xref = self.document.get_new_xref()
        self.document.update_object(self.xref, "<<>>")
        self.pdf_to_page = page.transformation_matrix

    def load(self, data: bytes) -> None:
        self.document.update_stream(self.xref, data)
        self.document.xref_set_key(self.page.xref, "Contents", f"{self.xref} 0 R")

    def glyphs(
        self, data: bytes, clip: pymupdf.Rect | None = None, flags: int = GLYPH_FLAGS
    ) -> list[tuple[str, float, float]]:
        self.load(data)
        raw = self.page.get_text("rawdict", clip=clip, flags=flags)
        found: list[tuple[str, float, float]] = []
        for block in raw.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    for char in span.get("chars", []):
                        origin = char["origin"]
                        found.append((char["c"], float(origin[0]), float(origin[1])))
        return found

    def area(self, data: bytes) -> pymupdf.Rect | None:
        self.load(data)
        raw = self.page.get_text("rawdict", flags=GLYPH_FLAGS)
        boxes = [
            pymupdf.Rect(char["bbox"])
            for block in raw.get("blocks", [])
            for line in block.get("lines", [])
            for span in line.get("spans", [])
            for char in span.get("chars", [])
        ]
        if not boxes:
            return None
        covered = boxes[0]
        for box in boxes[1:]:
            covered |= box
        return covered

    def picture(self, data: bytes) -> pymupdf.Pixmap:
        self.load(data)
        return self.page.get_pixmap(dpi=COMPARE_DPI, annots=False)

    def painted(self, data: bytes) -> list[pymupdf.Rect]:
        self.load(data)
        boxes = [pymupdf.Rect(drawing["rect"]) for drawing in self.page.get_drawings()]
        boxes.extend(pymupdf.Rect(image["bbox"]) for image in self.page.get_image_info())
        return boxes

    def shows(self, data: bytes, glyph: Glyph, flags: int = GLYPH_FLAGS) -> bool:
        char, x, y = glyph
        clip = pymupdf.Rect(x - PROBE_REACH, y - PROBE_REACH, x + PROBE_REACH, y + PROBE_REACH)
        if _has_glyph(self.glyphs(data, clip, flags), glyph):
            return True
        return _has_glyph(self.glyphs(data, None, flags), glyph)


def _has_glyph(found: list[Glyph], glyph: Glyph) -> bool:
    char, x, y = glyph
    return any(
        item[0] == char
        and abs(item[1] - x) <= ORIGIN_TOLERANCE
        and abs(item[2] - y) <= ORIGIN_TOLERANCE
        for item in found
    )


def _first_true(count: int, test: Callable[[int], bool]) -> int | None:
    low, high = 0, count
    while low < high:
        middle = (low + high) // 2
        if test(middle):
            high = middle
        else:
            low = middle + 1
    return low if low < count else None


def _array_open(tokens: list[Token], closing: int) -> int | None:
    for index in range(closing - 1, -1, -1):
        if tokens[index][2] == b"[":
            return index
        if _is_operator(tokens[index]):
            return None
    return None


def _line_offset(probe: _Probe, state: TextState, before: bytes, after: bytes) -> float | None:
    earlier = {(c, round(x, 2), round(y, 2)) for c, x, y in probe.glyphs(before)}
    fresh = [
        (x, y) for c, x, y in probe.glyphs(after) if (c, round(x, 2), round(y, 2)) not in earlier
    ]
    if not fresh:
        return None
    try:
        to_line = ~(state.line * state.ctm)
    except (ValueError, ZeroDivisionError):
        return None
    to_pdf = ~probe.pdf_to_page
    offsets = [(pymupdf.Point(x, y) * to_pdf * to_line).x for x, y in fresh]
    return min(offsets)


def _restore_text(state: TextState, offset: float | None) -> bytes:
    restored = b"BT\n" + _matrix_bytes(state.line) + b" Tm\n"
    width = state.size * state.scale / 100
    if offset is not None and abs(offset) > 1e-4 and abs(width) > 1e-9:
        restored += b"[" + _format(-offset * 1000 / width) + b"]TJ\n"
    return restored


def _lead_shift(elements: list[Token], state: TextState) -> float:
    total = 0.0
    for token in elements:
        value = _number(token)
        if value is None:
            break
        total += value
    return total / 1000 * state.size * state.scale / 100


TEXT_DEFAULTS = b"0 Tr 0 Tc 0 Tw 100 Tz 0 Ts\n"


def _visible_insertion(
    probe: _Probe,
    data: bytes,
    tokens: list[Token],
    index: int,
    chunk: bytes,
    own: Glyph,
    after: bool,
) -> bytes | None:
    state = state_before(tokens, index + 1 if after else index)
    if state.in_text:
        return None
    insertion = wrapped_chunk(TEXT_DEFAULTS + chunk.strip(), state.ctm)
    if insertion is None:
        return None
    at = tokens[index][1] if after else tokens[index][0]
    placed = data[:at] + b"\n" + insertion + data[at:]
    return placed if probe.shows(placed, own, VISIBLE_FLAGS) else None


def _covers(
    probe: _Probe, data: bytes, tokens: list[Token], index: int, start: int, area: pymupdf.Rect
) -> bool:
    if any(tokens[between][2] == b"sh" for between in range(index, start)):
        return True
    earlier = probe.painted(data[: tokens[index][0]])
    for box in probe.painted(data[: tokens[start][0]]):
        if box in earlier:
            earlier.remove(box)
        elif box.intersects(area):
            return True
    return False


def _open_saves(tokens: list[Token], index: int) -> list[int]:
    saves: list[int] = []
    depth = 0
    for position in range(index - 1, -1, -1):
        operator = tokens[position][2]
        if operator == b"Q":
            depth += 1
        elif operator == b"q":
            if depth:
                depth -= 1
            else:
                saves.append(position)
    return saves


def _closing_restores(tokens: list[Token], index: int) -> list[int]:
    restores: list[int] = []
    depth = 0
    for position in range(index + 1, len(tokens)):
        operator = tokens[position][2]
        if operator == b"q":
            depth += 1
        elif operator == b"Q":
            depth -= 1
            if depth < -len(restores):
                restores.append(position)
    return restores


def _reopenable(operator: bytes, operands: list[bytes]) -> bool:
    if operator == b"BMC":
        return True
    if len(operands) < 2:
        return False
    tag, properties = operands[-2], operands[-1]
    if properties.startswith(b"<<"):
        return b"/MCID" not in properties
    return tag == b"/OC"


def _level_replay(
    data: bytes,
    tokens: list[Token],
    begin: int,
    end: int,
    reopen: Callable[[OpenTag], bytes | None],
) -> tuple[bytes, int] | None:
    replay: list[bytes | OpenTag | None] = []
    marks: list[int] = []
    path: list[bytes] = []
    clipping: bytes | None = None
    first = begin
    depth = 0
    for index in range(begin, end):
        token = tokens[index]
        if not _is_operator(token):
            continue
        operator = token[2]
        written = data[tokens[first][0] : token[1]]
        operands = [tokens[position][2] for position in range(first, index)]
        first = index + 1
        if operator in (b"BT", b"ET", b"BI"):
            if not depth and operator != b"BI":
                return None
            continue
        if operator in MARK_OPENING or operator == b"EMC":
            if depth:
                continue
            if operator == b"EMC":
                if not marks:
                    return None
                replay[marks.pop()] = None
            elif _reopenable(operator, operands):
                marks.append(len(replay))
                replay.append(written)
            elif operator == b"BDC" and len(operands) >= 2:
                marks.append(len(replay))
                replay.append(OpenTag(operands[-2], operands[-1]))
            else:
                return None
            continue
        if operator in (b"q", b"Q"):
            depth += 1 if operator == b"q" else -1
            continue
        if depth:
            continue
        if operator in STATE_SETTING:
            replay.append(written)
        elif operator in PATH_BUILDING:
            path.append(written)
        elif operator in CLIPPING:
            clipping = operator
        elif operator in PATH_ENDS:
            if clipping is not None:
                replay.append(b" ".join([*path, clipping, b"n"]))
            path, clipping = [], None
    resolved: list[bytes] = []
    for item in replay:
        if isinstance(item, OpenTag):
            item = reopen(item)
            if item is None:
                return None
        if item is not None:
            resolved.append(item)
    return b"\n".join(resolved), len(marks)


def _unchanged_outside(probe: _Probe, data: bytes, placed: bytes, area: pymupdf.Rect) -> bool:
    before, after = probe.picture(data), probe.picture(placed)
    if (before.width, before.height, before.n) != (after.width, after.height, after.n):
        return False
    box = area * (COMPARE_DPI / 72)
    left, top = max(0, int(box.x0) - 2), max(0, int(box.y0) - 2)
    right, bottom = min(before.width, int(box.x1) + 3), min(before.height, int(box.y1) + 3)
    stride, step = before.stride, before.n
    old, new = before.samples, after.samples
    for row in range(before.height):
        line = slice(row * stride, (row + 1) * stride)
        if old[line] == new[line]:
            continue
        if not top <= row < bottom:
            return False
        head = slice(row * stride, row * stride + left * step)
        tail = slice(row * stride + right * step, (row + 1) * stride)
        if old[head] != new[head] or old[tail] != new[tail]:
            return False
    return True


def _reenter(
    probe: _Probe,
    data: bytes,
    tokens: list[Token],
    start: int,
    chunk: bytes,
    own: Glyph,
    from_top: bool = False,
) -> bytes | None:
    levels = sorted(_open_saves(tokens, start))
    if from_top:
        levels = [-1, *levels]
    if not levels:
        return None
    replays: list[bytes] = []
    closings: list[bytes] = []
    reopener = MarkReopener(probe.page, data)
    for position, save in enumerate(levels):
        finish = levels[position + 1] if position + 1 < len(levels) else start
        level = _level_replay(data, tokens, save + 1, finish, reopener.reopen)
        if level is None:
            return None
        replay, marks = level
        replays.append(b"q\n" + replay + b"\n")
        closings.append(b"EMC\n" * marks + b"Q\n")
    outermost = state_before(tokens, max(levels[0], 0)).ctm
    insertion = wrapped_chunk(TEXT_DEFAULTS + chunk.strip(), outermost)
    area = probe.area(chunk)
    if insertion is None or area is None:
        return None
    at = tokens[start][0]
    closing = b"".join(reversed(closings))
    opening, ending = (b"q\n", b"\nQ\n") if from_top else (b"", b"")
    placed = (
        opening + data[:at] + b"\n" + closing + insertion + b"".join(replays) + data[at:] + ending
    )
    if not probe.shows(placed, own, VISIBLE_FLAGS):
        return None
    if not _unchanged_outside(probe, data, placed, area):
        return None
    reopener.commit()
    return placed


def _place_before_text(
    probe: _Probe, data: bytes, tokens: list[Token], chunk: bytes, own: Glyph
) -> bytes | None:
    start = next((index for index, token in enumerate(tokens) if token[2] == b"BT"), None)
    if start is None:
        return None
    candidates = [start, *_open_saves(tokens, start)][:CLIP_EXIT_TRIES]
    if candidates[-1] != 0:
        candidates.append(0)
    area: pymupdf.Rect | None = None
    for index in candidates:
        if any(tokens[between][2] in PAINTING for between in range(index, start)):
            area = area or probe.area(chunk)
            if area is None or _covers(probe, data, tokens, index, start, area):
                break
        placed = _visible_insertion(probe, data, tokens, index, chunk, own, after=False)
        if placed is not None:
            return placed
    return _reenter(probe, data, tokens, start, chunk, own) or _reenter(
        probe, data, tokens, start, chunk, own, from_top=True
    )


def _place_after_text_object(
    probe: _Probe, data: bytes, tokens: list[Token], show: int, chunk: bytes, own: Glyph
) -> bytes | None:
    end = next((index for index in range(show, len(tokens)) if tokens[index][2] == b"ET"), None)
    if end is None:
        return None
    for index in [end, *_closing_restores(tokens, end)][:MAX_LEVELS]:
        placed = _visible_insertion(probe, data, tokens, index, chunk, own, after=True)
        if placed is not None:
            return placed
    begin = next((index for index in range(show, -1, -1) if tokens[index][2] == b"BT"), None)
    if begin is None:
        return None
    return _visible_insertion(probe, data, tokens, begin, chunk, own, after=False)


def _split_inside_text(
    probe: _Probe,
    data: bytes,
    tokens: list[Token],
    show: int,
    anchor: Glyph,
    chunk: bytes,
    own: Glyph | None = None,
) -> bytes | None:
    state = state_before(tokens, show)
    if state.render >= 4:
        if own is None:
            return None
        return _place_after_text_object(probe, data, tokens, show, chunk, own)
    insertion = wrapped_chunk(chunk, state.ctm)
    if insertion is None:
        return None
    operator = tokens[show][2]
    if operator == b"TJ":
        opening = _array_open(tokens, show - 1)
        if opening is None:
            return None
        elements = tokens[opening + 1 : show - 1]
        head = data[: tokens[opening][0]]

        def drawn(count: int) -> bytes:
            parts = b" ".join(token[2] for token in elements[:count])
            return head + b"[" + parts + b"]TJ"

        cut = _first_true(len(elements), lambda k: probe.shows(drawn(k + 1), anchor))
        if cut is None:
            return None
        pre, post = elements[: cut + 1], elements[cut + 1 :]
    else:
        pre, post = [], []
        head = data[: tokens[show][1]]
    if any(_number(token) is None for token in post):
        before_post = head + b"[" + b" ".join(token[2] for token in pre) + b"]TJ"
        with_post = before_post + b" [" + b" ".join(token[2] for token in post) + b"]TJ"
        offset = _line_offset(probe, state, before_post, with_post)
        if offset is None:
            return None
        offset += _lead_shift(post, state)
        tail = b"[" + b" ".join(token[2] for token in post) + b"]TJ" + data[tokens[show][1] :]
        prefix = before_post if operator == b"TJ" else head
        return prefix + b"\nET\n" + insertion + _restore_text(state, offset) + tail
    rest_start = tokens[show][1]
    known, offset = _following_offset(probe, data, tokens, show, state)
    if not known:
        return None
    return (
        data[:rest_start] + b"\nET\n" + insertion + _restore_text(state, offset) + data[rest_start:]
    )


POSITIONING = frozenset({b"ET", b"Tm", b"Td", b"TD", b"T*", b"'", b'"'})


def _following_offset(
    probe: _Probe, data: bytes, tokens: list[Token], show: int, state: TextState
) -> tuple[bool, float | None]:
    rest_start = tokens[show][1]
    shift = 0.0
    for index in range(show + 1, len(tokens)):
        text = tokens[index][2]
        if text in POSITIONING:
            return True, None
        if text not in (b"Tj", b"TJ"):
            continue
        follow_state = state_before(tokens, index)
        elements: list[Token] = []
        if text == b"TJ":
            opening = _array_open(tokens, index - 1)
            if opening is None:
                return False, None
            elements = tokens[opening + 1 : index - 1]
        if text == b"TJ" and all(_number(token) is not None for token in elements):
            shift += _lead_shift(elements, follow_state)
            continue
        found = _line_offset(probe, state, data[:rest_start], data[: tokens[index][1]])
        if found is None:
            return False, None
        return True, found + shift + _lead_shift(elements, follow_state)
    return True, None


def place_in_order(
    page: pymupdf.Page, data: bytes, chunk: bytes, anchor: Glyph | None, own: Glyph | None = None
) -> bytes | None:
    tokens = content_tokens(data)
    probe = _Probe(page)
    if anchor is None:
        return _place_before_text(probe, data, tokens, chunk, own) if own else None
    paints = [index for index, token in enumerate(tokens) if token[2] in PAINTS]
    found = _first_true(len(paints), lambda k: probe.shows(data[: tokens[paints[k]][1]], anchor))
    if found is None:
        return None
    show = paints[found]
    state = state_before(tokens, show)
    if tokens[show][2] == b"Do" or not state.in_text:
        insertion = wrapped_chunk(chunk, state.ctm)
        if insertion is None:
            return None
        end = tokens[show][1]
        return data[:end] + b"\n" + insertion + data[end:]
    return _split_inside_text(probe, data, tokens, show, anchor, chunk, own)
