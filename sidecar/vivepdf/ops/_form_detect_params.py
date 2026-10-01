import re
from typing import Literal

from pydantic import Field

from vivepdf.rpc.protocol import RpcModel


class DetectParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    min_line_width: float = Field(default=50, ge=10, le=600)
    field_height: float = Field(default=16, ge=8, le=60)
    box_min: float = Field(default=7, ge=3, le=30)
    box_max: float = Field(default=18, ge=5, le=60)


class DetectedField(RpcModel):
    name: str
    kind: Literal["text", "checkbox"]
    page: int
    rect: list[float]
    label: str


class DetectResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    fields: list[DetectedField]
    scanned_pages: list[int] = Field(default_factory=list)


RASTER_DPI = 100
INK_LEVEL = 128
MAX_LINE_THICKNESS = 4
PAPER_WHITE = 0.6
PAPER_COLOUR = 0.15
WHITE_INK = 200
COLOUR_SPREAD = 40
ABOVE_INK_SHARE = 0.15
TOUCH_DEPTH = 3
CORNER_REACH = 8
ENCLOSED_DEPTH = 3
RING = 4
FAINT_LEVEL = 200
WHITE_LEVEL = 0.95
CAPTION_SHARE = 0.35
WRITING_DEPTH = 2
CELL_DEPTH = 200
RULE_RUN = 6
RULE_SPACING_TOLERANCE = 0.15
LABEL_REACH = 220
SCAN_COVERAGE = 0.5
LEADER_WEIGHTS = {"_": 1, ".": 1, "\u2026": 3, "\u2025": 2}
LEADER_MIN = 3
LEADER_UNDERLINE = 0.2
PAGE_REFERENCE_GAP = 12
PAGE_REFERENCE = re.compile(r"[0-9ivxlcdm]+", re.IGNORECASE)
BOX_GLYPHS = set("\u2610\u25a1\u25a2\u274f\u2750\u2751\u2752\u2b1c\u25fb\u25fd")
SYMBOL_FONT_BOXES = set("oq\u00a8")
SYMBOL_FONTS = ("wingding",)
BOX_SHARE = 0.9
HELVETICA = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>"
