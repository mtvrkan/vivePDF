import re
from collections.abc import Callable
from typing import Any

from vivepdf.ops._js_values import (
    MAX_STRING,
    UNDEFINED,
    JSArray,
    JSObject,
    ScriptError,
    ScriptLimit,
    allocate,
    checked_string,
    to_integer,
    to_string,
)

MAX_PROGRAM = 20_000
MAX_GROUPS = 500
MAX_PATTERN_DEPTH = 32
MAX_REPEAT_DIGITS = 9
FLAGS = "gim"
LINE_TERMINATORS = frozenset("\n\r\u2028\u2029")
WHITESPACE = frozenset(
    "\t\n\v\f\r \u00a0\u1680\u180e\u2028\u2029\u202f\u205f\u3000\ufeff"
    + "".join(chr(code) for code in range(0x2000, 0x200B))
)
WORD = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")
DIGIT = frozenset("0123456789")
CLASS_ESCAPES = {
    "d": (DIGIT, False),
    "D": (DIGIT, True),
    "s": (WHITESPACE, False),
    "S": (WHITESPACE, True),
    "w": (WORD, False),
    "W": (WORD, True),
}
CONTROL_ESCAPES = {"t": "\t", "n": "\n", "v": "\v", "f": "\f", "r": "\r"}
OCTAL = "01234567"
BRACE = re.compile(r"\{([0-9]+)(?:(,)([0-9]*))?\}")
HEX = re.compile(r"[0-9a-fA-F]+")
READ_ONLY = frozenset({"source", "global", "ignoreCase", "multiline"})

Step = Callable[[], None]
Slots = tuple[int | None, ...]


class PatternError(ScriptError):
    pass


def canonical(character: str) -> str:
    upper = character.upper()
    if len(upper) != 1 or (ord(character) >= 128 and ord(upper) < 128):
        return character
    return upper


def _count_groups(source: str) -> int:
    count = 0
    index = 0
    in_class = False
    while index < len(source):
        character = source[index]
        if character == "\\":
            index += 2
            continue
        if character == "[":
            in_class = True
        elif character == "]":
            in_class = False
        elif character == "(" and not in_class and not source.startswith("(?", index):
            count += 1
        index += 1
    return count


def _bounded(digits: str) -> int:
    return int(digits) if len(digits) <= MAX_REPEAT_DIGITS else 10**MAX_REPEAT_DIGITS


