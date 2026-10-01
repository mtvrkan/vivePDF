import time
from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops import _safe_pattern
from vivepdf.ops._safe_pattern import MatchClock, _line_windows, compile_safe_patterns
from vivepdf.ops.edit import RedactParams, SearchParams, redact, redact_preview
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def numbers_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((50, 100), "Ref 123-45-6789 closed", fontsize=12)
    page.insert_text((50, 130), "a" * 40 + "!", fontsize=8)
    path = tmp_path / "numbers.pdf"
    document.save(path)
    document.close()
    return path


@pytest.mark.parametrize(
    ("pattern", "reason"),
    [
        (r"(a+)+$", "patternNested"),
        (r"(\w+\s?)+$", "patternNested"),
        (r"(a|a)*b", "patternNested"),
        (r"\d+\d+x", "patternNested"),
        (r"(.)\1", "patternBackreference"),
        ("a" * 301, "patternTooLong"),
    ],
)
def test_catastrophic_patterns_are_refused_before_any_matching(
    numbers_pdf: Path, tmp_path: Path, pattern: str, reason: str
) -> None:
    started = time.monotonic()
    with pytest.raises(OpError) as caught:
        redact(
            RedactParams(path=str(numbers_pdf), output=str(tmp_path / "o.pdf"), patterns=[pattern]),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": reason}
    assert time.monotonic() - started < 5
    assert not (tmp_path / "o.pdf").exists()


def test_preview_refuses_the_same_patterns(numbers_pdf: Path) -> None:
    with pytest.raises(OpError) as caught:
        redact_preview(SearchParams(path=str(numbers_pdf), patterns=[r"(a+)+$"]), silent_progress())
    assert caught.value.data == {"reason": "patternNested"}


@pytest.mark.parametrize(
    "pattern",
    [
        r"\d{3}-\d{2}-\d{4}",
        r"(\d+-){2}\d+",
        r"\d+\s*closed",
        r"[\w.+-]+@[\w-]+\.[\w.]+",
        r"(foo|bar)+",
        r"IBAN:?\s*[A-Z]{2}\d{2}(?:\s?\d{4}){5}",
    ],
)
def test_ordinary_patterns_are_accepted(pattern: str) -> None:
    assert len(compile_safe_patterns([pattern], 0)) == 1


def test_a_safe_pattern_still_redacts(numbers_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "safe.pdf"
    result = redact(
        RedactParams(path=str(numbers_pdf), output=str(output), patterns=[r"\d{3}-\d{2}-\d{4}"]),
        silent_progress(),
    )
    assert result.redactions == 1
    with pymupdf.open(output) as document:
        assert "6789" not in document[0].get_text()


def test_too_many_patterns_are_refused() -> None:
    with pytest.raises(ValidationError):
        RedactParams(path="a.pdf", output="b.pdf", patterns=[f"x{n}" for n in range(21)])
    with pytest.raises(OpError) as caught:
        compile_safe_patterns([f"x{n}" for n in range(21)], 0)
    assert caught.value.data == {"reason": "tooManyPatterns"}


def test_the_match_clock_stops_a_slow_pattern() -> None:
    clock = MatchClock(budget=-1)
    with pytest.raises(OpError) as caught:
        list(clock.matches(compile_safe_patterns([r"a"], 0)[0], "aaa"))
    assert caught.value.data == {"reason": "patternTooSlow"}


def test_matching_runs_line_by_line() -> None:
    clock = MatchClock()
    pattern = compile_safe_patterns([r"^\w+"], 0)[0]
    assert [m.group() for m in clock.matches(pattern, "first line\nsecond line")] == [
        "first",
        "second",
    ]


def test_a_polynomial_pattern_is_stopped_by_killing_its_worker() -> None:
    pattern = compile_safe_patterns([r"a.*a.*a.*a.*a.*b"], 0)[0]
    clock = MatchClock(budget=1.0)
    started = time.monotonic()
    with pytest.raises(OpError) as caught:
        list(clock.matches(pattern, "a" * 1000))
    assert caught.value.data == {"reason": "patternTooSlow"}
    assert time.monotonic() - started < 30
    assert not _safe_pattern._WORKER.running


def test_the_worker_finds_what_matching_in_process_finds() -> None:
    pattern = compile_safe_patterns([r"(\w+)@(\w+)\.com"], 0)[0]
    text = "ali@example.com, veli@test.com\n" + "x" * 1500 + " ayse@site.com\n\nzeynep@yer.com"
    assert _safe_pattern.needs_isolation(pattern)
    found = [(m.span(), m.groups()) for m in MatchClock().located(pattern, text)]
    expected = [
        (m.span(), m.groups())
        for begin, end in _line_windows(text)
        for m in pattern.finditer(text, begin, end)
    ]
    assert found == expected
    assert len(found) == 4
    chunked = [m.group() for m in MatchClock().matches(pattern, text)]
    assert chunked == ["ali@example.com", "veli@test.com", "ayse@site.com", "zeynep@yer.com"]
    assert _safe_pattern._WORKER.running


def test_a_killed_worker_is_started_again_for_the_next_pattern() -> None:
    slow = compile_safe_patterns([r"a.*a.*a.*a.*a.*b"], 0)[0]
    with pytest.raises(OpError):
        list(MatchClock(budget=1.0).matches(slow, "a" * 1000))
    pattern = compile_safe_patterns([r"\d+-\d+"], 0)[0]
    found = [m.group() for m in MatchClock().matches(pattern, "no 12-345 ve 6-7")]
    assert found == ["12-345", "6-7"]


@pytest.mark.parametrize("pattern", [r"TASLAK", r"\d{3}-\d{2}-\d{4}", r"^\w+", r"gizli.*"])
def test_simple_patterns_stay_in_process(pattern: str) -> None:
    assert not _safe_pattern.needs_isolation(compile_safe_patterns([pattern], 0)[0])
