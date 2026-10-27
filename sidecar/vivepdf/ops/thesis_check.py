import statistics
from collections import Counter
from typing import Literal

from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._thesis_fonts import family_key, family_name
from vivepdf.ops._thesis_measure import (
    PageFacts,
    chapter_one,
    content_box,
    has_text,
    heading_level,
    line_gaps,
    read_page,
    reference_pages,
    split_body,
    text_frame,
)
from vivepdf.ops._thesis_numbers import Finding, review_numbers
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
TURNS = (
    {"left": "top", "right": "bottom", "top": "right", "bottom": "left"},
    {"left": "bottom", "right": "top", "top": "left", "bottom": "right"},
)


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


class ThesisPageDetail(RpcModel):
    page: int
    expected: str | None = None
    found: str | None = None
    note: str | None = None
    text: str | None = None


class ThesisCheckItem(RpcModel):
    id: str
    status: Status
    pages: list[int] = []
    page_total: int = 0
    expected: str | None = None
    found: str | None = None
    reason: str | None = None
    details: list[ThesisPageDetail] = []


class ThesisCheckReport(RpcModel):
    page_count: int
    text_pages: int
    checks: list[ThesisCheckItem]
    ready: bool


def _item(
    check_id: str,
    findings: list[Finding],
    bad: Status,
    expected: str | None = None,
    found: str | None = None,
) -> ThesisCheckItem:
    pages = sorted({finding.page for finding in findings})
    return ThesisCheckItem(
        id=check_id,
        status=bad if findings else "pass",
        pages=pages[:MAX_LISTED_PAGES],
        page_total=len(pages),
        expected=expected,
        found=found,
        details=[
            ThesisPageDetail(
                page=finding.page,
                expected=finding.expected,
                found=finding.found,
                note=finding.note,
                text=finding.text,
            )
            for finding in findings[:MAX_LISTED_PAGES]
        ],
    )


def _mm(value: float) -> str:
    return f"{max(0.0, value) * MM:.1f}"


def _paper_check(pages: list[PageFacts], paper: Paper) -> ThesisCheckItem:
    if paper == "any":
        return ThesisCheckItem(id="paper", status="skip")
    width, height = PAPERS[paper]
    expected = f"{width * MM:.0f}×{height * MM:.0f}"
    wrong: list[Finding] = []
    for number, facts in enumerate(pages, start=1):
        if facts.unreadable:
            continue
        short, long = sorted((facts.width, facts.height))
        if abs(short - width) > PAPER_TOLERANCE_PT or abs(long - height) > PAPER_TOLERANCE_PT:
            wrong.append(Finding(number, expected, f"{short * MM:.0f}×{long * MM:.0f}"))
    return _item("paper", wrong, "fail", expected, wrong[0].found if wrong else None)


def _measured(
    facts: PageFacts, wanted: dict[str, float], tolerance: float
) -> dict[str, float] | None:
    box = content_box(facts)
    if box is None:
        return None
    visible = {
        "top": box.y0,
        "bottom": facts.height - box.y1,
        "left": box.x0,
        "right": facts.width - box.x1,
    }
    if not facts.landscape:
        return visible
    options = [visible, *({side: visible[turn[side]] for side in SIDES} for turn in TURNS)]

    def shortfall(option: dict[str, float]) -> tuple[int, float]:
        short = [max(0.0, wanted[side] - tolerance - option[side]) for side in SIDES]
        return sum(1 for value in short if value > 0), sum(short)

    return min(options, key=shortfall)


def _margin_checks(pages: list[PageFacts], params: ThesisCheckParams) -> list[ThesisCheckItem]:
    wanted = {side: value / MM for side, value in params.margins_mm.model_dump().items()}
    tolerance = params.tolerance_mm / MM
    wrong: dict[str, list[Finding]] = {side: [] for side in SIDES}
    smallest: dict[str, float] = {}
    for number, facts in enumerate(pages, start=1):
        measured = _measured(facts, wanted, tolerance)
        if measured is None:
            continue
        if params.mirrored and number % 2 == 0:
            measured["left"], measured["right"] = measured["right"], measured["left"]
        note = "landscape" if facts.landscape else None
        for side in SIDES:
            if measured[side] < wanted[side] - tolerance:
                expected = f"{wanted[side] * MM:.1f}"
                wrong[side].append(Finding(number, expected, _mm(measured[side]), note))
                smallest[side] = min(smallest.get(side, measured[side]), measured[side])
    return [
        _item(
            f"margin{side.title()}",
            wrong[side],
            "fail",
            f"{wanted[side] * MM:.1f}",
            _mm(smallest[side]) if side in smallest else None,
        )
        for side in SIDES
    ]


