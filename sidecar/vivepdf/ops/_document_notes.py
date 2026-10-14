import html
import re
from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._document_flow import NOTE_PREFIX, Flowed, Frame, note_pages

NOTE_SCALE = 0.8
RULE_GAP = 8.0
RULE_OFFSET = 3.0
RULE_SHARE = 0.3
RULE_COLOUR = (0.6, 0.6, 0.6)
MEASURE_HEIGHT = 100_000.0
NOTE_LIMIT_SHARE = 1 / 3
PAGE_LIMIT_SHARE = 1 / 2
MARKER = re.compile(
    rf"""<sup\s+class="fn-ref"\s+id="{NOTE_PREFIX}(\d+)">(\d+)</sup>""", re.IGNORECASE
)


def note_css(font_size: float) -> str:
    size = font_size * NOTE_SCALE
    return (
        f".fn{{font-size:{size:.1f}pt;line-height:1.3;margin:0 0 2pt 0;text-indent:0;}}"
        ".fn-number{font-weight:bold;}"
        f".endnotes-title{{font-weight:bold;font-size:{font_size * 1.25:.1f}pt;"
        f"margin:{font_size:.1f}pt 0 {font_size * 0.5:.1f}pt 0;}}"
    )


def marked_numbers(body: str, count: int) -> list[int]:
    found = {int(match.group(1)) for match in MARKER.finditer(body)}
    return sorted(number for number in found if 1 <= number <= count)


def _note_html(number: int, text: str, anchor: bool) -> str:
    target = f' id="fn-{number}"' if anchor else ""
    return f'<p class="fn"{target}><span class="fn-number">{number}.</span> {html.escape(text)}</p>'


def with_endnotes(body: str, texts: list[str], title: str) -> str:
    numbers = marked_numbers(body, len(texts))
    if not numbers:
        return body
    valid = set(numbers)

    def linked(match: re.Match) -> str:
        number = int(match.group(1))
        if number not in valid:
            return match.group(0)
        return (
            f'<sup class="fn-ref" id="{NOTE_PREFIX}{number}">'
            f'<a href="#fn-{number}">{match.group(2)}</a></sup>'
        )

    heading = f'<p class="endnotes-title">{html.escape(title.strip())}</p>' if title.strip() else ""
    notes = "".join(_note_html(number, texts[number - 1], True) for number in numbers)
    return f'{MARKER.sub(linked, body)}<div class="endnotes">{heading}{notes}</div>'


@dataclass
class Footnotes:
    texts: list[str]
    css: str
    archive: pymupdf.Archive
    frame: Frame
    inset: float = 0.0
    heights: dict[tuple[int, ...], float] = field(default_factory=dict)
    overflow: bool = False

    def _html(self, numbers: tuple[int, ...]) -> str:
        return "".join(_note_html(number, self.texts[number - 1], False) for number in numbers)

    def measure(self, numbers: tuple[int, ...]) -> float:
        if not numbers:
            return 0.0
        if numbers not in self.heights:
            story = pymupdf.Story(self._html(numbers), user_css=self.css, archive=self.archive)
            more, filled = story.place(pymupdf.Rect(0, 0, self.frame.where.width, MEASURE_HEIGHT))
            self.heights[numbers] = MEASURE_HEIGHT if more else pymupdf.Rect(filled).y1
        return self.heights[numbers]

    def _valid(self, numbers: tuple[int, ...]) -> tuple[int, ...]:
        return tuple(number for number in numbers if 1 <= number <= len(self.texts))

    def fit(self, numbers: list[int]) -> bool:
        limit = self.frame.where.height * NOTE_LIMIT_SHARE
        return all(self.measure((number,)) + RULE_GAP <= limit for number in numbers)

    def reserve(self, numbers: tuple[int, ...]) -> float:
        valid = self._valid(numbers)
        if not valid:
            return 0.0
        needed = self.measure(valid) + RULE_GAP
        limit = self.frame.where.height * PAGE_LIMIT_SHARE
        if needed > limit:
            self.overflow = True
            return limit
        return needed

    def draw(self, flowed: Flowed) -> None:
        markers = _marker_rects(flowed.positions)
        by_page: dict[int, list[int]] = {}
        for number, page in note_pages(flowed.positions).items():
            if 1 <= number <= len(self.texts):
                by_page.setdefault(page, []).append(number)
        where = self.frame.where
        for page_number, found in by_page.items():
            numbers = tuple(sorted(found))
            page = flowed.document[page_number - 1]
            height = self.measure(numbers)
            top = where.y1 - height - RULE_GAP
            rule = top + RULE_OFFSET
            page.draw_line(
                pymupdf.Point(where.x0 + self.inset, rule),
                pymupdf.Point(where.x0 + self.inset + where.width * RULE_SHARE, rule),
                color=RULE_COLOUR,
                width=0.5,
            )
            box = pymupdf.Rect(where.x0, top + RULE_GAP, where.x1, top + RULE_GAP + height + 1)
            page.insert_htmlbox(
                box, self._html(numbers), css=self.css, archive=self.archive, scale_low=1
            )
            for index, number in enumerate(numbers):
                marker = markers.get(number)
                if marker is None or marker.is_empty:
                    continue
                above = self.measure(numbers[:index])
                target = pymupdf.Point(where.x0 + self.inset, box.y0 + above)
                page.insert_link(
                    {
                        "kind": pymupdf.LINK_GOTO,
                        "from": marker,
                        "page": page_number - 1,
                        "to": target,
                    }
                )


def _marker_rects(positions: list) -> dict[int, pymupdf.Rect]:
    rects: dict[int, pymupdf.Rect] = {}
    pages: dict[int, int] = {}
    for position in positions:
        if not position.id or not position.id.startswith(NOTE_PREFIX):
            continue
        suffix = position.id[len(NOTE_PREFIX) :]
        if not suffix.isdigit():
            continue
        number = int(suffix)
        if pages.setdefault(number, position.page_num) != position.page_num:
            continue
        rect = pymupdf.Rect(position.rect)
        rects[number] = rects[number] | rect if number in rects else rect
    return rects
