import re
from dataclasses import dataclass, field
from typing import Any

import pymupdf

DELIMITERS = b"()<>[]{}/%"
WHITESPACE = b" \t\r\n\f\x00"
MAX_DEPTH = 64
ESCAPES = {
    ord("n"): b"\n",
    ord("r"): b"\r",
    ord("t"): b"\t",
    ord("b"): b"\b",
    ord("f"): b"\f",
    ord("("): b"(",
    ord(")"): b")",
    ord("\\"): b"\\",
}
INTEGER = re.compile(rb"[+-]?\d+")
REAL = re.compile(rb"[+-]?(?:\d+\.\d*|\.\d+|\d+)")
OBJECT_HEADER = re.compile(rb"(?<![0-9])(\d+)\s+(\d+)\s+obj\b")


class PdfName(str):
    pass


class PdfString(str):
    raw: bytes = b""


class PdfKeyword(str):
    pass


@dataclass(frozen=True)
class PdfRef:
    number: int
    generation: int = 0


@dataclass
class PdfStream:
    dictionary: dict[str, Any]
    data: bytes = b""
    filtered: bool = field(default=False)


def decode_text(raw: bytes) -> str:
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", errors="replace")
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", errors="replace")
    return raw.decode("latin-1")


def make_string(raw: bytes) -> PdfString:
    text = PdfString(decode_text(raw))
    text.raw = raw
    return text


def text_string(value: str) -> PdfString:
    raw = value.encode("latin-1") if value.isascii() else b"\xfe\xff" + value.encode("utf-16-be")
    return make_string(raw)


class PdfSyntaxReader:
    def __init__(self, data: bytes, index: int = 0) -> None:
        self.data = data
        self.index = index

    def skip(self) -> None:
        data = self.data
        while self.index < len(data):
            byte = data[self.index]
            if byte in WHITESPACE:
                self.index += 1
            elif byte == ord("%"):
                while self.index < len(data) and data[self.index] not in b"\r\n":
                    self.index += 1
            else:
                return

    def _word(self) -> bytes:
        data = self.data
        start = self.index
        while (
            self.index < len(data)
            and data[self.index] not in WHITESPACE
            and data[self.index] not in DELIMITERS
        ):
            self.index += 1
        return data[start : self.index]

    def value(self, depth: int = 0) -> Any:
        if depth > MAX_DEPTH:
            raise ValueError("objects nested too deeply")
        self.skip()
        data = self.data
        if self.index >= len(data):
            raise ValueError("unexpected end")
        byte = data[self.index]
        if data.startswith(b"<<", self.index):
            self.index += 2
            result: dict[str, Any] = {}
            while True:
                self.skip()
                if self.index >= len(data):
                    raise ValueError("unterminated dictionary")
                if data.startswith(b">>", self.index):
                    self.index += 2
                    return result
                key = self.value(depth + 1)
                if not isinstance(key, PdfName):
                    raise ValueError("dictionary key is not a name")
                result[str(key)] = self.value(depth + 1)
        if byte == ord("["):
            self.index += 1
            items: list[Any] = []
            while True:
                self.skip()
                if self.index >= len(data):
                    raise ValueError("unterminated array")
                if data[self.index] == ord("]"):
                    self.index += 1
                    return items
                items.append(self.value(depth + 1))
        if byte == ord("("):
            return make_string(self._literal())
        if byte == ord("<"):
            end = data.find(b">", self.index)
            if end < 0:
                raise ValueError("unterminated hex string")
            digits = re.sub(rb"\s", b"", data[self.index + 1 : end])
            self.index = end + 1
            if len(digits) % 2:
                digits += b"0"
            try:
                return make_string(bytes.fromhex(digits.decode("ascii")))
            except ValueError as error:
                raise ValueError("bad hex string") from error
        if byte == ord("/"):
            self.index += 1
            raw = self._word()
            raw = re.sub(rb"#([0-9A-Fa-f]{2})", lambda match: bytes.fromhex(match[1].decode()), raw)
            return PdfName(raw.decode("utf-8", errors="replace"))
        word = self._word()
        if not word:
            raise ValueError("unexpected delimiter")
        if word in (b"true", b"false"):
            return word == b"true"
        if word == b"null":
            return None
        if INTEGER.fullmatch(word):
            number = int(word)
            reference = self._reference(number)
            return reference if reference is not None else number
        if REAL.fullmatch(word):
            return float(word)
        return PdfKeyword(word.decode("latin-1"))

    def _reference(self, number: int) -> PdfRef | None:
        saved = self.index
        self.skip()
        generation = self._word()
        if INTEGER.fullmatch(generation or b"x"):
            self.skip()
            if self.data.startswith(b"R", self.index) and (
                self.index + 1 >= len(self.data)
                or self.data[self.index + 1] in WHITESPACE + DELIMITERS
            ):
                self.index += 1
                return PdfRef(number, int(generation))
        self.index = saved
        return None

    def _literal(self) -> bytes:
        data = self.data
        self.index += 1
        depth = 1
        output = bytearray()
        while self.index < len(data):
            byte = data[self.index]
            if byte == ord("\\"):
                self.index += 1
                following = data[self.index] if self.index < len(data) else 0
                if following in ESCAPES:
                    output += ESCAPES[following]
                    self.index += 1
                elif ord("0") <= following <= ord("7"):
                    digits = re.match(rb"[0-7]{1,3}", data[self.index : self.index + 3])
                    output.append(int(digits[0], 8) & 0xFF)
                    self.index += len(digits[0])
                elif following in b"\r\n":
                    self.index += 1
                    if following == ord("\r") and data[self.index : self.index + 1] == b"\n":
                        self.index += 1
                else:
                    self.index += 1
                continue
            if byte == ord("("):
                depth += 1
            elif byte == ord(")"):
                depth -= 1
                if depth == 0:
                    self.index += 1
                    return bytes(output)
            output.append(byte)
            self.index += 1
        raise ValueError("unterminated string")


