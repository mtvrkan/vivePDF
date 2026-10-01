import re
import statistics

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops.textedit import _page_at
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MONO_FONT = re.compile(
    r"mono|courier|consolas|menlo|monaco|fira ?code|source ?code|jetbrains|inconsolata|"
    r"lucida ?console|cascadia|hack|andale|nimbus ?mono|sf ?mono|plex ?mono|roboto ?mono|"
    r"ubuntu ?mono|liberation ?mono|dejavu ?sans ?mono|droid ?sans ?mono|noto ?sans ?mono|"
    r"pt ?mono|anonymous ?pro|iosevka|victor ?mono|space ?mono|overpass ?mono|letter ?gothic",
    re.IGNORECASE,
)
MONO_FLAG = 8
MIN_LINES = 2
LINE_GAP_FACTOR = 2.2
MAX_INDENT = 40


def _hints(*patterns: str, flags: int = 0) -> list[re.Pattern[str]]:
    return [re.compile(pattern, flags) for pattern in patterns]


LANGUAGE_HINTS: list[tuple[str, list[re.Pattern[str]]]] = [
    (
        "python",
        _hints(
            r"^\s*(def|class|import|from)\s+\w", r"^\s*(elif|except|with)\b.*:\s*$", r"\bprint\("
        ),
    ),
    (
        "typescript",
        _hints(
            r"\b(interface|type)\s+\w+\s*[=<{]",
            r":\s*(string|number|boolean)\b",
            r"\bimport .* from ['\"]",
        ),
    ),
    ("javascript", _hints(r"\b(const|let|var)\s+\w+\s*=", r"\bfunction\b|=>", r"console\.log")),
    (
        "java",
        _hints(
            r"\bpublic\s+(static\s+)?(class|void|int|String)\b",
            r"System\.out\.print",
            r"^\s*(import|package)\s+[\w.]+;",
        ),
    ),
    ("csharp", _hints(r"\busing\s+System", r"\bnamespace\s+\w+", r"Console\.Write")),
    ("cpp", _hints(r"#include\s*<", r"\bstd::", r"\bcout\b")),
    ("c", _hints(r"#include\s*[<\"]", r"\bprintf\(", r"\bint\s+main\s*\(")),
    ("go", _hints(r"^\s*package\s+\w+", r"\bfunc\s+\w+\(", r"fmt\.Print")),
    ("rust", _hints(r"\bfn\s+\w+\(", r"\blet\s+mut\b", r"println!")),
    ("kotlin", _hints(r"\bfun\s+\w+\(", r"\bval\s+\w+", r"\bdata class\b")),
    (
        "swift",
        _hints(r"\bfunc\s+\w+\(", r"\bvar\s+\w+\s*:", r"\bimport\s+(Foundation|UIKit|SwiftUI)"),
    ),
    ("php", _hints(r"<\?php", r"\$\w+\s*=", r"\becho\b")),
    (
        "sql",
        _hints(
            r"\b(SELECT|INSERT|UPDATE|DELETE)\b", r"\bFROM\s+\w+", r"\bWHERE\b", flags=re.IGNORECASE
        ),
    ),
    ("html", _hints(r"<(!DOCTYPE|html|div|span|body|head)\b", r"</\w+>", flags=re.IGNORECASE)),
    ("css", _hints(r"^\s*[.#]?[\w-]+\s*\{", r"^\s*[\w-]+\s*:\s*[^;]+;")),
    ("json", _hints(r"^\s*[\[{]", r"\"\w+\"\s*:")),
    (
        "bash",
        _hints(
            r"^#!.*\b(ba|z)?sh\b",
            r"^\s*(sudo|apt|npm|pip|git|cd|ls|echo|export)\s",
            r"\$\{?\w+\}?",
        ),
    ),
    ("yaml", _hints(r"^\s*[\w-]+:\s*($|\S)", r"^\s*-\s+\w")),
]

LINE_NUMBER = re.compile(r"^\s*(\d{1,4})[.:)|]?(\s+|$)")


class CodeBlocksParams(RpcModel):
    path: str
    password: str | None = None
    page: int = Field(ge=0)
    rect: list[float] | None = None
    visible: bool = True


class CodeBlock(RpcModel):
    id: str
    bbox: list[float]
    lines: list[str]
    text: str
    language: str | None
    font: str
    size: float


class CodeBlocksResult(RpcModel):
    width: float
    height: float
    blocks: list[CodeBlock]


class _Line:
    __slots__ = ("bbox", "text", "size", "font", "mono")

    def __init__(self, bbox: pymupdf.Rect, text: str, size: float, font: str, mono: bool) -> None:
        self.bbox = bbox
        self.text = text
        self.size = size
        self.font = font
        self.mono = mono


def is_monospace(font: str, flags: int) -> bool:
    return bool(flags & MONO_FLAG) or bool(MONO_FONT.search(font))


