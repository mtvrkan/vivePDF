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
    r"""<div\s+class\s*=\s*(["'])section-break\1\s+data-columns\s*=\s*(["'])([^"']{0,8})\2"""
    r"""(?:\s+data-kind\s*=\s*(["'])([^"']{0,16})\4)?\s*>\s*</div\s*>""",
    re.IGNORECASE,
)
TAG = re.compile(r"<[^>]*>")
SOLID = re.compile(r"<(img|table|hr|li|svg)\b", re.IGNORECASE)
SECTION_COLUMNS = (1, 2, 3)
CONTINUOUS = "continuous"
BAND_GAP = 12.0
MIN_BAND_HEIGHT = 36.0
BALANCE_SLACK = 2.0
BALANCE_STEP = 6.0

Reserve = Callable[[tuple[int, ...], float], float]
Slot = tuple[int, int, pymupdf.Rect]


@dataclass(frozen=True)
class Plan:
    full_width: int = 0
    page_starts: frozenset[int] = field(default_factory=frozenset)
    notes: frozenset[tuple[int, int, int]] = field(default_factory=frozenset)
    sections: tuple[tuple[int, int, int], ...] = ()
    caps: tuple[tuple[int, int, float], ...] = ()

    def section_at(self, number: int, first: int) -> tuple[int, int]:
        section, columns = 0, first
        for start, count, marker in self.sections:
            if start > number:
                break
            section, columns = marker + 1, count
        return section, columns

    def cap(self, section: int, page: int) -> float | None:
        return next((height for on, at, height in self.caps if (on, at) == (section, page)), None)

    def notes_in(self, page: int, column: int) -> tuple[int, ...]:
        return tuple(sorted(number for on, at, number in self.notes if on == page and at == column))


@dataclass(frozen=True)
class Frame:
    mediabox: pymupdf.Rect
    where: pymupdf.Rect
    columns: int = 1
    gap: float = 0.0
    sections: tuple[int, ...] = ()
    flowing: frozenset[int] = field(default_factory=frozenset)

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

    def columns_of(self, section: int) -> int:
        return self.columns if section == 0 else self.sections[section - 1]

    @property
    def sectioned(self) -> bool:
        return self.columns > 1 or any(count > 1 for count in self.sections) or bool(self.flowing)


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


def sectioned(body: str, first: int) -> tuple[str, int, tuple[int, ...], frozenset[int]]:
    pieces: list[str] = []
    columns: list[int] = []
    flowing: set[int] = set()
    cursor = 0
    started = False
    pending: int | None = None
    pending_flows = False

    def opened() -> str:
        if pending_flows:
            flowing.add(len(columns))
        marker = f'<div class="page-break" id="{SECTION_PREFIX}{len(columns)}"></div>'
        columns.append(pending or 1)
        return marker

    for match in SECTION_BREAK.finditer(body):
        count = _section_columns(match.group(3))
        flows = (match.group(5) or "").strip().lower() == CONTINUOUS
        segment = body[cursor : match.start()]
        cursor = match.end()
        if _has_content(segment):
            if pending is not None:
                pieces.append(opened())
            pieces.append(segment)
            started = True
            pending_flows = flows
        else:
            pieces.append(PLAIN_BREAK.sub("", segment))
            pending_flows = pending_flows and flows and not PAGE_BREAK.search(segment)
        if started:
            pending = count
        else:
            first = count
    tail = body[cursor:]
    if pending is not None and _has_content(tail):
        pieces.append(opened())
    pieces.append(tail)
    return "".join(pieces), first, tuple(columns), frozenset(flowing)


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


@dataclass
class _Band:
    section: int
    columns: int
    top: float
    cap: float | None
    column: int
    extended: bool = False