def parse_value(data: bytes) -> Any:
    return PdfSyntaxReader(data).value()


def read_objects(data: bytes) -> dict[int, Any]:
    objects: dict[int, Any] = {}
    position = 0
    while True:
        match = OBJECT_HEADER.search(data, position)
        if match is None:
            return objects
        reader = PdfSyntaxReader(data, match.end())
        try:
            value = reader.value()
        except (ValueError, IndexError):
            position = match.end()
            continue
        reader.skip()
        if isinstance(value, dict) and data.startswith(b"stream", reader.index):
            start = reader.index + len(b"stream")
            if data.startswith(b"\r\n", start):
                start += 2
            elif data[start : start + 1] in (b"\n", b"\r"):
                start += 1
            length = value.get("Length")
            end = start + length if isinstance(length, int) and length >= 0 else -1
            if end < 0 or end > len(data) or not re.match(rb"\s*endstream", data[end : end + 20]):
                end = data.find(b"endstream", start)
                if end < 0:
                    position = start
                    continue
                if data[end - 2 : end] == b"\r\n":
                    end -= 2
                elif data[end - 1 : end] in (b"\n", b"\r"):
                    end -= 1
            value = PdfStream(value, data[start:end])
            reader.index = end
        objects[int(match.group(1))] = value
        position = max(reader.index, match.end())


def trailer_root(data: bytes) -> PdfRef | None:
    marker = data.rfind(b"trailer")
    if marker < 0:
        return None
    try:
        trailer = PdfSyntaxReader(data, marker + len(b"trailer")).value()
    except (ValueError, IndexError):
        return None
    root = trailer.get("Root") if isinstance(trailer, dict) else None
    return root if isinstance(root, PdfRef) else None


def _format_number(value: float) -> bytes:
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    return ("0" if text in ("", "-0") else text).encode("ascii")


def encode_name(text: str) -> bytes:
    encoded = []
    for byte in text.encode("utf-8"):
        if byte < 0x21 or byte > 0x7E or byte in DELIMITERS or byte == ord("#"):
            encoded.append(f"#{byte:02X}".encode("ascii"))
        else:
            encoded.append(bytes([byte]))
    return b"/" + b"".join(encoded)


def encode_string(value: str) -> bytes:
    raw = value.raw if isinstance(value, PdfString) and value.raw else None
    if raw is None:
        if value.isascii():
            escaped = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            escaped = escaped.replace("\r", "\\r").replace("\n", "\\n")
            return b"(" + escaped.encode("ascii") + b")"
        raw = b"\xfe\xff" + value.encode("utf-16-be")
    return b"<" + raw.hex().upper().encode("ascii") + b">"


def serialize(value: Any) -> bytes:
    if value is None:
        return b"null"
    if isinstance(value, bool):
        return b"true" if value else b"false"
    if isinstance(value, PdfName):
        return encode_name(value)
    if isinstance(value, PdfKeyword):
        return value.encode("latin-1", errors="replace")
    if isinstance(value, str):
        return encode_string(value)
    if isinstance(value, int):
        return str(value).encode("ascii")
    if isinstance(value, float):
        return _format_number(value)
    if isinstance(value, PdfRef):
        return f"{value.number} {value.generation} R".encode("ascii")
    if isinstance(value, list):
        return b"[" + b" ".join(serialize(item) for item in value) + b"]"
    if isinstance(value, dict):
        return (
            b"<<"
            + b"".join(
                encode_name(key) + b" " + serialize(item) + b" " for key, item in value.items()
            )
            + b">>"
        )
    raise ValueError(f"cannot serialize {type(value).__name__}")


def load_object(document: pymupdf.Document, xref: int) -> Any:
    source = document.xref_object(xref, compressed=True).encode("latin-1", errors="replace")
    value = parse_value(source)
    if isinstance(value, dict) and document.xref_is_stream(xref):
        return PdfStream(value, document.xref_stream_raw(xref) or b"")
    return value


def is_page_object(value: Any) -> bool:
    body = value.dictionary if isinstance(value, PdfStream) else value
    return isinstance(body, dict) and body.get("Type") in ("Page", "Pages", "Catalog")


def create_object(document: pymupdf.Document, value: Any) -> int:
    xref = document.get_new_xref()
    write_object(document, xref, value)
    return xref


def write_object(document: pymupdf.Document, xref: int, value: Any) -> None:
    if not isinstance(value, PdfStream):
        document.update_object(xref, serialize(value).decode("latin-1"))
        return
    dictionary = {key: item for key, item in value.dictionary.items() if key != "Length"}
    if value.filtered:
        dictionary.pop("Filter", None)
        dictionary.pop("DecodeParms", None)
    document.update_object(xref, serialize(dictionary).decode("latin-1"))
    document.update_stream(xref, value.data, compress=value.filtered)
    for key in ("Filter", "DecodeParms"):
        if key in dictionary:
            document.xref_set_key(xref, key, serialize(dictionary[key]).decode("latin-1"))
