import re

import pymupdf
from pdf2docx.page.RawPageFitz import RawPageFitz

from vivepdf.ops._docx_graphics import TILT_TOLERANCE
from vivepdf.ops._docx_images import CLIPPED_MARK, _widened
from vivepdf.ops._hidden_text import text_is_only_hidden

WORD_GAP_EM = 0.2
STYLE_SUFFIX = re.compile(r"^(.+),\s*(Bold|Italic|BoldItalic|Oblique|BoldOblique)$", re.IGNORECASE)
BOLD_FLAG = 16
ITALIC_FLAG = 2


_plain_extract_raw_dict = RawPageFitz.extract_raw_dict


def _is_fill(shape: dict) -> bool:
    return set(shape) == {"bbox", "color"}


def drop_fills_drawn_in_pictures(raw: dict) -> dict:
    clipped = [
        _widened(pymupdf.Rect(block["bbox"]))
        for block in raw.get("blocks", [])
        if block.pop(CLIPPED_MARK, False)
    ]
    if clipped and "shapes" in raw:
        raw["shapes"] = [
            shape
            for shape in raw["shapes"]
            if not (
                _is_fill(shape)
                and any(area.contains(pymupdf.Rect(shape["bbox"])) for area in clipped)
            )
        ]
    return raw


def _is_blank(span: dict) -> bool:
    chars = span.get("chars")
    return bool(chars) and all(not char["c"].strip() for char in chars)


def level_slight_tilts(raw: dict) -> dict:
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            x, y = line.get("dir", (1.0, 0.0))
            if x > 0 and abs(y) <= TILT_TOLERANCE:
                line["dir"] = (1.0, 0.0)
            elif y < 0 and abs(x) <= TILT_TOLERANCE:
                line["dir"] = (0.0, -1.0)
    return raw


def split_style_suffixes(raw: dict) -> dict:
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                match = STYLE_SUFFIX.match(span.get("font") or "")
                if match is None:
                    continue
                style = match.group(2).lower()
                span["font"] = match.group(1).strip()
                if "bold" in style:
                    span["flags"] = span.get("flags", 0) | BOLD_FLAG
                if "italic" in style or "oblique" in style:
                    span["flags"] = span.get("flags", 0) | ITALIC_FLAG
    return raw


def keep_word_spaces(raw: dict) -> dict:
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            kept: list[dict] = []
            for index, span in enumerate(spans):
                words_follow = any(not _is_blank(later) for later in spans[index + 1 :])
                if _is_blank(span) and kept and "chars" in kept[-1] and words_follow:
                    kept[-1]["chars"].extend(span["chars"])
                    kept[-1]["bbox"] = tuple(pymupdf.Rect(kept[-1]["bbox"]) | span["bbox"])
                else:
                    kept.append(span)
            if tuple(line.get("dir", (1, 0))) == (1, 0):
                _space_apart(kept)
            line["spans"] = kept
    return raw


def _space_apart(spans: list[dict]) -> None:
    for before, after in zip(spans, spans[1:], strict=False):
        left, right = before.get("chars"), after.get("chars")
        if not left or not right or left[-1]["c"].isspace() or right[0]["c"].isspace():
            continue
        x0, y0, x1, y1 = before["bbox"]
        if after["bbox"][0] - x1 < WORD_GAP_EM * before.get("size", 0):
            continue
        left.append(
            {
                "c": " ",
                "origin": (x1, left[-1]["origin"][1]),
                "bbox": (x1, y0, after["bbox"][0], y1),
            }
        )
        before["bbox"] = (x0, y0, after["bbox"][0], y1)


def extract_with_recognised_text(raw_page: RawPageFitz, **settings):
    engine = raw_page.page_engine
    if engine is not None and settings.get("ocr") == 0 and text_is_only_hidden(engine):
        settings = {**settings, "ocr": 2}
    raw = _plain_extract_raw_dict(raw_page, **settings)
    return drop_fills_drawn_in_pictures(
        keep_word_spaces(level_slight_tilts(split_style_suffixes(raw)))
    )
