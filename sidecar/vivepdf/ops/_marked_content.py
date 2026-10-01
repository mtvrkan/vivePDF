import re
from collections.abc import Callable

WHITESPACE = b" \t\r\n\f\x00"
DELIMITERS = b"()<>[]{}/%"
TEXT_KEYS = (b"/ActualText", b"/Alt", b"/E")
INLINE_IMAGE_END = re.compile(rb"[ \t\r\n\f\x00]EI(?=[ \t\r\n\f\x00]|$)")
LITERAL_ESCAPES = {
    ord("n"): b"\n",
    ord("r"): b"\r",
    ord("t"): b"\t",
    ord("b"): b"\b",
    ord("f"): b"\f",
    ord("("): b"(",
    ord(")"): b")",
    ord("\\"): b"\\",
}


def _literal_end(data: bytes, start: int) -> int:
    depth = 0
    index = start
    while index < len(data):
        byte = data[index]
        if byte == 0x5C:
            index += 2
            continue
        if byte == 0x28:
            depth += 1
        elif byte == 0x29:
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return len(data)


def _literal_bytes(token: bytes) -> bytes:
    body = token[1:-1] if token.endswith(b")") else token[1:]
    out = bytearray()
    index = 0
    while index < len(body):
        byte = body[index]
        if byte != 0x5C or index + 1 >= len(body):
            out.append(byte)
            index += 1
            continue
        following = body[index + 1]
        if following in LITERAL_ESCAPES:
            out += LITERAL_ESCAPES[following]
            index += 2
        elif 0x30 <= following <= 0x37:
            digits = body[index + 1 : index + 4]
            count = next(
                (n for n, digit in enumerate(digits) if not 0x30 <= digit <= 0x37), len(digits)
            )
            out.append(int(digits[:count], 8) & 0xFF)
            index += 1 + count
        elif following == 0x0D:
            index += 3 if body[index + 2 : index + 3] == b"\n" else 2
        elif following == 0x0A:
            index += 2
        else:
            out.append(following)
            index += 2
    return bytes(out)


def _hex_bytes(token: bytes) -> bytes:
    digits = bytes(byte for byte in token[1:-1] if byte not in WHITESPACE)
    if len(digits) % 2:
        digits += b"0"
    try:
        return bytes.fromhex(digits.decode("ascii"))
    except ValueError:
        return b""


def decode_text(raw: bytes) -> str:
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", "replace")
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", "replace")
    return raw.decode("latin-1")


def encode_text(text: str) -> bytes:
    return b"<FEFF" + text.encode("utf-16-be").hex().upper().encode("ascii") + b">"


def _token_end(data: bytes, start: int) -> int:
    index = start
    while index < len(data) and data[index] not in WHITESPACE and data[index] not in DELIMITERS:
        index += 1
    return max(index, start + 1)


def text_strings(data: bytes, keys: tuple[bytes, ...] = TEXT_KEYS) -> list[tuple[int, int, str]]:
    found: list[tuple[int, int, str]] = []
    previous = b""
    depth = 0
    index = 0
    while index < len(data):
        byte = data[index]
        if byte in WHITESPACE:
            index += 1
            continue
        if byte == 0x25:
            newline = data.find(b"\n", index)
            index = len(data) if newline < 0 else newline + 1
            continue
        if data.startswith(b"<<", index) or data.startswith(b">>", index):
            depth += 1 if byte == 0x3C else -1
            previous = b""
            index += 2
            continue
        if byte in (0x28, 0x3C):
            end = _literal_end(data, index) if byte == 0x28 else data.find(b">", index) + 1
            end = end if end > index else len(data)
            token = data[index:end]
            if depth > 0 and previous in keys:
                raw = _literal_bytes(token) if byte == 0x28 else _hex_bytes(token)
                found.append((index, end, decode_text(raw)))
            previous = b""
            index = end
            continue
        if byte == 0x2F:
            end = _token_end(data, index + 1)
            previous = data[index:end]
            index = end
            continue
        end = _token_end(data, index)
        token = data[index:end]
        previous = b""
        if token == b"ID":
            closing = INLINE_IMAGE_END.search(data, end + 1)
            index = len(data) if closing is None else closing.end()
            continue
        index = end
    return found


def scrub_marked_content(
    data: bytes, scrub: Callable[[str], str], keys: tuple[bytes, ...] = TEXT_KEYS
) -> tuple[bytes, int]:
    if not any(key in data for key in keys):
        return data, 0
    pieces: list[bytes] = []
    last = 0
    count = 0
    for start, end, text in text_strings(data, keys):
        cleaned = scrub(text)
        if cleaned == text:
            continue
        pieces += [data[last:start], encode_text(cleaned)]
        last = end
        count += 1
    if not count:
        return data, 0
    pieces.append(data[last:])
    return b"".join(pieces), count