def _body_style(pages: list[PageFacts], skipped: set[int]) -> tuple[str, float] | None:
    weights: Counter[tuple[str, float]] = Counter()
    for index, facts in enumerate(pages):
        if index in skipped:
            continue
        for line in facts.body:
            weights[(line.family, line.size)] += line.chars
    return weights.most_common(1)[0][0] if weights else None


def _page_main(facts: PageFacts, size: float | None) -> tuple[str, float] | None:
    weights: Counter[tuple[str, float]] = Counter()
    for line in facts.body:
        if size is None or abs(line.size - size) <= SIZE_TOLERANCE_PT:
            weights[(line.family, line.size)] += line.chars
    if sum(weights.values()) < MIN_PAGE_CHARS:
        return None
    return weights.most_common(1)[0][0]


def _font_check(
    pages: list[PageFacts], params: ThesisCheckParams, family: str, size: float
) -> ThesisCheckItem:
    if not params.font_family.strip():
        return ThesisCheckItem(id="bodyFont", status="skip", found=family or None)
    expected = family_name(params.font_family) or params.font_family.strip()
    wanted = family_key(params.font_family)
    if not family:
        return ThesisCheckItem(
            id="bodyFont", status="warn", expected=expected, reason="unknownFont"
        )
    odd: list[Finding] = []
    for number, facts in enumerate(pages, start=1):
        main = _page_main(facts, size)
        if main and main[0] and family_key(main[0]) != wanted:
            odd.append(Finding(number, expected, main[0]))
    item = _item("bodyFont", odd, "warn", expected, family)
    if family_key(family) != wanted:
        item.status = "fail"
    return item


def _size_check(
    pages: list[PageFacts], params: ThesisCheckParams, size: float, skipped: set[int]
) -> ThesisCheckItem:
    expected = f"{params.font_size:g}"
    if abs(size - params.font_size) <= SIZE_TOLERANCE_PT:
        return ThesisCheckItem(id="bodySize", status="pass", expected=expected, found=f"{size:g}")
    odd: list[Finding] = []
    for number, facts in enumerate(pages, start=1):
        main = _page_main(facts, None)
        if number - 1 in skipped or main is None:
            continue
        if abs(main[1] - params.font_size) > SIZE_TOLERANCE_PT:
            odd.append(Finding(number, expected, f"{main[1]:g}"))
    item = _item("bodySize", odd, "fail", expected, f"{size:g}")
    item.status = "fail"
    return item


def _spacing_check(
    pages: list[PageFacts], params: ThesisCheckParams, size: float, skipped: set[int]
) -> ThesisCheckItem:
    low = params.line_height - 0.08
    high = params.line_height * 1.17 + 0.08
    expected = f"{params.line_height:g}"
    every: list[float] = []
    odd: list[Finding] = []
    for number, facts in enumerate(pages, start=1):
        if number - 1 in skipped:
            continue
        gaps = line_gaps(facts, size)
        every.extend(gaps)
        if len(gaps) >= MIN_PAGE_GAPS and not low <= statistics.median(gaps) / size <= high:
            odd.append(Finding(number, expected, f"{statistics.median(gaps):.1f}"))
    if not every:
        return ThesisCheckItem(id="lineSpacing", status="skip")
    ratio = statistics.median(every) / size
    item = _item("lineSpacing", odd, "warn", expected, f"{statistics.median(every):.1f}")
    if not low <= ratio <= high:
        item.status = "fail"
    return item


def _style_label(style: tuple[str, float, bool]) -> str:
    family, size, bold = style
    return f"{family}|{size:g}|{'bold' if bold else 'regular'}"


def _heading_check(pages: list[PageFacts], size: float) -> ThesisCheckItem:
    styles: dict[int, Counter[tuple[str, float, bool]]] = {}
    places: list[tuple[int, int, tuple[str, float, bool], str]] = []
    for number, facts in enumerate(pages, start=1):
        frame = text_frame(facts)
        for line in facts.body:
            level = heading_level(line, facts, size, frame)
            if level is None:
                continue
            style = (line.family, line.size, line.bold)
            styles.setdefault(level, Counter())[style] += 1
            places.append((number, level, style, line.text[:80]))
    if not places:
        return ThesisCheckItem(id="headings", status="skip")
    odd: list[Finding] = []
    for number, level, style, text in places:
        usual = styles[level].most_common(1)[0][0]
        if sum(styles[level].values()) >= 2 and style != usual:
            note = f"level{level}"
            odd.append(Finding(number, _style_label(usual), _style_label(style), note, text))
    return _item("headings", odd, "warn")