class _PatternParser:
    def __init__(self, source: str) -> None:
        self.source = source
        self.index = 0
        self.depth = 0
        self.groups = 0
        self.total_groups = _count_groups(source)
        if self.total_groups > MAX_GROUPS:
            raise ScriptLimit("regular expression has too many groups")

    def parse(self) -> tuple:
        node = self.disjunction()
        if self.index < len(self.source):
            raise PatternError("unmatched ')' in regular expression")
        return node

    def peek(self) -> str:
        return self.source[self.index] if self.index < len(self.source) else ""

    def disjunction(self) -> tuple:
        self.depth += 1
        if self.depth > MAX_PATTERN_DEPTH:
            raise ScriptLimit("regular expression nested too deeply")
        options = [self.alternative()]
        while self.peek() == "|":
            self.index += 1
            options.append(self.alternative())
        self.depth -= 1
        return options[0] if len(options) == 1 else ("alt", options)

    def alternative(self) -> tuple:
        items = []
        while self.index < len(self.source) and self.peek() not in "|)":
            items.append(self.term())
        return ("seq", items)

    def close(self) -> None:
        if self.peek() != ")":
            raise PatternError("unterminated group in regular expression")
        self.index += 1

    def term(self) -> tuple:
        character = self.peek()
        if character in ("^", "$"):
            self.index += 1
            return ("assert", character)
        if self.source.startswith(("\\b", "\\B"), self.index):
            self.index += 2
            return ("assert", self.source[self.index - 1])
        if self.source.startswith(("(?=", "(?!"), self.index):
            positive = self.source[self.index + 2] == "="
            self.index += 3
            node = self.disjunction()
            self.close()
            return ("look", positive, node)
        return self.quantified(self.atom())

    def brace(self, index: int) -> tuple[int, int | None, int] | None:
        match = BRACE.match(self.source, index)
        if match is None:
            return None
        low = _bounded(match[1])
        if match[2] is None:
            high: int | None = low
        else:
            high = _bounded(match[3]) if match[3] else None
        return low, high, match.end()

    def quantified(self, atom: tuple) -> tuple:
        character = self.peek()
        if character in ("*", "+", "?"):
            self.index += 1
            low, high = {"*": (0, None), "+": (1, None), "?": (0, 1)}[character]
        elif character == "{":
            bounds = self.brace(self.index)
            if bounds is None:
                return atom
            low, high, self.index = bounds
        else:
            return atom
        greedy = True
        if self.peek() == "?":
            self.index += 1
            greedy = False
        if high is not None and high < low:
            raise PatternError("numbers out of order in quantifier")
        return ("repeat", atom, low, high, greedy)

    def atom(self) -> tuple:
        character = self.peek()
        self.index += 1
        if character == ".":
            return ("any",)
        if character == "(":
            if self.source.startswith("?:", self.index):
                self.index += 2
                node = self.disjunction()
                self.close()
                return node
            self.groups += 1
            number = self.groups
            node = self.disjunction()
            self.close()
            return ("group", number, node)
        if character == "[":
            return self.character_class()
        if character == "\\":
            return self.atom_escape()
        if character in ("*", "+", "?") or (
            character == "{" and self.brace(self.index - 1) is not None
        ):
            raise PatternError("nothing to repeat in regular expression")
        return ("char", character)

    def escaped(self) -> str:
        if self.index >= len(self.source):
            raise PatternError("\\ at end of regular expression")
        character = self.source[self.index]
        self.index += 1
        return character

    def octal(self, first: str) -> str:
        digits = first
        while (
            len(digits) < 3
            and self.peek() in OCTAL
            and self.peek()
            and int(digits + self.peek(), 8) <= 0o377
        ):
            digits += self.peek()
            self.index += 1
        return chr(int(digits, 8))

    def hex_escape(self, width: int) -> str | None:
        digits = self.source[self.index : self.index + width]
        if len(digits) != width or not HEX.fullmatch(digits):
            return None
        self.index += width
        return chr(int(digits, 16))

    def character_escape(self, character: str) -> str:
        if character in CONTROL_ESCAPES:
            return CONTROL_ESCAPES[character]
        if character == "c":
            letter = self.peek()
            if letter.isascii() and letter.isalpha():
                self.index += 1
                return chr(ord(letter) % 32)
            self.index -= 1
            return "\\"
        if character in ("x", "u"):
            value = self.hex_escape(2 if character == "x" else 4)
            return character if value is None else value
        if character in OCTAL:
            return self.octal(character)
        return character

    def atom_escape(self) -> tuple:
        character = self.escaped()
        if character in CLASS_ESCAPES:
            return ("class", False, [], [character])
        if character in "123456789":
            end = self.index
            while end < len(self.source) and self.source[end] in DIGIT:
                end += 1
            number = _bounded(self.source[self.index - 1 : end])
            if number <= self.total_groups:
                self.index = end
                return ("backref", number)
        return ("char", self.character_escape(character))

    def class_atom(self) -> tuple[str, str]:
        character = self.peek()
        self.index += 1
        if character != "\\":
            return ("char", character)
        escaped = self.escaped()
        if escaped in CLASS_ESCAPES:
            return ("escape", escaped)
        if escaped == "b":
            return ("char", "\b")
        return ("char", self.character_escape(escaped))

    def character_class(self) -> tuple:
        negated = self.peek() == "^"
        if negated:
            self.index += 1
        ranges: list[tuple[int, int]] = []
        escapes: list[str] = []

        def add(item: tuple[str, str]) -> None:
            if item[0] == "escape":
                escapes.append(item[1])
            else:
                ranges.append((ord(item[1]), ord(item[1])))

        while True:
            if self.index >= len(self.source):
                raise PatternError("unterminated character class")
            if self.peek() == "]":
                self.index += 1
                return ("class", negated, ranges, escapes)
            first = self.class_atom()
            if (
                self.peek() == "-"
                and self.index + 1 < len(self.source)
                and self.source[self.index + 1] != "]"
            ):
                self.index += 1
                last = self.class_atom()
                if first[0] == "char" and last[0] == "char":
                    if ord(first[1]) > ord(last[1]):
                        raise PatternError("range out of order in character class")
                    ranges.append((ord(first[1]), ord(last[1])))
                else:
                    add(first)
                    add(("char", "-"))
                    add(last)
                continue
            add(first)