@dataclass(frozen=True)
class _Record:
    page: int
    section: int
    band: int
    top: float


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
        self.pages = 0
        self.bands = 0
        self.band: _Band | None = None
        self.bottom = frame.where.y0
        self.slots: list[Slot] = []
        self.records: list[_Record] = []
        self.filled: list[pymupdf.Rect] = []
        self.starts = {start: marker for start, _, marker in plan.sections}

    def _cut(self, column: int, columns: int) -> tuple[float, Slot]:
        if self.frame.flowing:
            column, columns = -1, 1
        area = self.frame.area(column, columns=columns)
        notes = self.plan.notes_in(self.pages, column)
        cut = self.reserve(notes, area.width) if self.reserve and notes else 0.0
        return cut, (self.pages, column, area)

    def _rect(self, band: _Band, top: float, limit: float | None) -> pymupdf.Rect:
        cut, slot = self._cut(band.column, band.columns)
        self.slots.append(slot)
        self.records.append(_Record(self.pages, band.section, self.bands, top))
        area = self.frame.area(band.column, cut, band.columns)
        bottom = area.y1 if limit is None else min(area.y1, limit)
        return pymupdf.Rect(area.x0, top, area.x1, max(bottom, top + 1))

    def _room(self) -> bool:
        cut, _slot = self._cut(-1, 1)
        return self.frame.where.y1 - cut - (self.bottom + BAND_GAP) >= MIN_BAND_HEIGHT

    def _band(self, section: int, columns: int, new_page: bool):
        if new_page:
            self.pages += 1
            if self.pages > MAX_STORY_PAGES:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"the document would have more than {MAX_STORY_PAGES} pages",
                    {"reason": "tooManyPages", "limit": MAX_STORY_PAGES},
                )
            top = self.frame.where.y0
        else:
            top = self.bottom + BAND_GAP
        self.bands += 1
        self.bottom = top
        height = self.plan.cap(section, self.pages) if columns > 1 else None
        cap = None if height is None else top + height
        band = _Band(section, columns, top, cap, -1 if columns == 1 else 0)
        self.band = band
        return self.frame.mediabox if new_page else None, self._rect(band, top, cap), None

    def __call__(self, number: int, filled: pymupdf.Rect):
        self.check_cancelled()
        if number > 0:
            used = pymupdf.Rect(filled)
            self.filled.append(used)
            if not used.is_empty:
                self.bottom = max(self.bottom, used.y1)
        if number < self.plan.full_width:
            return self._band(0, 1, True)
        section, columns = self.plan.section_at(number, self.frame.columns)
        band = self.band
        marker = self.starts.get(number)
        if band is None or number == self.plan.full_width or number in self.plan.page_starts:
            return self._band(section, columns, True)
        if marker is not None:
            return self._band(
                section, columns, marker not in self.frame.flowing or not self._room()
            )
        if 0 <= band.column < band.columns - 1:
            band.column += 1
            return None, self._rect(band, band.top, band.cap), None
        if band.cap is not None and not band.extended:
            band.extended = True
            cut, _slot = self._cut(band.column, band.columns)
            if self.frame.where.y1 - cut - band.cap >= MIN_BAND_HEIGHT:
                return None, self._rect(band, band.cap, None), None
        return self._band(section, columns, True)


def _caps(frame: Frame, previous: Plan, rects: _Rects, sections: list) -> tuple:
    caps: list[tuple[int, int, float]] = []
    for start, _count, marker in sections:
        section = marker
        columns = frame.columns_of(section) if section <= len(frame.sections) else 1
        last = start - 1
        if marker not in frame.flowing or columns < 2 or not 0 <= last < len(rects.filled):
            continue
        record = rects.records[last]
        members = [
            index
            for index, other in enumerate(rects.records[: len(rects.filled)])
            if other.band == record.band
        ]
        used = sum(
            max(0.0, rects.filled[index].y1 - rects.records[index].top)
            for index in members
            if not rects.filled[index].is_empty
        )
        if used <= 0:
            continue
        earlier = previous.cap(section, record.page)
        if earlier is None:
            height = used / columns + BALANCE_SLACK
        elif len(members) > columns:
            height = max(earlier + BALANCE_STEP, used / columns + BALANCE_SLACK)
        else:
            height = earlier
        caps.append((section, record.page, round(height, 2)))
    return tuple(sorted(caps))


def plan_from(
    positions: list, frame: Frame, previous: Plan, rects: _Rects, with_notes: bool
) -> Plan:
    toc = _opened(positions, TOC_END)
    full_width = toc[0].rect_num - 1 if toc else 0
    starts: frozenset[int] = frozenset()
    sections: list[tuple[int, int, int]] = []
    if frame.sectioned:
        starts = frozenset(position.rect_num - 1 for position in _opened(positions, BREAK_PREFIX))
        for position in _opened(positions, SECTION_PREFIX):
            index = position.id[len(SECTION_PREFIX) :]
            if index.isdigit() and int(index) < len(frame.sections):
                sections.append((position.rect_num - 1, frame.sections[int(index)], int(index)))
    notes: frozenset[tuple[int, int, int]] = frozenset()
    if with_notes:
        found = frozenset(
            (page, column, number)
            for number, (page, column) in note_slots(positions, rects.slots).items()
        )
        notes = previous.notes | found
    caps = _caps(frame, previous, rects, sections) if frame.flowing else ()
    return Plan(full_width, starts, notes, tuple(sorted(sections)), caps)


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
        next_plan = plan_from(positions, frame, plan, rects, reserve is not None)
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