def _number_place(place: NumberPlace, value: int) -> str | None:
    if place == "any":
        return None
    if place == "outside":
        return "right" if value % 2 else "left"
    return place


def _number_checks(
    pages: list[PageFacts], params: ThesisCheckParams, chapter_index: int | None
) -> list[ThesisCheckItem]:
    numbers = [facts.number for facts in pages]
    if not any(numbers):
        return [ThesisCheckItem(id="pageNumbers", status="fail", page_total=len(pages))]
    review = review_numbers(
        numbers, [has_text(facts) for facts in pages], params.front_roman, chapter_index
    )
    misplaced = [
        Finding(index + 1, wanted, number.place)
        for index, number in enumerate(numbers)
        if number
        and (wanted := _number_place(params.page_numbers, number.value))
        and number.place != wanted
    ]
    place_item = (
        ThesisCheckItem(id="pageNumberPlace", status="skip", expected="any")
        if params.page_numbers == "any"
        else _item("pageNumberPlace", misplaced, "fail", params.page_numbers)
    )
    if not params.front_roman:
        roman_item = ThesisCheckItem(id="frontRoman", status="skip")
    else:
        roman_item = _item("frontRoman", review.front, "warn", "roman")
        roman_item.status = "pass" if review.front_ok else "warn"
    return [
        _item("pageNumbers", review.missing, "warn"),
        place_item,
        _item("pageNumberOrder", review.order, "fail"),
        roman_item,
    ]


def _chapter_index(pages: list[PageFacts], size: float | None) -> int | None:
    if size is None:
        return None
    return next(
        (index for index, facts in enumerate(pages) if chapter_one(facts, size)),
        None,
    )


def _text_check(pages: list[PageFacts], front_end: int) -> ThesisCheckItem:
    findings = [
        Finding(number, note="unreadable" if facts.unreadable else "scanned")
        for number, facts in enumerate(pages, start=1)
        if facts.unreadable or (number - 1 >= front_end and not has_text(facts) and facts.has_image)
    ]
    return _item("text", findings, "warn")


def build_thesis_report(pages: list[PageFacts], params: ThesisCheckParams) -> ThesisCheckReport:
    text_pages = [number for number, facts in enumerate(pages, start=1) if has_text(facts)]
    if not text_pages:
        raise OpError(ErrorCode.UNSUPPORTED, "the document has no text layer", {"reason": "noText"})
    split_body(pages)
    style = _body_style(pages, set())
    chapter_index = _chapter_index(pages, style[1] if style else None)
    first_arabic = next(
        (
            index
            for index, facts in enumerate(pages)
            if facts.number and facts.number.kind == "arabic"
        ),
        None,
    )
    front_end = next((value for value in (chapter_index, first_arabic) if value is not None), 0)
    references = reference_pages(pages, front_end)
    style = _body_style(pages, references) or style
    checks = [_text_check(pages, front_end), _paper_check(pages, params.paper)]
    checks.extend(_margin_checks(pages, params))
    if style:
        family, size = style
        checks.append(_font_check(pages, params, family, size))
        checks.append(_size_check(pages, params, size, references))
        checks.append(_spacing_check(pages, params, size, references))
        checks.append(_heading_check(pages, size))
    checks.extend(_number_checks(pages, params, chapter_index))
    return ThesisCheckReport(
        page_count=len(pages),
        text_pages=len(text_pages),
        checks=checks,
        ready=all(check.status != "fail" for check in checks),
    )


def _frame(params: ThesisCheckParams) -> tuple[float, float, float, float]:
    margins = params.margins_mm
    left, right = margins.left, margins.right
    if params.mirrored:
        left = right = max(left, right)
    values = (margins.top, margins.bottom, left, right)
    return tuple(max(0.0, value - params.tolerance_mm) / MM for value in values)


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
        frame = _frame(params)
        for index in range(total):
            progress.check_cancelled()
            if index % 10 == 0:
                progress.report(
                    index / total, "progress.inspecting", {"current": index + 1, "total": total}
                )
            pages.append(read_page(document, index, frame))
    return build_thesis_report(pages, params)