def _collect_lines(page: pymupdf.Page, visible: bool) -> list[_Line]:
    lines: list[_Line] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            spans = [span for span in line["spans"] if span["text"].strip()]
            if not spans:
                continue
            text = "".join(span["text"] for span in line["spans"])
            mono_chars = sum(
                len(span["text"]) for span in spans if is_monospace(span["font"], span["flags"])
            )
            total_chars = sum(len(span["text"]) for span in spans)
            dominant = max(spans, key=lambda span: len(span["text"]))
            bbox = pymupdf.Rect(line["bbox"])
            if visible and page.rotation:
                bbox = bbox * page.rotation_matrix
                bbox.normalize()
            lines.append(
                _Line(
                    bbox,
                    text.rstrip(),
                    dominant["size"],
                    dominant["font"],
                    mono_chars * 2 >= total_chars,
                )
            )
    lines.sort(key=lambda item: (round(item.bbox.y0, 1), item.bbox.x0))
    return lines


def _group(lines: list[_Line]) -> list[list[_Line]]:
    groups: list[list[_Line]] = []
    current: list[_Line] = []
    for line in lines:
        if not line.mono:
            if current:
                groups.append(current)
                current = []
            continue
        if current:
            previous = current[-1]
            gap = line.bbox.y0 - previous.bbox.y0
            same_row = abs(line.bbox.y0 - previous.bbox.y0) < previous.size * 0.5
            if gap > max(previous.size, line.size) * LINE_GAP_FACTOR and not same_row:
                groups.append(current)
                current = []
        current.append(line)
    if current:
        groups.append(current)
    return [group for group in groups if len(group) >= MIN_LINES]


def _merge_rows(group: list[_Line]) -> list[_Line]:
    rows: list[_Line] = []
    for line in group:
        if rows and abs(line.bbox.y0 - rows[-1].bbox.y0) < rows[-1].size * 0.5:
            previous = rows[-1]
            char_width = _char_width([previous]) or previous.size * 0.6
            gap_chars = max(1, round((line.bbox.x0 - previous.bbox.x1) / char_width))
            previous.text = previous.text + " " * gap_chars + line.text
            previous.bbox = previous.bbox | line.bbox
            continue
        rows.append(_Line(pymupdf.Rect(line.bbox), line.text, line.size, line.font, line.mono))
    return rows


def _char_width(lines: list[_Line]) -> float:
    widths = [line.bbox.width / len(line.text) for line in lines if len(line.text.strip()) >= 4]
    return statistics.median(widths) if widths else 0.0


def _strip_line_numbers(rows: list[str]) -> list[str]:
    numbered = [LINE_NUMBER.match(row) for row in rows]
    hits = [match for match in numbered if match]
    if len(hits) * 10 < len(rows) * 6:
        return rows
    values = [int(match.group(1)) for match in hits]
    if any(later <= earlier for earlier, later in zip(values, values[1:], strict=False)):
        return rows
    return [
        row[match.end() :] if match else row for row, match in zip(rows, numbered, strict=False)
    ]


def _reindent(rows: list[_Line]) -> list[str]:
    char_width = _char_width(rows)
    left = min(row.bbox.x0 for row in rows)
    result: list[str] = []
    for row in rows:
        stripped = row.text.lstrip()
        indent = 0
        if char_width > 0:
            indent = min(MAX_INDENT, max(0, round((row.bbox.x0 - left) / char_width)))
        leading = len(row.text) - len(stripped)
        result.append(" " * max(indent, leading) + stripped)
    return result


def guess_language(lines: list[str]) -> str | None:
    best: tuple[int, str | None] = (0, None)
    for language, patterns in LANGUAGE_HINTS:
        score = sum(1 for pattern in patterns for line in lines if pattern.search(line))
        if score > best[0]:
            best = (score, language)
    return best[1] if best[0] >= 2 else None


def _within(bbox: pymupdf.Rect, rect: list[float] | None) -> bool:
    if rect is None:
        return True
    clip = pymupdf.Rect(rect)
    return bool(bbox.intersects(clip)) and (bbox & clip).get_area() >= bbox.get_area() * 0.5


def extract_code_blocks(
    page: pymupdf.Page, rect: list[float] | None = None, visible: bool = True
) -> list[CodeBlock]:
    blocks: list[CodeBlock] = []
    for index, group in enumerate(_group(_collect_lines(page, visible))):
        rows = _merge_rows(group)
        bbox = pymupdf.Rect(rows[0].bbox)
        for row in rows[1:]:
            bbox |= row.bbox
        if not _within(bbox, rect):
            continue
        lines = _strip_line_numbers(_reindent(rows))
        while lines and not lines[-1].strip():
            lines.pop()
        if len(lines) < MIN_LINES:
            continue
        blocks.append(
            CodeBlock(
                id=f"code-{index}",
                bbox=[bbox.x0, bbox.y0, bbox.x1, bbox.y1],
                lines=lines,
                text="\n".join(lines),
                language=guess_language(lines),
                font=rows[0].font,
                size=rows[0].size,
            )
        )
    return blocks


@op("textedit.code_blocks", CodeBlocksParams)
def code_blocks(params: CodeBlocksParams, progress: Progress) -> CodeBlocksResult:
    with open_document(params.path, params.password, mutable=False) as document:
        page = _page_at(document, params.page)
        size = page.rect if params.visible else page.mediabox
        return CodeBlocksResult(
            width=size.width,
            height=size.height,
            blocks=extract_code_blocks(page, params.rect, params.visible),
        )
