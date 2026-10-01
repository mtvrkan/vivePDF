import re
from dataclasses import dataclass
from typing import Any

from vivepdf.ops._js_values import ScriptError, ScriptLimit

MAX_SOURCE = 256 * 1024
KEYWORDS = frozenset(
    {
        "break",
        "case",
        "catch",
        "const",
        "continue",
        "default",
        "delete",
        "do",
        "else",
        "false",
        "finally",
        "for",
        "function",
        "if",
        "in",
        "instanceof",
        "let",
        "new",
        "null",
        "return",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "typeof",
        "var",
        "void",
        "while",
        "with",
    }
)
PUNCTUATORS = tuple(
    sorted(
        {
            ">>>=",
            "===",
            "!==",
            ">>>",
            "<<=",
            ">>=",
            "==",
            "!=",
            "<=",
            ">=",
            "&&",
            "||",
            "++",
            "--",
            "+=",
            "-=",
            "*=",
            "/=",
            "%=",
            "&=",
            "|=",
            "^=",
            "<<",
            ">>",
            *"{}()[];,.?:<>+-*/%!=&|^~",
        },
        key=len,
        reverse=True,
    )
)
LINE_BREAKS = frozenset("\n\r\u2028\u2029")
ESCAPES = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
NUMBER = re.compile(r"0[xX][0-9a-fA-F]+|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
HEX_DIGITS = re.compile(r"[0-9a-fA-F]+")
VALUE_KEYWORDS = frozenset({"this", "true", "false", "null"})
VALUE_ENDS = frozenset({")", "]", "}", "++", "--"})


@dataclass(frozen=True, slots=True)
class Token:
    kind: str
    value: Any
    newline: bool


def _identifier_start(character: str) -> bool:
    return character.isalpha() or character in "_$"


def _identifier_part(character: str) -> bool:
    return character.isalnum() or character in "_$"


def _number(source: str, index: int) -> tuple[float, int]:
    match = NUMBER.match(source, index)
    if match is None:
        raise ScriptError("bad number")
    text = match.group(0)
    end = match.end()
    if end < len(source) and _identifier_start(source[end]):
        raise ScriptError("bad number")
    value = float(int(text, 16)) if text[:2] in ("0x", "0X") else float(text)
    return value, end


def _hex_escape(source: str, index: int, width: int) -> tuple[str, int]:
    digits = source[index : index + width]
    if len(digits) != width or not HEX_DIGITS.fullmatch(digits):
        raise ScriptError("bad escape")
    return chr(int(digits, 16)), index + width


def _string(source: str, index: int) -> tuple[str, int]:
    quote = source[index]
    index += 1
    parts: list[str] = []
    while True:
        if index >= len(source) or source[index] in LINE_BREAKS:
            raise ScriptError("unterminated string")
        character = source[index]
        if character == quote:
            return "".join(parts), index + 1
        if character != "\\":
            parts.append(character)
            index += 1
            continue
        if index + 1 >= len(source):
            raise ScriptError("unterminated string")
        escaped = source[index + 1]
        index += 2
        if escaped == "x":
            text, index = _hex_escape(source, index, 2)
        elif escaped == "u":
            text, index = _hex_escape(source, index, 4)
        elif escaped in LINE_BREAKS:
            if escaped == "\r" and source.startswith("\n", index):
                index += 1
            text = ""
        else:
            text = ESCAPES.get(escaped, escaped)
        parts.append(text)


def _comment_end(source: str, index: int) -> tuple[int, bool]:
    if source.startswith("//", index):
        end = index
        while end < len(source) and source[end] not in LINE_BREAKS:
            end += 1
        return end, False
    end = source.find("*/", index + 2)
    if end < 0:
        raise ScriptError("unterminated comment")
    return end + 2, any(character in LINE_BREAKS for character in source[index:end])


def _regexp_allowed(previous: Token | None) -> bool:
    if previous is None:
        return True
    if previous.kind in ("number", "string", "name", "regexp"):
        return False
    if previous.kind == "keyword":
        return previous.value not in VALUE_KEYWORDS
    return previous.value not in VALUE_ENDS


def _regexp(source: str, index: int) -> tuple[tuple[str, str], int]:
    start = index + 1
    index = start
    in_class = False
    while True:
        if index >= len(source) or source[index] in LINE_BREAKS:
            raise ScriptError("unterminated regular expression")
        character = source[index]
        if character == "\\":
            if index + 1 >= len(source) or source[index + 1] in LINE_BREAKS:
                raise ScriptError("unterminated regular expression")
            index += 2
            continue
        if character == "[":
            in_class = True
        elif character == "]":
            in_class = False
        elif character == "/" and not in_class:
            break
        index += 1
    body = source[start:index]
    end = index + 1
    while end < len(source) and _identifier_part(source[end]):
        end += 1
    return (body, source[index + 1 : end]), end


def _punctuator(source: str, index: int) -> str:
    for punctuator in PUNCTUATORS:
        if source.startswith(punctuator, index):
            return punctuator
    raise ScriptError(f"unexpected character {source[index]!r}")


def tokenize(source: str) -> list[Token]:
    if len(source) > MAX_SOURCE:
        raise ScriptLimit("script too long")
    tokens: list[Token] = []
    index = 0
    newline = False
    while index < len(source):
        character = source[index]
        if character in LINE_BREAKS:
            newline = True
            index += 1
            continue
        if character.isspace() or character == "\ufeff":
            index += 1
            continue
        if source.startswith(("//", "/*"), index):
            index, crossed = _comment_end(source, index)
            newline = newline or crossed
            continue
        if "0" <= character <= "9" or (
            character == "." and index + 1 < len(source) and "0" <= source[index + 1] <= "9"
        ):
            value, index = _number(source, index)
            tokens.append(Token("number", value, newline))
        elif character in "\"'":
            text, index = _string(source, index)
            tokens.append(Token("string", text, newline))
        elif character == "/" and _regexp_allowed(tokens[-1] if tokens else None):
            literal, index = _regexp(source, index)
            tokens.append(Token("regexp", literal, newline))
        elif _identifier_start(character):
            end = index + 1
            while end < len(source) and _identifier_part(source[end]):
                end += 1
            word = source[index:end]
            tokens.append(Token("keyword" if word in KEYWORDS else "name", word, newline))
            index = end
        else:
            punctuator = _punctuator(source, index)
            tokens.append(Token("punct", punctuator, newline))
            index += len(punctuator)
        newline = False
    tokens.append(Token("end", None, newline))
    return tokens