def _group_numbers(node: tuple, found: list[int]) -> None:
    kind = node[0]
    if kind == "group":
        found.append(node[1])
        _group_numbers(node[2], found)
    elif kind in ("seq", "alt"):
        for child in node[1]:
            _group_numbers(child, found)
    elif kind == "look":
        _group_numbers(node[2], found)
    elif kind == "repeat":
        _group_numbers(node[1], found)


def _class_matcher(
    negated: bool, ranges: list[tuple[int, int]], escapes: list[str], ignore_case: bool
) -> Callable[[str], bool]:
    def contains(character: str) -> bool:
        code = ord(character)
        for low, high in ranges:
            if low <= code <= high:
                return True
        for letter in escapes:
            members, inverted = CLASS_ESCAPES[letter]
            if (character in members) != inverted:
                return True
        return False

    def test(character: str) -> bool:
        found = contains(character)
        if not found and ignore_case:
            for variant in (character.upper(), character.lower()):
                if len(variant) == 1 and variant != character and contains(variant):
                    found = True
                    break
        return found != negated

    return test


class _Compiler:
    def __init__(self, ignore_case: bool) -> None:
        self.ignore_case = ignore_case
        self.program: list[tuple] = []
        self.registers = 0

    def emit(self, instruction: tuple | None) -> int:
        if len(self.program) >= MAX_PROGRAM:
            raise ScriptLimit("regular expression too large")
        self.program.append(instruction or ("jmp", 0))
        return len(self.program) - 1

    def register(self) -> int:
        self.registers += 1
        return self.registers - 1

    def node(self, node: tuple) -> None:
        kind = node[0]
        if kind == "char":
            self.emit(("char", canonical(node[1]) if self.ignore_case else node[1]))
        elif kind == "any":
            self.emit(("any",))
        elif kind == "class":
            self.emit(("class", _class_matcher(node[1], node[2], node[3], self.ignore_case)))
        elif kind == "seq":
            for item in node[1]:
                self.node(item)
        elif kind == "alt":
            self.alternation(node[1])
        elif kind == "group":
            self.emit(("save", 2 * node[1]))
            self.node(node[2])
            self.emit(("save", 2 * node[1] + 1))
        elif kind == "assert":
            self.emit(("assert", node[1]))
        elif kind == "backref":
            self.emit(("backref", node[1]))
        elif kind == "look":
            look = self.emit(None)
            self.node(node[2])
            self.emit(("accept",))
            self.program[look] = ("look", node[1], look + 1, len(self.program))
        else:
            self.repeat(node)

    def alternation(self, options: list[tuple]) -> None:
        jumps = []
        for option in options[:-1]:
            split = self.emit(None)
            self.node(option)
            jumps.append(self.emit(None))
            self.program[split] = ("split", split + 1, len(self.program))
        self.node(options[-1])
        for jump in jumps:
            self.program[jump] = ("jmp", len(self.program))

    def iteration(self, body: tuple, groups: list[int]) -> None:
        if groups:
            self.emit(("reset", 2 * min(groups), 2 * max(groups) + 2))
        self.node(body)

    def choice(self, body: int, exit: int, greedy: bool) -> tuple:
        return ("split", body, exit) if greedy else ("split", exit, body)

    def repeat(self, node: tuple) -> None:
        _, body, low, high, greedy = node
        groups: list[int] = []
        _group_numbers(body, groups)
        before = len(self.program)
        self.node(body)
        if len(self.program) == before:
            return
        del self.program[before:]
        for _ in range(low):
            self.iteration(body, groups)
        if high is None:
            loop = self.emit(None)
            register = self.register()
            self.emit(("mark", register))
            self.iteration(body, groups)
            self.emit(("check", register))
            self.emit(("jmp", loop))
            self.program[loop] = self.choice(loop + 1, len(self.program), greedy)
            return
        exits = []
        for _ in range(high - low):
            exits.append(self.emit(None))
            register = self.register()
            self.emit(("mark", register))
            self.iteration(body, groups)
            self.emit(("check", register))
        end = len(self.program)
        for split in exits:
            self.program[split] = self.choice(split + 1, end, greedy)


