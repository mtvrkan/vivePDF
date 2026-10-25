from dataclasses import replace
from typing import Any

EDGE_TOLERANCE = 3.0
EDGE_SHARE = 0.02
OUTER_EDGE_SHARE = 0.1
MARGIN_LINES = 2


def _same_text(first: list[str | None], second: list[str | None]) -> bool:
    return [" ".join((text or "").split()) for text in first] == [
        " ".join((text or "").split()) for text in second
    ]


def _same_columns(first: Any, second: Any) -> bool:
    if not first.edges or len(first.edges) != len(second.edges):
        return False
    if len(first.rows[0]) != len(second.rows[0]):
        return False
    inner = max(EDGE_TOLERANCE, first.area.width * EDGE_SHARE)
    outer = max(inner, first.area.width * OUTER_EDGE_SHARE)
    last = len(first.edges) - 1
    return all(
        abs(a - b) <= (outer if position in (0, last) else inner)
        for position, (a, b) in enumerate(zip(first.edges, second.edges, strict=True))
    )


def _continues(first: Any, second: Any, following: dict[int, int]) -> bool:
    return (
        following.get(first.last_page) == second.page
        and first.bottom
        and second.top
        and first.lines_below <= MARGIN_LINES
        and second.lines_above <= MARGIN_LINES
        and bool(first.rows)
        and bool(second.rows)
        and _same_columns(first, second)
    )


def _joined(first: Any, second: Any) -> Any:
    repeated = _same_text(first.rows[0], second.rows[0])
    skipped = 1 if repeated else 0
    shift = len(first.rows) - skipped
    spans = [
        (top + shift, left, bottom + shift, right)
        for top, left, bottom, right in second.spans
        if top >= skipped
    ]
    return replace(
        first,
        rows=first.rows + second.rows[skipped:],
        spans=first.spans + spans,
        last_page=second.last_page,
        bottom=second.bottom,
        lines_below=second.lines_below,
    )


def joined_across_pages(tables: list[Any], indices: list[int]) -> list[Any]:
    following = dict(zip(indices, indices[1:], strict=False))
    joined: list[Any] = []
    for table in tables:
        if joined and _continues(joined[-1], table, following):
            joined[-1] = _joined(joined[-1], table)
        else:
            joined.append(table)
    return joined
