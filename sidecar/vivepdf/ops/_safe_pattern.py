import functools
import multiprocessing
import re
import threading
import time
from collections.abc import Iterator
from re import _compiler, _parser
from re import _constants as sre

from vivepdf._pattern_worker import serve
from vivepdf.rpc.errors import ErrorCode, OpError

MAX_PATTERNS = 20
MAX_PATTERN_LENGTH = 300
MAX_LINE_LENGTH = 1000
MATCH_BUDGET_SECONDS = 20.0
LARGE_REPEAT = 10
ISOLATED_REPEATS = 2
WORKER_START_SECONDS = 60.0
SAMPLE = [chr(code) for code in range(256)] + list(
    "\u011f\u011e\u0131\u0130\u015f\u015e\u2028\u3000"
)
SINGLE_CHARACTER = (sre.LITERAL, sre.NOT_LITERAL, sre.ANY, sre.IN)

REPEATS = (sre.MAX_REPEAT, sre.MIN_REPEAT)
BACKREFERENCES = (
    sre.GROUPREF,
    sre.GROUPREF_EXISTS,
    sre.GROUPREF_IGNORE,
    sre.GROUPREF_LOC_IGNORE,
    sre.GROUPREF_UNI_IGNORE,
)


def _unsafe(reason: str, pattern: str) -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, f"unsafe pattern: {pattern[:60]}", {"reason": reason})


def _first_literal(branch: _parser.SubPattern) -> int | None:
    items = list(branch)
    while items and items[0][0] == sre.SUBPATTERN:
        items = list(items[0][1][3])
    if items and items[0][0] == sre.LITERAL:
        return items[0][1]
    return None


def _distinct_branches(branches: list[_parser.SubPattern]) -> bool:
    firsts = [_first_literal(branch) for branch in branches]
    return None not in firsts and len(set(firsts)) == len(firsts)


def _unbounded(op: object, value: object) -> bool:
    return op in REPEATS and value[1] == sre.MAXREPEAT and value[0] != value[1]


def _characters(state: _parser.State, value: object) -> set[str] | None:
    inner = list(value[2])
    if len(inner) != 1 or inner[0][0] not in SINGLE_CHARACTER:
        return None
    matcher = _compiler.compile(_parser.SubPattern(state, inner), state.flags)
    return {char for char in SAMPLE if matcher.fullmatch(char)}


def _overlapping(state: _parser.State, first: object, second: object) -> bool:
    left, right = _characters(state, first), _characters(state, second)
    return left is None or right is None or bool(left & right)


def _children(op: object, value: object) -> list[_parser.SubPattern]:
    if op in REPEATS or op == sre.POSSESSIVE_REPEAT:
        return [value[2]]
    if op == sre.SUBPATTERN:
        return [value[3]]
    if op in (sre.ASSERT, sre.ASSERT_NOT):
        return [value[1]]
    if op == sre.BRANCH:
        return list(value[1])
    if op == sre.ATOMIC_GROUP:
        return [value]
    return []


def _risk(items: _parser.SubPattern, repeated: bool) -> str | None:
    previous: object = None
    for op, value in items:
        if op in BACKREFERENCES:
            return "patternBackreference"
        unbounded = _unbounded(op, value)
        if unbounded and previous is not None and _overlapping(items.state, previous, value):
            return "patternNested"
        previous = value if unbounded else None
        inner_repeated = repeated
        if op in REPEATS:
            low, high, _ = value
            if repeated and high != low:
                return "patternNested"
            inner_repeated = repeated or high > LARGE_REPEAT
        elif op == sre.BRANCH and repeated and not _distinct_branches(value[1]):
            return "patternNested"
        for child in _children(op, value):
            found = _risk(child, inner_repeated)
            if found:
                return found
    return None


def compile_safe_patterns(patterns: list[str], flags: int) -> list[re.Pattern[str]]:
    patterns = [item for item in patterns if item]
    if len(patterns) > MAX_PATTERNS:
        raise OpError(ErrorCode.INVALID_PARAMS, "too many patterns", {"reason": "tooManyPatterns"})
    compiled: list[re.Pattern[str]] = []
    for item in patterns:
        if len(item) > MAX_PATTERN_LENGTH:
            raise _unsafe("patternTooLong", item)
        try:
            parsed = _parser.parse(item, flags)
            compiled.append(re.compile(item, flags))
        except re.error as error:
            raise OpError(
                ErrorCode.INVALID_PARAMS, f"invalid pattern: {error}", {"reason": "badPattern"}
            ) from error
        risk = _risk(parsed, False)
        if risk:
            raise _unsafe(risk, item)
    return compiled


