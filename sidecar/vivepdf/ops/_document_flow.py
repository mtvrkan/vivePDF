import io
import itertools
import re
from collections.abc import Callable
from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._story import MAX_STORY_PAGES
from vivepdf.rpc.errors import ErrorCode, OpError

MAX_LAYOUT_PASSES = 6
TOC_END = "vp-toc-end"
BREAK_PREFIX = "vp-break-"
NOTE_PREFIX = "fnref-"
SECTION_PREFIX = "vp-section-"
PAGE_BREAK = re.compile(r"""<div\s+class\s*=\s*(["'])page-break\1\s*>""", re.IGNORECASE)
PLAIN_BREAK = re.compile(
    r"""<div\s+class\s*=\s*(["'])page-break\1\s*>\s*</div\s*>""", re.IGNORECASE
)
SECTION_BREAK = re.compile(
    r"""<div\s+class\s*=\s*(["'])section-break\1\s+data-columns\s*=\s*(["'])([^"']{0,8})\2\s*>"""
    r"""\s*</div\s*>""",
    re.IGNORECASE,
)
TAG = re.compile(r"<[^>]*>")
SOLID = re.compile(r"<(img|table|hr|li|svg)\b", re.IGNORECASE)
SECTION_COLUMNS = (1, 2, 3)

Reserve = Callable[[tuple[int, ...], float], float]
Slot = tuple[int, int, pymupdf.Rect]


@dataclass(frozen=True)
class Plan:
    full_width: int = 0
    page_starts: frozenset[int] = field(default_factory=frozenset)
    notes: frozenset[tuple[int, int, int]] = field(default_factory=frozenset)
    sections: tuple[tuple[int, int], ...] = ()

    def columns_at(self, number: int, first: int) -> int:
        columns = first
        for start, count in self.sections:
            if start > number:
                break
            columns = count
        return columns

    def notes_in(self, page: int, column: int) -> tuple[int, ...]:
        return tuple(sorted(number for on, at, number in self.notes if on == page and at == column))


@dataclass(frozen=True)
class Frame:
    mediabox: pymupdf.Rect
    where: pymupdf.Rect
    columns: int = 1
    gap: float = 0.0
    sections: tuple[int, ...] = ()

    def area(self, index: int, cut: float = 0.0, columns: int | None = None) -> pymupdf.Rect:
        count = columns or self.columns
        bottom = self.where.y1 - cut
        if count == 1 or index < 0:
            return pymupdf.Rect(self.where.x0, self.where.y0, self.where.x1, bottom)
        width = (self.where.width - self.gap * (count - 1)) / count
        left = self.where.x0 + index * (width + self.gap)
        return pymupdf.Rect(left, self.where.y0, left + width, bottom)

    def narrowest(self) -> float:
        return min(self.area(0, columns=count).width for count in {self.columns, *self.sections})

    @property
    def sectioned(self) -> bool:
        return self.columns > 1 or any(count > 1 for count in self.sections)


@dataclass
class Flowed:
    document: pymupdf.Document
    positions: list
    plan: Plan
    settled: bool
    slots: list[Slot] = field(default_factory=list)


def numbered_breaks(body: str) -> str:
    counter = itertools.count()
    return PAGE_BREAK.sub(
        lambda _: f'<div class="page-break" id="{BREAK_PREFIX}{next(counter)}">', body
    )


def _has_content(fragment: str) -> bool:
    return bool(TAG.sub("", fragment).replace("&nbsp;", " ").strip()) or bool(
        SOLID.search(fragment)
    )


def _section_columns(raw: str) -> int:
    count = int(raw) if raw.strip().isdigit() else 0
    if count not in SECTION_COLUMNS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "a section break must have 1, 2 or 3 columns",
            {"reason": "badSectionColumns"},
        )
    return count


def sectioned(body: str, first: int) -> tuple[str, int, tuple[int, ...]]:
    pieces: list[str] = []
    columns: list[int] = []
    cursor = 0
    started = False
    pending: int | None = None
    for match in SECTION_BREAK.finditer(body):
        count = _section_columns(match.group(3))
        segment = body[cursor : match.start()]
        cursor = match.end()
        if _has_content(segment):
            if pending is not None:
                pieces.append(f'<div class="page-break" id="{SECTION_PREFIX}{len(columns)}"></div>')
                columns.append(pending)
            pieces.append(segment)
            started = True
        else:
            pieces.append(PLAIN_BREAK.sub("", segment))
        if started:
            pending = count
        else:
            first = count
    tail = body[cursor:]
    if pending is not None and _has_content(tail):
        pieces.append(f'<div class="page-break" id="{SECTION_PREFIX}{len(columns)}"></div>')
        columns.append(pending)
    pieces.append(tail)
    return "".join(pieces), first, tuple(columns)


