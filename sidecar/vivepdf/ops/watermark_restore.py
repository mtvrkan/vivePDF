import math
from collections import defaultdict

import pymupdf

from vivepdf.ops._content import (
    join_streams,
)
from vivepdf.ops._original_fonts import FontCodes, PageFonts, pen_offsets
from vivepdf.ops._text_order import place_in_order
from vivepdf.ops._to_unicode import cmap_entries, cmap_stream
from vivepdf.ops.fonts import (
    ensure_font,
    load_font,
    resolve_font,
)

ORIGIN_TOLERANCE = 0.1
VERTICAL_TURN = 90
TEXT_FLAGS = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_MEDIABOX_CLIP


def _char_key(char: dict) -> tuple[str, float, float]:
    origin = char["origin"]
    return char["c"], round(float(origin[0]), 1), round(float(origin[1]), 1)


def _lost_bystanders(before: list[dict], marked: list[dict], after: list[dict]) -> list[dict]:
    taken = {id(char) for char in marked}
    survivors: dict[tuple[str, float, float], int] = defaultdict(int)
    for span in after:
        for char in span["chars"]:
            survivors[_char_key(char)] += 1
    lost: list[dict] = []
    for span in before:
        missing = []
        for char in span["chars"]:
            if id(char) in taken:
                continue
            key = _char_key(char)
            if survivors[key] > 0:
                survivors[key] -= 1
            else:
                missing.append(char)
        if missing:
            lost.append({"span": span, "chars": missing})
    return lost


def _restore_plan(page: pymupdf.Page, lost: list[dict]) -> list[dict]:
    plan: list[dict] = []
    for entry in lost:
        span = entry["span"]
        font = resolve_font(
            page.parent,
            span["text"] or " ",
            font_name=span["font"],
            font_xref=span["xref"],
            bold=span["bold"],
            italic=span["italic"],
            page=page,
        )
        plan.append({"font": font, "span": span, "chars": entry["chars"]})
    return plan


def _font_xrefs(page: pymupdf.Page) -> set[int]:
    return {entry[0] for entry in page.get_fonts(full=True)}


def _keep_code_points(page: pymupdf.Page, font_xrefs: list[int], glyphs: dict[int, str]) -> None:
    document = page.parent
    for font_xref in font_xrefs:
        kind, value = document.xref_get_key(font_xref, "ToUnicode")
        if kind != "xref" or not glyphs:
            continue
        cmap_xref = int(value.split()[0])
        entries = cmap_entries(document.xref_stream(cmap_xref) or b"")
        if all(entries.get(code) == text for code, text in glyphs.items()):
            continue
        entries.update(glyphs)
        document.update_stream(cmap_xref, cmap_stream(entries))


def _write_span(page: pymupdf.Page, entry: dict) -> bool:
    span = entry["span"]
    loaded = load_font(entry["font"])
    if loaded is None:
        return False
    if any(not loaded.has_glyph(ord(char["c"])) for char in entry["chars"] if char["c"].strip()):
        return False
    writer = pymupdf.TextWriter(page.rect)
    for char in entry["chars"]:
        writer.append(pymupdf.Point(char["origin"]), char["c"], font=loaded, fontsize=span["size"])
    morph = (
        (pymupdf.Point(entry["chars"][0]["origin"]), pymupdf.Matrix(span["angle"]))
        if span["angle"]
        else None
    )
    writer.write_text(page, color=span["color"], morph=morph)
    return True


