import threading
import time
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.compare import CompareParams, _aligned, compare
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


def test_identical_long_documents_align_in_linear_time():
    keys = ["shape:0"] * 10_000
    started = time.perf_counter()
    pairs = _aligned(keys, list(keys))
    assert time.perf_counter() - started < 2
    assert pairs == [(index, index) for index in range(10_000)]


def test_an_inserted_page_between_equal_ends_is_aligned():
    before = [f"text:{index}" for index in range(50)]
    after = [*before[:20], "text:yeni", *before[20:]]
    pairs = _aligned(before, after)
    assert pairs[:20] == [(index, index) for index in range(20)]
    assert (None, 20) in pairs
    assert pairs[-1] == (49, 50)


def test_a_long_run_of_repeated_pages_stays_bounded():
    left = ["shape:1"] * 4000 + ["text:a"]
    right = ["text:b"] + ["shape:1"] * 4000
    started = time.perf_counter()
    pairs = _aligned(left, right)
    assert time.perf_counter() - started < 5
    assert {a for a, _ in pairs if a is not None} == set(range(len(left)))
    assert {b for _, b in pairs if b is not None} == set(range(len(right)))


def test_compare_stops_while_reading_pages(tmp_path: Path):
    source = tmp_path / "uzun.pdf"
    document = pymupdf.open()
    for _ in range(60):
        document.new_page(width=100, height=100)
    document.save(source)
    document.close()
    event = threading.Event()
    reports: list[float] = []

    def sink(value, _message, _detail):
        reports.append(value)
        if len(reports) == 2:
            event.set()

    with pytest.raises(OpError) as caught:
        compare(
            CompareParams(path_a=str(source), path_b=str(source)),
            Progress(sink, event),
        )
    assert caught.value.code == ErrorCode.CANCELLED


def _numbered(path: Path, texts: list[str]) -> None:
    document = pymupdf.open()
    for text in texts:
        page = document.new_page(width=200, height=200)
        page.insert_text((20, 50), text)
    document.save(path)
    document.close()


def test_report_spreads_are_capped_but_the_summary_lists_every_change(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr("vivepdf.ops.compare.REPORT_SPREAD_LIMIT", 3)
    left = tmp_path / "a.pdf"
    right = tmp_path / "b.pdf"
    _numbered(left, [f"sayfa {index} eski" for index in range(5)])
    _numbered(right, [f"sayfa {index} yeni" for index in range(5)])
    output = tmp_path / "rapor.pdf"
    result = compare(
        CompareParams(path_a=str(left), path_b=str(right), output=str(output)), silent_progress()
    )
    assert result.changed_pages == 5
    assert result.report_spreads == 3
    with pymupdf.open(output) as report:
        assert report.page_count == 1 + 3
        summary = report[0].get_text()
        assert "3 / 5" in summary
        assert summary.count("↔") == 5


def test_report_spreads_cover_every_change_under_the_cap(tmp_path: Path):
    left = tmp_path / "a.pdf"
    right = tmp_path / "b.pdf"
    _numbered(left, ["bir", "iki"])
    _numbered(right, ["bir", "üç"])
    result = compare(
        CompareParams(path_a=str(left), path_b=str(right), output=str(tmp_path / "r.pdf")),
        silent_progress(),
    )
    assert result.report_spreads == result.changed_pages == 1


def test_no_report_means_no_spreads(tmp_path: Path):
    left = tmp_path / "a.pdf"
    _numbered(left, ["bir"])
    result = compare(CompareParams(path_a=str(left), path_b=str(left)), silent_progress())
    assert result.output is None
    assert result.report_spreads == 0
