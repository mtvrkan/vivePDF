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
PAGE_BREAK = re.compile(r"""<div\s+class\s*=\s*(["'])page-break\1\s*>""", re.IGNORECASE)

Reserve = Callable[[tuple[int, ...], float], float]
Slot = tuple[int, int, pymupdf.Rect]


@dataclass(frozen=True)
class Plan:
    full_width: int = 0
    page_starts: frozenset[int] = field(default_factory=frozenset)
    notes: frozenset[tuple[int, int, int]] = field(default_factory=frozenset)

    def notes_in(self, page: int, column: int) -> tuple[int, ...]:
        return tuple(sorted(number for on, at, number in self.notes if on == page and at == column))


@dataclass(frozen=True)
class Frame:
    mediabox: pymupdf.Rect
    where: pymupdf.Rect
    columns: int = 1
    gap: float = 0.0

    def area(self, index: int, cut: float = 0.0) -> pymupdf.Rect:
        bottom = self.where.y1 - cut
        if self.columns == 1 or index < 0:
            return pymupdf.Rect(self.where.x0, self.where.y0, self.where.x1, bottom)
        width = (self.where.width - self.gap * (self.columns - 1)) / self.columns
        left = self.where.x0 + index * (width + self.gap)
        return pymupdf.Rect(left, self.where.y0, left + width, bottom)

    def narrowest(self) -> float:
        return self.area(0).width


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
    if frame.columns > 1:
        starts = frozenset(position.rect_num - 1 for position in _opened(positions, BREAK_PREFIX))
    notes: frozenset[tuple[int, int, int]] = frozenset()
    if slots is not None:
        found = frozenset(
            (page, column, number)
            for number, (page, column) in note_slots(positions, slots).items()
        )
        notes = previous.notes | found
    return Plan(full_width, starts, notes)


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

    def _place(self, column: int) -> pymupdf.Rect:
        area = self.frame.area(column)
        notes = self.plan.notes_in(self.pages, column)
        cut = self.reserve(notes, area.width) if self.reserve and notes else 0.0
        self.column = column
        self.slots.append((self.pages, column, area))
        return self.frame.area(column, cut)

    def _page(self, column: int):
        self.pages += 1
        if self.pages > MAX_STORY_PAGES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"the document would have more than {MAX_STORY_PAGES} pages",
                {"reason": "tooManyPages", "limit": MAX_STORY_PAGES},
            )
        return self.frame.mediabox, self._place(column), None

    def __call__(self, number: int, _filled: pymupdf.Rect):
        self.check_cancelled()
        frame = self.frame
        if frame.columns == 1 or number < self.plan.full_width:
            return self._page(-1)
        fresh = number == self.plan.full_width or number in self.plan.page_starts
        if fresh or self.column < 0 or self.column >= frame.columns - 1:
            return self._page(0)
        return None, self._place(self.column + 1), None


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