def _variable_repeats(items: _parser.SubPattern) -> int:
    count = 0
    for op, value in items:
        if op in REPEATS and value[0] != value[1]:
            count += 1
        for child in _children(op, value):
            count += _variable_repeats(child)
    return count


@functools.lru_cache(maxsize=64)
def _isolation_needed(source: str, flags: int) -> bool:
    return _variable_repeats(_parser.parse(source, flags)) >= ISOLATED_REPEATS


def needs_isolation(pattern: re.Pattern[str]) -> bool:
    return _isolation_needed(pattern.pattern, pattern.flags)


class _PatternWorker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process = None
        self._connection = None

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.is_alive()

    def find(
        self,
        pattern: re.Pattern[str],
        texts: list[str],
        windows: list[tuple[int, int, int]],
        timeout: float,
    ) -> list[list[tuple[int, int]]] | None:
        with self._lock:
            if not self.running and not self._start():
                return None
            began = time.monotonic()
            try:
                self._connection.send((pattern.pattern, pattern.flags, texts, windows))
                if self._connection.poll(max(0.0, timeout - (time.monotonic() - began))):
                    return self._connection.recv()
            except (EOFError, OSError):
                pass
            self._stop()
            return None

    def _start(self) -> bool:
        context = multiprocessing.get_context("spawn")
        self._connection, child = context.Pipe()
        self._process = context.Process(target=serve, args=(child,), daemon=True)
        self._process.start()
        child.close()
        try:
            if self._connection.poll(WORKER_START_SECONDS) and self._connection.recv() == "ready":
                return True
        except (EOFError, OSError):
            pass
        self._stop()
        return False

    def _stop(self) -> None:
        if self._process is not None:
            self._process.kill()
            self._process.join(timeout=5)
        if self._connection is not None:
            self._connection.close()
        self._process = None
        self._connection = None


_WORKER = _PatternWorker()


def _line_chunks(text: str) -> list[str]:
    return [
        line[start : start + MAX_LINE_LENGTH]
        for line in text.splitlines()
        for start in range(0, max(1, len(line)), MAX_LINE_LENGTH)
    ]


def _line_windows(text: str) -> list[tuple[int, int]]:
    windows: list[tuple[int, int]] = []
    line_start = 0
    while line_start <= len(text):
        line_end = text.find("\n", line_start)
        if line_end < 0:
            line_end = len(text)
        for begin in range(line_start, max(line_start + 1, line_end), MAX_LINE_LENGTH):
            windows.append((begin, min(begin + MAX_LINE_LENGTH, line_end)))
        line_start = line_end + 1
    return windows


class MatchClock:
    def __init__(self, budget: float = MATCH_BUDGET_SECONDS) -> None:
        self.budget = budget
        self.spent = 0.0

    def matches(self, pattern: re.Pattern[str], text: str) -> Iterator[re.Match[str]]:
        chunks = _line_chunks(text)
        windows = [(index, 0, len(chunk)) for index, chunk in enumerate(chunks)]
        yield from self._run(pattern, chunks, windows)

    def located(self, pattern: re.Pattern[str], text: str) -> Iterator[re.Match[str]]:
        windows = [(0, begin, end) for begin, end in _line_windows(text)]
        yield from self._run(pattern, [text], windows)

    def _run(
        self, pattern: re.Pattern[str], texts: list[str], windows: list[tuple[int, int, int]]
    ) -> Iterator[re.Match[str]]:
        if needs_isolation(pattern):
            yield from self._isolated(pattern, texts, windows)
            return
        for index, begin, end in windows:
            began = time.monotonic()
            found = list(pattern.finditer(texts[index], begin, end))
            self.spent += time.monotonic() - began
            if self.spent > self.budget:
                raise _unsafe("patternTooSlow", pattern.pattern)
            yield from found

    def _isolated(
        self, pattern: re.Pattern[str], texts: list[str], windows: list[tuple[int, int, int]]
    ) -> Iterator[re.Match[str]]:
        remaining = self.budget - self.spent
        if remaining <= 0:
            raise _unsafe("patternTooSlow", pattern.pattern)
        began = time.monotonic()
        spans = _WORKER.find(pattern, texts, windows, remaining)
        self.spent += time.monotonic() - began
        if spans is None or self.spent > self.budget:
            raise _unsafe("patternTooSlow", pattern.pattern)
        for (index, _begin, end), found in zip(windows, spans, strict=True):
            for start, stop in found:
                match = pattern.match(texts[index], start, end)
                if match is None or match.end() != stop:
                    match = pattern.fullmatch(texts[index], start, stop)
                if match is not None:
                    yield match
