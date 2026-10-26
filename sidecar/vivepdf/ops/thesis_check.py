import re
import statistics
from collections import Counter
from typing import Literal

from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._thesis_measure import (
    PageFacts,
    content_box,
    family_name,
    has_text,
    heading_level,
    line_gaps,
    read_page,
    split_body,
)
from vivepdf.ops.a11y import require_pages
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.paths import ReadPath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

Status = Literal["pass", "warn", "fail", "skip"]
Paper = Literal["a4", "a5", "b5", "letter", "legal", "any"]
NumberPlace = Literal["center", "right", "outside", "any"]
MM = 25.4 / 72
MAX_PAGES = 2000
MAX_LISTED_PAGES = 400
PAPER_TOLERANCE_PT = 3.0
SIZE_TOLERANCE_PT = 0.6
MIN_PAGE_GAPS = 4
MIN_PAGE_CHARS = 200
PAPERS = {
    "a4": (595.0, 842.0),
    "a5": (420.0, 595.0),
    "b5": (499.0, 709.0),
    "letter": (612.0, 792.0),
    "legal": (612.0, 1008.0),
}
SIDES = ("top", "bottom", "left", "right")
FAMILY_KEY = re.compile(r"[^a-z0-9]")


class ThesisMargins(RpcModel):
    top: float = Field(ge=0, le=100)
    bottom: float = Field(ge=0, le=100)
    left: float = Field(ge=0, le=100)
    right: float = Field(ge=0, le=100)


class ThesisCheckParams(RpcModel):
    path: ReadPath
    password: str | None = None
    paper: Paper = "a4"
    margins_mm: ThesisMargins
    mirrored: bool = False
    tolerance_mm: float = Field(default=1.5, ge=0, le=10)
    font_family: str = Field(default="", max_length=80)
    font_size: float = Field(ge=4, le=40)
    line_height: float = Field(ge=0.8, le=3)
    page_numbers: NumberPlace = "center"
    front_roman: bool = True


class ThesisCheckItem(RpcModel):
    id: str
    status: Status
    pages: list[int] = []
    page_total: int = 0
    expected: str | None = None
    found: str | None = None


class ThesisCheckReport(RpcModel):
    page_count: int
    text_pages: int
    checks: list[ThesisCheckItem]
    ready: bool


def _item(
    check_id: str,
    pages: list[int],
    bad: Status,
    expected: str | None = None,
    found: str | None = None,
) -> ThesisCheckItem:
    return ThesisCheckItem(
        id=check_id,
        status=bad if pages else "pass",
        pages=pages[:MAX_LISTED_PAGES],
        page_total=len(pages),
        expected=expected,
        found=found,
    )


def _mm(value: float) -> str:
    return f"{value * MM:.1f}"


def _family_key(name: str) -> str:
    return FAMILY_KEY.sub("", family_name(name).lower())


def _paper_check(pages: list[PageFacts], paper: Paper) -> ThesisCheckItem:
    if paper == "any":
        return ThesisCheckItem(id="paper", status="skip")
    width, height = PAPERS[paper]
    wrong: list[int] = []
    found: str | None = None
    for number, facts in enumerate(pages, start=1):
        short, long = sorted((facts.width, facts.height))
        if abs(short - width) > PAPER_TOLERANCE_PT or abs(long - height) > PAPER_TOLERANCE_PT:
            wrong.append(number)
            found = found or f"{short * MM:.0f}×{long * MM:.0f}"
    return _item("paper", wrong, "fail", f"{width * MM:.0f}×{height * MM:.0f}", found)


def _margin_checks(pages: list[PageFacts], params: ThesisCheckParams) -> list[ThesisCheckItem]:
    wanted = params.margins_mm.model_dump()
    tolerance = params.tolerance_mm / MM
    wrong: dict[str, list[int]] = {side: [] for side in SIDES}
    smallest: dict[str, float] = {}
    for number, facts in enumerate(pages, start=1):
        box = content_box(facts)
        if box is None or facts.width > facts.height:
            continue
        measured = {
            "top": box.y0,
            "bottom": facts.height - box.y1,
            "left": box.x0,
            "right": facts.width - box.x1,
        }
        if params.mirrored and number % 2 == 0:
            measured["left"], measured["right"] = measured["right"], measured["left"]
        for side in SIDES:
            if measured[side] < wanted[side] / MM - tolerance:
                wrong[side].append(number)
                smallest[side] = min(smallest.get(side, measured[side]), measured[side])
    return [
        _item(
            f"margin{side.title()}",
            wrong[side],
            "fail",
            f"{wanted[side]:.1f}",
            _mm(max(0.0, smallest[side])) if side in smallest else None,
        )
        for side in SIDES
    ]


def _body_style(pages: list[PageFacts]) -> tuple[str, float] | None:
    weights: Counter[tuple[str, float]] = Counter()
    for facts in pages:
        for line in facts.body:
            weights[(line.family, line.size)] += line.chars
    return weights.most_common(1)[0][0] if weights else None


def _font_checks(
    pages: list[PageFacts], params: ThesisCheckParams, family: str, size: float
) -> list[ThesisCheckItem]:
    checks: list[ThesisCheckItem] = []
    if params.font_family.strip():
        wanted = _family_key(params.font_family)
        odd: list[int] = []
        for number, facts in enumerate(pages, start=1):
            weights: Counter[str] = Counter()
            for line in facts.body:
                if abs(line.size - size) <= SIZE_TOLERANCE_PT:
                    weights[line.family] += line.chars
            enough = sum(weights.values()) >= MIN_PAGE_CHARS
            if enough and _family_key(weights.most_common(1)[0][0]) != wanted:
                odd.append(number)
        item = _item("bodyFont", odd, "warn", params.font_family.strip(), family)
        if _family_key(family) != wanted:
            item.status = "fail"
        checks.append(item)
    else:
        checks.append(ThesisCheckItem(id="bodyFont", status="skip", found=family))
    size_ok = abs(size - params.font_size) <= SIZE_TOLERANCE_PT
    checks.append(
        ThesisCheckItem(
            id="bodySize",
            status="pass" if size_ok else "fail",
            expected=f"{params.font_size:g}",
            found=f"{size:g}",
        )
    )
    return checks