def _pdf_number(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def _original_chunk(
    page: pymupdf.Page, entry: dict, shown: list[tuple[str, bytes]]
) -> bytes | None:
    span = entry["span"]
    vertical = bool(span.get("vertical"))
    offsets = (
        pen_offsets(page.parent, span["xref"], [code for _resource, code in shown], span["size"])
        if vertical
        else None
    )
    if vertical and offsets is None:
        return None
    to_pdf = ~page.transformation_matrix
    radians = math.radians(span["angle"] + (VERTICAL_TURN if vertical else 0))
    direction = pymupdf.Point(math.cos(radians), -math.sin(radians))
    colour = " ".join(_pdf_number(value) for value in span["color"])
    lines = [
        "q",
        "BT",
        f"{colour} rg",
        "0 Tr 0 Tc 0 Tw 100 Tz 0 Ts",
    ]
    current = None
    for index, (char, (resource, code)) in enumerate(zip(entry["chars"], shown, strict=True)):
        if resource != current:
            lines.append(f"/{resource} {_pdf_number(span['size'])} Tf")
            current = resource
        origin = pymupdf.Point(char["origin"])
        start = origin * to_pdf
        ahead = (origin + direction) * to_pdf - start
        length = abs(ahead)
        if length < 1e-9:
            return None
        cos, sin = ahead.x / length, ahead.y / length
        if offsets is not None:
            shift = offsets[index]
            start -= pymupdf.Point(shift.x * cos + shift.y * sin, shift.x * sin - shift.y * cos)
        matrix = " ".join(_pdf_number(value) for value in (cos, sin, -sin, cos, start.x, start.y))
        lines.append(f"{matrix} Tm <{code.hex()}> Tj")
    lines.extend(["ET", "Q"])
    return ("\n".join(lines) + "\n").encode("ascii")


def _shows_chars(page: pymupdf.Page, chars: list[dict]) -> bool:
    area = pymupdf.Rect(chars[0]["bbox"])
    for char in chars[1:]:
        area |= pymupdf.Rect(char["bbox"])
    found = [
        (glyph["c"], glyph["origin"])
        for block in page.get_text("rawdict", clip=area + (-2, -2, 2, 2), flags=TEXT_FLAGS)[
            "blocks"
        ]
        for line in block.get("lines", [])
        for span in line.get("spans", [])
        for glyph in span.get("chars", [])
    ]
    return all(
        any(
            glyph == char["c"]
            and abs(origin[0] - char["origin"][0]) <= ORIGIN_TOLERANCE
            and abs(origin[1] - char["origin"][1]) <= ORIGIN_TOLERANCE
            for glyph, origin in found
        )
        for char in chars
        if char["c"].strip()
    )


def _write_original(page: pymupdf.Page, entry: dict, fonts: PageFonts) -> bool:
    shown = fonts.show(entry["span"], [char["c"] for char in entry["chars"]])
    chunk = None if shown is None else _original_chunk(page, entry, shown)
    if chunk is None:
        fonts.rollback()
        return False
    document = page.parent
    before = list(page.get_contents())
    if not page.is_wrapped:
        page.wrap_contents()
    xref = document.get_new_xref()
    document.update_object(xref, "<<>>")
    document.update_stream(xref, chunk)
    listing = " ".join(f"{number} 0 R" for number in [*page.get_contents(), xref])
    document.xref_set_key(page.xref, "Contents", f"[{listing}]")
    if _shows_chars(page, entry["chars"]):
        fonts.commit()
        return True
    listing = " ".join(f"{number} 0 R" for number in before)
    document.xref_set_key(page.xref, "Contents", f"[{listing}]")
    fonts.rollback()
    return False


def _runs(entry: dict) -> list[dict]:
    order = {id(char): position for position, char in enumerate(entry["span"]["chars"])}
    runs: list[dict] = []
    previous = -2
    for char in sorted(entry["chars"], key=lambda item: order.get(id(item), 0)):
        position = order.get(id(char), previous + 1)
        if not runs or position != previous + 1:
            runs.append({**entry, "chars": []})
        runs[-1]["chars"].append(char)
        previous = position
    return runs


def _anchor(run: dict, spans: list[dict], gone: set[int]) -> tuple[str, float, float] | None:
    span = run["span"]
    first = run["chars"][0]
    chars = span["chars"]
    position = next((index for index, char in enumerate(chars) if char is first), 0)
    candidates = list(reversed(chars[:position]))
    index = next((index for index, item in enumerate(spans) if item is span), len(spans))
    for earlier in reversed(spans[:index]):
        candidates.extend(reversed(earlier["chars"]))
    for char in candidates:
        if id(char) not in gone and char["c"].strip():
            origin = char["origin"]
            return char["c"], float(origin[0]), float(origin[1])
    return None


def _first_glyph(entry: dict) -> tuple[str, float, float] | None:
    for char in entry["chars"]:
        if char["c"].strip():
            origin = char["origin"]
            return char["c"], float(origin[0]), float(origin[1])
    return None


def _move_into_order(
    page: pymupdf.Page,
    earlier: list[int],
    anchor: tuple[str, float, float] | None,
    own: tuple[str, float, float] | None = None,
) -> None:
    document = page.parent
    now = list(page.get_contents())
    added = [xref for xref in now if xref not in earlier]
    chunk_xrefs = [
        xref
        for xref in added
        if (document.xref_stream(xref) or b"").strip() not in (b"", b"q", b"Q")
    ]
    if (anchor is None and own is None) or not chunk_xrefs:
        return
    kept = [xref for xref in now if xref not in chunk_xrefs]
    data = join_streams([document.xref_stream(xref) or b"" for xref in kept])
    chunk = b"\n".join(document.xref_stream(xref) or b"" for xref in chunk_xrefs)
    placed = place_in_order(page, data, chunk, anchor, own)
    if placed is None:
        listing = " ".join(f"{xref} 0 R" for xref in now)
        document.xref_set_key(page.xref, "Contents", f"[{listing}]")
        return
    target = kept[0] if len(kept) == 1 else document.get_new_xref()
    if len(kept) != 1:
        document.update_object(target, "<<>>")
    document.update_stream(target, placed)
    document.xref_set_key(page.xref, "Contents", f"{target} 0 R")


def _put_back(
    page: pymupdf.Page,
    plan: list[dict],
    spans: list[dict],
    marked: list[dict],
    codes: FontCodes | None = None,
) -> None:
    fonts = PageFonts(page, codes or FontCodes(page.parent))
    written: dict[str, set[int]] = defaultdict(set)
    glyphs: dict[str, dict[int, str]] = defaultdict(dict)
    gone = {id(char) for char in marked} | {id(char) for entry in plan for char in entry["chars"]}
    for run in reversed([run for item in plan for run in _runs(item)]):
        anchor = _anchor(run, spans, gone)
        earlier = list(page.get_contents())
        if _write_original(page, run, fonts):
            _move_into_order(page, earlier, anchor, _first_glyph(run))
            continue
        for piece, original in reversed(_font_pieces(run, fonts)):
            before = _font_xrefs(page)
            earlier = list(page.get_contents())
            if original and _write_original(page, piece, fonts):
                _move_into_order(page, earlier, anchor, _first_glyph(piece))
                continue
            if not _write_span(page, piece):
                _insert_chars(page, piece)
            loaded = load_font(piece["font"])
            if loaded is not None:
                written[loaded.name] |= _font_xrefs(page) - before
                glyphs[loaded.name].update(
                    {
                        loaded.has_glyph(ord(char["c"])): char["c"]
                        for char in piece["chars"]
                        if char["c"].strip()
                    }
                )
                _keep_code_points(page, sorted(written[loaded.name]), glyphs[loaded.name])
            _move_into_order(page, earlier, anchor, _first_glyph(piece))


def _font_pieces(run: dict, fonts: PageFonts) -> list[tuple[dict, bool]]:
    showable = [fonts.show(run["span"], [char["c"]]) is not None for char in run["chars"]]
    fonts.rollback()
    if all(showable) or not any(showable):
        return [(run, False)]
    pieces: list[tuple[dict, bool]] = []
    for char, original in zip(run["chars"], showable, strict=True):
        if not pieces or pieces[-1][1] != original:
            pieces.append(({**run, "chars": []}, original))
        pieces[-1][0]["chars"].append(char)
    return pieces


def _insert_chars(page: pymupdf.Page, entry: dict) -> None:
    span = entry["span"]
    font = entry["font"]
    ensure_font(page, font)
    for char in entry["chars"]:
        origin = pymupdf.Point(char["origin"])
        morph = (origin, pymupdf.Matrix(span["angle"])) if span["angle"] else None
        page.insert_text(
            origin,
            char["c"],
            fontsize=span["size"],
            fontname=font.fontname,
            fontfile=font.fontfile,
            color=span["color"],
            morph=morph,
        )


def _rest_of_words(lost: list[dict], marked: list[dict]) -> list[dict]:
    taken = {id(char) for char in marked}
    rest: list[dict] = []
    for entry in lost:
        gone = {id(char) for char in entry["chars"]}
        word: list[dict] = []
        for char in [*entry["span"]["all"], {"c": " "}]:
            if char.get("c", "").strip():
                word.append(char)
                continue
            if any(id(item) in gone for item in word):
                rest.extend(item for item in word if id(item) not in gone and id(item) not in taken)
            word = []
    return rest
