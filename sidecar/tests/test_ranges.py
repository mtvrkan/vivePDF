import pytest

from vivepdf.ops._ranges import (
    contiguous_runs,
    one_based_to_indices,
    parse_page_ranges,
    parse_split_groups,
)
from vivepdf.rpc.errors import ErrorCode, OpError


def test_parse_basic_ranges() -> None:
    assert parse_page_ranges("1-3,5,8-", 10) == [0, 1, 2, 4, 7, 8, 9]
    assert parse_page_ranges("-2", 5) == [0, 1]
    assert parse_page_ranges("all", 3) == [0, 1, 2]
    assert parse_page_ranges(None, 2) == [0, 1]


def test_descending_range_keeps_order() -> None:
    assert parse_page_ranges("3-1", 5) == [2, 1, 0]


@pytest.mark.parametrize("spec", ["0-2", "1-99", "abc", "1,,2", "-"])
def test_invalid_ranges_raise(spec: str) -> None:
    with pytest.raises(OpError) as raised:
        parse_page_ranges(spec, 10)
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_split_groups() -> None:
    assert parse_split_groups("1-2; 3; 4-", 5) == [[0, 1], [2], [3, 4]]


def test_one_based_to_indices_validates() -> None:
    assert one_based_to_indices([3, 1], 3) == [2, 0]
    with pytest.raises(OpError):
        one_based_to_indices([4], 3)


def test_contiguous_runs() -> None:
    assert contiguous_runs([0, 1, 2, 4, 6, 7]) == [(0, 2), (4, 4), (6, 7)]
    assert contiguous_runs([]) == []
