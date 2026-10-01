import re
from typing import Literal

from pydantic import Field

from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.protocol import RpcModel

PageSide = Literal["all", "odd", "even"]

_RANGE_TOKEN = re.compile(r"^\s*(\d*)\s*(-)?\s*(\d*)\s*$")


def _invalid(spec: str, reason: str) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        f"invalid page range '{spec}': {reason}",
        {"spec": spec, "reason": "badRange"},
    )


def no_pages_selected() -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, "no pages selected", {"reason": "noPagesSelected"})


def parse_page_ranges(spec: str | None, page_count: int) -> list[int]:
    if page_count <= 0:
        raise OpError(ErrorCode.INVALID_PDF, "document has no pages")
    if spec is None or not spec.strip() or spec.strip().lower() == "all":
        return list(range(page_count))
    pages: list[int] = []
    for token in spec.split(","):
        match = _RANGE_TOKEN.match(token)
        if not match or not token.strip():
            raise _invalid(spec, f"cannot read '{token.strip()}'")
        first, dash, last = match.groups()
        if not first and not last:
            raise _invalid(spec, f"cannot read '{token.strip()}'")
        start = int(first) if first else 1
        end = int(last) if last else (page_count if dash else start)
        if start < 1 or end < 1:
            raise _invalid(spec, "pages start at 1")
        if start > page_count or end > page_count:
            raise _invalid(spec, f"document has {page_count} pages")
        step = 1 if end >= start else -1
        pages.extend(range(start - 1, end - 1 + step, step))
    return pages


def parse_split_groups(spec: str, page_count: int) -> list[list[int]]:
    groups = [parse_page_ranges(part, page_count) for part in spec.split(";") if part.strip()]
    if not groups:
        raise _invalid(spec, "no parts given")
    return groups


def one_based_to_indices(pages: list[int], page_count: int) -> list[int]:
    indices: list[int] = []
    for page in pages:
        if page < 1 or page > page_count:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"page {page} is outside 1..{page_count}",
                {"reason": "pageOutOfRange", "page": page, "pageCount": page_count},
            )
        indices.append(page - 1)
    return indices


def contiguous_runs(indices: list[int]) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    for index in indices:
        if runs and index == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], index)
        else:
            runs.append((index, index))
    return runs


def filter_side(indices: list[int], side: str | None) -> list[int]:
    if not side or side == "all":
        return indices
    if side == "odd":
        return [index for index in indices if index % 2 == 0]
    if side == "even":
        return [index for index in indices if index % 2 == 1]
    raise OpError(ErrorCode.INVALID_PARAMS, f"unknown page side '{side}'")


class PageScope(RpcModel):
    kind: Literal["all", "odd", "even", "every", "ranges"] = "all"
    ranges: str | None = None
    every: int = Field(default=2, ge=1, le=100_000)
    start: int = Field(default=1, ge=1)


def scope_indices(scope: PageScope, page_count: int) -> list[int]:
    if page_count <= 0:
        raise OpError(ErrorCode.INVALID_PDF, "document has no pages")
    if scope.kind == "ranges":
        indices = list(dict.fromkeys(parse_page_ranges(scope.ranges, page_count)))
    elif scope.kind == "odd":
        indices = list(range(0, page_count, 2))
    elif scope.kind == "even":
        indices = list(range(1, page_count, 2))
    elif scope.kind == "every":
        indices = list(range(scope.start - 1, page_count, scope.every))
    else:
        indices = list(range(page_count))
    if not indices:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "no pages match the chosen pages",
            {"reason": "noPagesSelected"},
        )
    return indices
