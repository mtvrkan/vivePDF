import pytest

from vivepdf.ops._studio_vector import _number, path_operators
from vivepdf.rpc.errors import OpError


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (3.0, "3"),
        (-0.0, "0"),
        (-0.00004, "0"),
        (2.99995, "3"),
        (1.25, "1.25"),
        (-12.30001, "-12.3"),
        (1e15, "1000000000000000"),
    ],
)
def test_numbers_are_written_short_and_without_negative_zero(value, text):
    assert _number(value) == text


def test_the_same_path_converts_to_the_same_operators_every_time():
    data = "M10 10 h5 v5 q2 2 4 0 C1 2 3 4 5 6 z"

    first = path_operators(data)

    assert path_operators(data) == first
    assert first.splitlines()[0] == "10 10 m"
    assert first.splitlines()[-1] == "h"


def test_a_broken_path_fails_on_every_call_not_only_the_first():
    for _ in range(2):
        with pytest.raises(OpError):
            path_operators("10 10 L 5")