class Pattern:
    __slots__ = ("flags", "groups", "ignore_case", "multiline", "program", "registers", "source")

    def __init__(self, source: str, flags: str) -> None:
        if any(flag not in FLAGS for flag in flags) or len(set(flags)) != len(flags):
            raise PatternError(f"invalid regular expression flags {flags!r}")
        self.source = source
        self.flags = flags
        self.ignore_case = "i" in flags
        self.multiline = "m" in flags
        parser = _PatternParser(source)
        tree = parser.parse()
        compiler = _Compiler(self.ignore_case)
        compiler.node(tree)
        compiler.emit(("accept",))
        self.program = compiler.program
        self.registers = compiler.registers
        self.groups = parser.total_groups

    @property
    def is_global(self) -> bool:
        return "g" in self.flags

    def _asserted(self, kind: str, text: str, position: int) -> bool:
        if kind == "^":
            return position == 0 or (self.multiline and text[position - 1] in LINE_TERMINATORS)
        if kind == "$":
            return position == len(text) or (self.multiline and text[position] in LINE_TERMINATORS)
        before = position > 0 and text[position - 1] in WORD
        after = position < len(text) and text[position] in WORD
        return (before != after) == (kind == "b")

    def _backref(self, text: str, position: int, slots: Slots, number: int) -> int | None:
        start, end = slots[2 * number], slots[2 * number + 1]
        if start is None or end is None:
            return position
        size = end - start
        piece = text[position : position + size]
        if len(piece) != size:
            return None
        if self.ignore_case:
            same = all(
                canonical(left) == canonical(right)
                for left, right in zip(piece, text[start:end], strict=True)
            )
        else:
            same = piece == text[start:end]
        return position + size if same else None

    def _execute(
        self, text: str, position: int, slots: Slots, pc: int, step: Step
    ) -> tuple[int, Slots] | None:
        program = self.program
        stack: list[tuple[int, int, Slots]] = []
        size = len(text)
        while True:
            step()
            instruction = program[pc]
            kind = instruction[0]
            matched = True
            if kind == "char":
                if position < size and (
                    (canonical(text[position]) if self.ignore_case else text[position])
                    == instruction[1]
                ):
                    position += 1
                    pc += 1
                else:
                    matched = False
            elif kind == "any":
                if position < size and text[position] not in LINE_TERMINATORS:
                    position += 1
                    pc += 1
                else:
                    matched = False
            elif kind == "class":
                if position < size and instruction[1](text[position]):
                    position += 1
                    pc += 1
                else:
                    matched = False
            elif kind == "split":
                stack.append((instruction[2], position, slots))
                pc = instruction[1]
            elif kind == "jmp":
                pc = instruction[1]
            elif kind in ("save", "mark"):
                index = instruction[1] if kind == "save" else 2 * (self.groups + 1) + instruction[1]
                slots = (*slots[:index], position, *slots[index + 1 :])
                pc += 1
            elif kind == "check":
                matched = slots[2 * (self.groups + 1) + instruction[1]] != position
                pc += 1
            elif kind == "reset":
                low, high = instruction[1], instruction[2]
                slots = (*slots[:low], *([None] * (high - low)), *slots[high:])
                pc += 1
            elif kind == "assert":
                matched = self._asserted(instruction[1], text, position)
                pc += 1
            elif kind == "backref":
                moved = self._backref(text, position, slots, instruction[1])
                matched = moved is not None
                position = moved if moved is not None else position
                pc += 1
            elif kind == "look":
                found = self._execute(text, position, slots, instruction[2], step)
                if instruction[1]:
                    matched = found is not None
                    if found is not None:
                        slots = found[1]
                else:
                    matched = found is None
                pc = instruction[3]
            else:
                return position, slots
            if not matched:
                if not stack:
                    return None
                pc, position, slots = stack.pop()

    def match_at(self, text: str, position: int, step: Step) -> list[int | None] | None:
        empty: Slots = (position, None) + (None,) * (2 * self.groups + self.registers)
        found = self._execute(text, position, empty, 0, step)
        if found is None:
            return None
        end, slots = found
        result = list(slots[: 2 * (self.groups + 1)])
        result[0], result[1] = position, end
        return result

    def search(self, text: str, start: int, step: Step) -> list[int | None] | None:
        for position in range(start, len(text) + 1):
            found = self.match_at(text, position, step)
            if found is not None:
                return found
        return None


def compile_pattern(source: str, flags: str) -> Pattern:
    return Pattern(source, flags)