def _opened(positions: list, prefix: str) -> list:
    return [
        position
        for position in positions
        if position.id and position.id.startswith(prefix) and position.open_close & 1
    ]


def note_slots(positions: list, slots: list[Slot]) -> dict[int, tuple[int, int]]:
    found: dict[int, tuple[int, int]] = {}
    for position in _opened(positions, NOTE_PREFIX):
        number = position.id[len(NOTE_PREFIX) :]
        index = position.rect_num - 1
        if number.isdigit() and 0 <= index < len(slots):
            page, column, _ = slots[index]
            found.setdefault(int(number), (page, column))
    return found


def plan_from(positions: list, frame: Frame, previous: Plan, slots: list[Slot] | None) -> Plan:
    toc = _opened(positions, TOC_END)
    full_width = toc[0].rect_num - 1 if toc else 0
    starts: frozenset[int] = frozenset()
    sections: list[tuple[int, int]] = []
    if frame.sectioned:
        starts = frozenset(position.rect_num - 1 for position in _opened(positions, BREAK_PREFIX))
        for position in _opened(positions, SECTION_PREFIX):
            index = position.id[len(SECTION_PREFIX) :]
            if index.isdigit() and int(index) < len(frame.sections):
                sections.append((position.rect_num - 1, frame.sections[int(index)]))
    notes: frozenset[tuple[int, int, int]] = frozenset()
    if slots is not None:
        found = frozenset(
            (page, column, number)
            for number, (page, column) in note_slots(positions, slots).items()
        )
        notes = previous.notes | found
    return Plan(full_width, starts, notes, tuple(sorted(sections)))


class _Rects:
    def __init__(
        self,
        plan: Plan,
        frame: Frame,
        reserve: Reserve | None,
        check_cancelled: Callable[[], None],
    ):
        self.plan = plan
        self.frame = frame
        self.reserve = reserve
        self.check_cancelled = check_cancelled
        self.column = -1
        self.pages = 0
        self.slots: list[Slot] = []

    def _place(self, column: int, columns: int) -> pymupdf.Rect:
        area = self.frame.area(column, columns=columns)
        notes = self.plan.notes_in(self.pages, column)
        cut = self.reserve(notes, area.width) if self.reserve and notes else 0.0
        self.column = column
        self.slots.append((self.pages, column, area))
        return self.frame.area(column, cut, columns)

    def _page(self, column: int, columns: int):
        self.pages += 1
        if self.pages > MAX_STORY_PAGES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"the document would have more than {MAX_STORY_PAGES} pages",
                {"reason": "tooManyPages", "limit": MAX_STORY_PAGES},
            )
        return self.frame.mediabox, self._place(column, columns), None

    def __call__(self, number: int, _filled: pymupdf.Rect):
        self.check_cancelled()
        columns = self.plan.columns_at(number, self.frame.columns)
        if columns == 1 or number < self.plan.full_width:
            return self._page(-1, 1)
        starts = {start for start, _ in self.plan.sections}
        fresh = (
            number == self.plan.full_width or number in self.plan.page_starts or number in starts
        )
        if fresh or self.column < 0 or self.column >= columns - 1:
            return self._page(0, columns)
        return None, self._place(self.column + 1, columns), None


def flow(
    content: Callable[[list], str],
    frame: Frame,
    initial: Plan,
    story: Callable[[str], pymupdf.Story],
    check_cancelled: Callable[[], None],
    reserve: Reserve | None = None,
) -> Flowed:
    plan = initial
    text = content([])
    settled = False
    for _ in range(MAX_LAYOUT_PASSES):
        positions: list = []
        rects = _Rects(plan, frame, reserve, check_cancelled)
        story(text).write(None, rects, positions.append)
        following = content(positions)
        next_plan = plan_from(positions, frame, plan, rects.slots if reserve else None)
        if following == text and next_plan == plan:
            settled = True
            break
        text, plan = following, next_plan
    stream = io.BytesIO()
    writer = pymupdf.DocumentWriter(stream)
    positions = []
    rects = _Rects(plan, frame, reserve, check_cancelled)
    story(text).write(writer, rects, positions.append)
    writer.close()
    stream.seek(0)
    document = pymupdf.Story.add_pdf_links(stream, positions)
    return Flowed(document, positions, plan, settled, rects.slots)
