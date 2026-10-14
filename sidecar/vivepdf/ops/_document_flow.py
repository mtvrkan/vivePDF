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
PAGE_BREAK = re.compile(r"""<div\s+class\s*=\s*(["'])page-break\1\s*>""", re.IGNORECASE)


@dataclass(frozen=True)
class Plan:
    full_width: int = 0
    page_starts: frozenset[int] = field(default_factory=frozenset)


@dataclass(frozen=True)
class Frame:
    mediabox: pymupdf.Rect
    where: pymupdf.Rect
    columns: int = 1
    gap: float = 0.0

    def column(self, index: int) -> pymupdf.Rect:
        if self.columns == 1:
            return self.where
        width = (self.where.width - self.gap * (self.columns - 1)) / self.columns
        left = self.where.x0 + index * (width + self.gap)
        return pymupdf.Rect(left, self.where.y0, left + width, self.where.y1)


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


def plan_from(positions: list, frame: Frame) -> Plan:
    toc = _opened(positions, TOC_END)
    full_width = toc[0].rect_num - 1 if toc else 0
    if frame.columns == 1:
        return Plan(full_width)
    starts = frozenset(position.rect_num - 1 for position in _opened(positions, BREAK_PREFIX))
    return Plan(full_width, starts)


class _Rects:
    def __init__(self, plan: Plan, frame: Frame, check_cancelled: Callable[[], None]):
        self.plan = plan
        self.frame = frame
        self.check_cancelled = check_cancelled
        self.column = -1
        self.pages = 0

    def _page(self, where: pymupdf.Rect):
        self.pages += 1
        if self.pages > MAX_STORY_PAGES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"the document would have more than {MAX_STORY_PAGES} pages",
                {"reason": "tooManyPages", "limit": MAX_STORY_PAGES},
            )
        return self.frame.mediabox, where, None

    def __call__(self, number: int, _filled: pymupdf.Rect):
        self.check_cancelled()
        frame = self.frame
        if frame.columns == 1 or number < self.plan.full_width:
            return self._page(frame.where)
        fresh = number == self.plan.full_width or number in self.plan.page_starts
        if fresh or self.column < 0 or self.column >= frame.columns - 1:
            self.column = 0
            return self._page(frame.column(0))
        self.column += 1
        return None, frame.column(self.column), None


def flow(
    content: Callable[[list], str],
    frame: Frame,
    initial: Plan,
    story: Callable[[str], pymupdf.Story],
    check_cancelled: Callable[[], None],
) -> tuple[pymupdf.Document, list]:
    plan = initial
    text = content([])
    for _ in range(MAX_LAYOUT_PASSES):
        positions: list = []
        story(text).write(None, _Rects(plan, frame, check_cancelled), positions.append)
        following, next_plan = content(positions), plan_from(positions, frame)
        if following == text and next_plan == plan:
            break
        text, plan = following, next_plan
    stream = io.BytesIO()
    writer = pymupdf.DocumentWriter(stream)
    positions = []
    story(text).write(writer, _Rects(plan, frame, check_cancelled), positions.append)
    writer.close()
    stream.seek(0)
    return pymupdf.Story.add_pdf_links(stream, positions), positions