class RegExpObject(JSObject):
    def __init__(self, pattern: Pattern) -> None:
        super().__init__({"lastIndex": 0.0})
        self.pattern = pattern

    def get(self, key: str) -> Any:
        if key == "source":
            return self.pattern.source
        if key == "global":
            return self.pattern.is_global
        if key == "ignoreCase":
            return self.pattern.ignore_case
        if key == "multiline":
            return self.pattern.multiline
        return super().get(key)

    def put(self, key: str, value: Any) -> None:
        if key not in READ_ONLY:
            super().put(key, value)

    def has(self, key: str) -> bool:
        return key in READ_ONLY or super().has(key)

    def default_value(self) -> Any:
        return f"/{self.pattern.source or '(?:)'}/{self.pattern.flags}"


def captured(text: str, slots: list[int | None], number: int) -> Any:
    start, end = slots[2 * number], slots[2 * number + 1]
    if start is None or end is None:
        return UNDEFINED
    return checked_string(text[start:end])


def match_array(text: str, slots: list[int | None], groups: int) -> JSArray:
    result = JSArray([captured(text, slots, number) for number in range(groups + 1)])
    result.put("index", float(slots[0] or 0))
    result.put("input", text)
    return result


def execute(regexp: RegExpObject, text: str, step: Step) -> JSArray | None:
    pattern = regexp.pattern
    start = 0
    if pattern.is_global:
        last = to_integer(regexp.get("lastIndex"))
        if last < 0 or last > len(text):
            regexp.put("lastIndex", 0.0)
            return None
        start = int(last)
    slots = pattern.search(text, start, step)
    if slots is None:
        if pattern.is_global:
            regexp.put("lastIndex", 0.0)
        return None
    if pattern.is_global:
        regexp.put("lastIndex", float(slots[1] or 0))
    return match_array(text, slots, pattern.groups)


def all_matches(pattern: Pattern, text: str, step: Step) -> list[list[int | None]]:
    found = []
    position = 0
    while position <= len(text):
        slots = pattern.search(text, position, step)
        if slots is None:
            break
        allocate(len(slots) * 8)
        found.append(slots)
        end = slots[1] or 0
        position = end + 1 if end == slots[0] else end
    return found


def expand(replacement: str, text: str, slots: list[int | None], groups: int) -> str:
    start, end = slots[0] or 0, slots[1] or 0
    output: list[str] = []
    index = 0
    while index < len(replacement):
        character = replacement[index]
        following = replacement[index + 1 : index + 2]
        if character != "$" or not following:
            output.append(character)
            index += 1
            continue
        if following in ("$", "&", "`", "'"):
            output.append(
                {"$": "$", "&": text[start:end], "`": text[:start], "'": text[end:]}[following]
            )
            index += 2
            continue
        two = replacement[index + 1 : index + 3]
        if len(two) == 2 and two.isascii() and two.isdigit() and 1 <= int(two) <= groups:
            value = captured(text, slots, int(two))
            output.append("" if value is UNDEFINED else value)
            index += 3
        elif following.isascii() and following.isdigit() and 1 <= int(following) <= groups:
            value = captured(text, slots, int(following))
            output.append("" if value is UNDEFINED else value)
            index += 2
        else:
            output.append(character)
            index += 1
    return "".join(output)


def replace(
    pattern: Pattern,
    text: str,
    replacement: Callable[[list[int | None]], str],
    step: Step,
) -> str:
    matches = (
        all_matches(pattern, text, step)
        if pattern.is_global
        else [found for found in [pattern.search(text, 0, step)] if found is not None]
    )
    output: list[str] = []
    total = 0
    position = 0
    for slots in matches:
        start, end = slots[0] or 0, slots[1] or 0
        inserted = replacement(slots)
        total += (start - position) + len(inserted)
        if total > MAX_STRING:
            raise ScriptLimit("string too long")
        output.append(text[position:start])
        output.append(inserted)
        position = end
    output.append(text[position:])
    return checked_string("".join(output))


def split(pattern: Pattern, text: str, limit: int, step: Step) -> list[Any]:
    if limit == 0:
        return []
    if not text:
        return [] if pattern.match_at(text, 0, step) is not None else [text]
    parts: list[Any] = []
    start = 0
    position = 0
    while position < len(text):
        slots = pattern.match_at(text, position, step)
        end = None if slots is None else slots[1]
        if slots is None or end is None or end == start or end > len(text):
            position += 1
            continue
        parts.append(text[start:position])
        if len(parts) == limit:
            return parts
        start = end
        for number in range(1, pattern.groups + 1):
            parts.append(captured(text, slots, number))
            if len(parts) == limit:
                return parts
        position = start
    parts.append(text[start:])
    return parts


def pattern_source(value: Any) -> str:
    return "" if value is UNDEFINED else to_string(value)
