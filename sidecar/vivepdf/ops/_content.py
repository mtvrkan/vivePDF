from collections.abc import Callable

WHITESPACE = b"\x00\t\n\x0c\r "
DELIMITERS = b"()<>[]{}/%"

Token = tuple[int, int, bytes]
Span = tuple[int, int]


def _skip_regular(data: bytes, position: int) -> int:
    size = len(data)
    while position < size and data[position] not in WHITESPACE and data[position] not in DELIMITERS:
        position += 1
    return position


def _skip_literal(data: bytes, position: int) -> int:
    size = len(data)
    depth = 0
    while position < size:
        byte = data[position]
        if byte == 0x5C:
            position += 2
            continue
        if byte == 0x28:
            depth += 1
        elif byte == 0x29:
            depth -= 1
            if depth == 0:
                return position + 1
        position += 1
    return size


def _skip_dictionary(data: bytes, position: int) -> int:
    size = len(data)
    depth = 0
    while position < size:
        if data[position] == 0x28:
            position = _skip_literal(data, position)
            continue
        pair = data[position : position + 2]
        if pair == b"<<":
            depth += 1
            position += 2
            continue
        if pair == b">>":
            depth -= 1
            position += 2
            if depth == 0:
                return position
            continue
        position += 1
    return size


def _skip_inline_image(data: bytes, position: int) -> int:
    size = len(data)
    while position < size:
        found = data.find(b"EI", position)
        if found < 0:
            return size
        before = data[found - 1] if found else 0x20
        after = data[found + 2] if found + 2 < size else 0x20
        if before in WHITESPACE and (after in WHITESPACE or after in DELIMITERS):
            return found + 2
        position = found + 2
    return size


def content_tokens(data: bytes) -> list[Token]:
    tokens: list[Token] = []
    position = 0
    size = len(data)
    while position < size:
        byte = data[position]
        if byte in WHITESPACE:
            position += 1
            continue
        if byte == 0x25:
            found = data.find(b"\n", position)
            position = size if found < 0 else found + 1
            continue
        start = position
        if byte == 0x28:
            position = _skip_literal(data, position)
        elif data[position : position + 2] == b"<<":
            position = _skip_dictionary(data, position)
        elif byte == 0x3C:
            found = data.find(b">", position)
            position = size if found < 0 else found + 1
        elif byte in b"[]{}>":
            position += 1
        elif byte == 0x2F:
            position = _skip_regular(data, position + 1)
        else:
            position = _skip_regular(data, position)
            if position == start:
                position += 1
        text = data[start:position]
        tokens.append((start, position, text))
        if text == b"BI":
            position = _skip_inline_image(data, position)
    return tokens


def _closing_mark(tokens: list[Token], opening: int) -> int | None:
    depth = 1
    for index in range(opening + 1, len(tokens)):
        text = tokens[index][2]
        if text in (b"BDC", b"BMC"):
            depth += 1
        elif text == b"EMC":
            depth -= 1
            if depth == 0:
                return index
    return None


def marked_blocks(
    tokens: list[Token], wanted: Callable[[bytes, bytes], bool]
) -> list[tuple[Span, Span]]:
    blocks: list[tuple[Span, Span]] = []
    for index, (_start, end, text) in enumerate(tokens):
        if text != b"BDC" or index < 2 or not wanted(tokens[index - 2][2], tokens[index - 1][2]):
            continue
        closing = _closing_mark(tokens, index)
        if closing is None:
            continue
        blocks.append(((tokens[index - 2][0], end), (tokens[closing][0], tokens[closing][1])))
    return blocks


def marked_spans(tokens: list[Token], wanted: Callable[[bytes, bytes], bool]) -> list[Span]:
    return [(opening[0], closing[1]) for opening, closing in marked_blocks(tokens, wanted)]


def invocation_spans(tokens: list[Token], names: set[bytes]) -> list[Span]:
    return [
        (tokens[index - 1][0], end)
        for index, (_start, end, text) in enumerate(tokens)
        if text == b"Do" and index and tokens[index - 1][2] in names
    ]


def merge_spans(spans: list[Span]) -> list[Span]:
    merged: list[Span] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
            continue
        merged.append((start, end))
    return merged


def cut_spans(data: bytes, spans: list[Span]) -> bytes:
    kept = bytearray()
    position = 0
    for start, end in merge_spans(spans):
        kept += data[position:start]
        position = end
    kept += data[position:]
    return bytes(kept)


def join_streams(pieces: list[bytes]) -> bytes:
    return b"\n".join(pieces)


def cut_pieces(pieces: list[bytes], spans: list[Span]) -> list[bytes]:
    merged = merge_spans(spans)
    result: list[bytes] = []
    offset = 0
    for piece in pieces:
        end = offset + len(piece)
        local = [
            (max(start, offset) - offset, min(stop, end) - offset)
            for start, stop in merged
            if start < end and stop > offset
        ]
        result.append(cut_spans(piece, local))
        offset = end + 1
    return result