def _spacing_check(
    pages: list[PageFacts], params: ThesisCheckParams, size: float
) -> ThesisCheckItem:
    low = params.line_height - 0.08
    high = params.line_height * 1.17 + 0.08
    every: list[float] = []
    odd: list[int] = []
    for number, facts in enumerate(pages, start=1):
        gaps = line_gaps(facts, size)
        every.extend(gaps)
        if len(gaps) >= MIN_PAGE_GAPS and not low <= statistics.median(gaps) / size <= high:
            odd.append(number)
    if not every:
        return ThesisCheckItem(id="lineSpacing", status="skip")
    ratio = statistics.median(every) / size
    found = f"{statistics.median(every):.1f}"
    item = _item("lineSpacing", odd, "warn", f"{params.line_height:g}", found)
    if not low <= ratio <= high:
        item.status = "fail"
    return item


def _number_place(place: NumberPlace, value: int) -> str | None:
    if place == "any":
        return None
    if place == "outside":
        return "right" if value % 2 else "left"
    return place


def _number_checks(pages: list[PageFacts], params: ThesisCheckParams) -> list[ThesisCheckItem]:
    numbered = [(index, facts.number) for index, facts in enumerate(pages) if facts.number]
    if not numbered:
        return [ThesisCheckItem(id="pageNumbers", status="fail", page_total=len(pages))]
    first = numbered[0][0]
    missing = [index + 1 for index in range(first, len(pages)) if pages[index].number is None]
    misplaced = [
        index + 1
        for index, number in numbered
        if (wanted := _number_place(params.page_numbers, number.value)) and number.place != wanted
    ]
    broken: list[int] = []
    previous: tuple[int, str, int] | None = None
    seen_arabic = False
    for index, number in numbered:
        if number.kind == "arabic" and not seen_arabic:
            seen_arabic = True
            if number.value != 1:
                broken.append(index + 1)
        elif number.kind == "roman" and seen_arabic:
            broken.append(index + 1)
        elif previous and previous[1] == number.kind:
            if number.value != previous[2] + index - previous[0]:
                broken.append(index + 1)
        previous = (index, number.kind, number.value)
    place_item = (
        ThesisCheckItem(id="pageNumberPlace", status="skip", expected="any")
        if params.page_numbers == "any"
        else _item("pageNumberPlace", misplaced, "fail", params.page_numbers)
    )
    has_roman = any(number.kind == "roman" for _, number in numbered)
    roman_item = ThesisCheckItem(
        id="frontRoman",
        status="skip" if not params.front_roman else ("pass" if has_roman else "warn"),
    )
    return [
        _item("pageNumbers", missing, "warn"),
        place_item,
        _item("pageNumberOrder", broken, "fail"),
        roman_item,
    ]


def _heading_check(pages: list[PageFacts], size: float) -> ThesisCheckItem:
    styles: dict[int, Counter[tuple[str, float, bool]]] = {}
    places: list[tuple[int, int, tuple[str, float, bool]]] = []
    for number, facts in enumerate(pages, start=1):
        for line in facts.body:
            level = heading_level(line, facts, size)
            if level is None:
                continue
            style = (line.family, line.size, line.bold)
            styles.setdefault(level, Counter())[style] += 1
            places.append((number, level, style))
    odd = sorted(
        {
            number
            for number, level, style in places
            if sum(styles[level].values()) >= 2 and style != styles[level].most_common(1)[0][0]
        }
    )
    if not places:
        return ThesisCheckItem(id="headings", status="skip")
    return _item("headings", odd, "warn")


def build_thesis_report(pages: list[PageFacts], params: ThesisCheckParams) -> ThesisCheckReport:
    text_pages = [number for number, facts in enumerate(pages, start=1) if has_text(facts)]
    if not text_pages:
        raise OpError(ErrorCode.UNSUPPORTED, "the document has no text layer", {"reason": "noText"})
    split_body(pages)
    scanned = [
        number
        for number, facts in enumerate(pages, start=1)
        if not has_text(facts) and facts.images
    ]
    checks = [_item("text", scanned, "warn"), _paper_check(pages, params.paper)]
    checks.extend(_margin_checks(pages, params))
    style = _body_style(pages)
    if style:
        family, size = style
        checks.extend(_font_checks(pages, params, family, size))
        checks.append(_spacing_check(pages, params, size))
        checks.append(_heading_check(pages, size))
    checks.extend(_number_checks(pages, params))
    return ThesisCheckReport(
        page_count=len(pages),
        text_pages=len(text_pages),
        checks=checks,
        ready=all(check.status != "fail" for check in checks),
    )


@op("thesis.check", ThesisCheckParams)
def check(params: ThesisCheckParams, progress: Progress) -> ThesisCheckReport:
    with open_document(params.path, params.password) as document:
        require_pages(document)
        total = document.page_count
        if total > MAX_PAGES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "the document has too many pages",
                {"reason": "checkTooManyPages", "limit": MAX_PAGES},
            )
        pages: list[PageFacts] = []
        for index in range(total):
            progress.check_cancelled()
            if index % 10 == 0:
                progress.report(
                    index / total, "progress.inspecting", {"current": index + 1, "total": total}
                )
            pages.append(read_page(document[index]))
    return build_thesis_report(pages, params)
