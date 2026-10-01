import functools
import io
import re
from pathlib import Path

import pymupdf

FONT_PATH = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "DejaVuSans.ttf"
FONT_RESOURCE = "VivUni"
FONT_TAG = "VIVUNI+DejaVuSans"
PADDING = 2.0
LINE_FACTOR = 1.16
MAX_AUTO_SIZE = 12.0
MIN_AUTO_SIZE = 4.0
SELECTION_COLOR = "0.6 0.75 0.85 rg"
TEXT_KINDS = (
    pymupdf.PDF_WIDGET_TYPE_TEXT,
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX,
    pymupdf.PDF_WIDGET_TYPE_LISTBOX,
)


class _FontMetrics:
    def __init__(self) -> None:
        from fontTools.ttLib import TTFont

        self.data = FONT_PATH.read_bytes()
        font = TTFont(io.BytesIO(self.data))
        self.units = font["head"].unitsPerEm
        self.cmap = font.getBestCmap()
        self.glyph_ids = {name: font.getGlyphID(name) for name in set(self.cmap.values())}
        self.advances = {name: advance for name, (advance, _) in font["hmtx"].metrics.items()}
        head = font["head"]
        self.bbox = [
            round(value * 1000 / self.units)
            for value in (head.xMin, head.yMin, head.xMax, head.yMax)
        ]
        self.ascent = round(font["hhea"].ascent * 1000 / self.units)
        self.descent = round(font["hhea"].descent * 1000 / self.units)
        os2 = font["OS/2"]
        self.cap_height = round(getattr(os2, "sCapHeight", 0) * 1000 / self.units) or self.ascent
        font.close()

    def glyph(self, character: str) -> tuple[int, int]:
        name = self.cmap.get(ord(character))
        if name is None:
            return 0, 0
        return self.glyph_ids[name], round(self.advances.get(name, 0) * 1000 / self.units)

    def width(self, text: str, size: float) -> float:
        return sum(self.glyph(character)[1] for character in text) * size / 1000


@functools.lru_cache(maxsize=1)
def _metrics() -> _FontMetrics:
    return _FontMetrics()


def needs_unicode_font(text: str) -> bool:
    return any(ord(character) > 255 for character in text)


def field_holder(document: pymupdf.Document, xref: int) -> int:
    if document.xref_get_key(xref, "T")[0] != "null":
        return xref
    kind, value = document.xref_get_key(xref, "Parent")
    return int(value.split()[0]) if kind == "xref" else xref


def is_signed_field(document: pymupdf.Document, widget: pymupdf.Widget) -> bool:
    return document.xref_get_key(field_holder(document, widget.xref), "V")[0] not in (
        "null",
        "",
    )


def choice_pairs(widget: pymupdf.Widget) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for choice in widget.choice_values or []:
        if isinstance(choice, list | tuple):
            export = str(choice[0]) if choice else ""
            label = str(choice[1]) if len(choice) > 1 else export
        else:
            export = label = str(choice)
        pairs.append((export, label))
    return pairs


def choice_label(widget: pymupdf.Widget, value: str) -> str:
    for export, label in choice_pairs(widget):
        if export == value:
            return label
    return value


def is_multi_select(widget: pymupdf.Widget) -> bool:
    return widget.field_type == pymupdf.PDF_WIDGET_TYPE_LISTBOX and bool(
        widget.field_flags & pymupdf.PDF_CH_FIELD_IS_MULTI_SELECT
    )


def selected_options(document: pymupdf.Document, widget: pymupdf.Widget) -> list[str]:
    from vivepdf.ops._pdf_syntax import parse_value

    kind, value = document.xref_get_key(field_holder(document, widget.xref), "V")
    if kind == "array":
        try:
            items = parse_value(value.encode("latin-1", errors="replace"))
        except (ValueError, IndexError):
            items = []
        return [str(item) for item in items if isinstance(item, str)]
    current = widget.field_value
    if isinstance(current, list | tuple):
        return [str(item) for item in current]
    return [str(current)] if current not in (None, "", False) else []


def _widget_texts(widget: pymupdf.Widget) -> list[str]:
    texts = [choice_label(widget, str(widget.field_value or ""))]
    if widget.field_type == pymupdf.PDF_WIDGET_TYPE_LISTBOX:
        texts.extend(label for _export, label in choice_pairs(widget))
    return texts


def _color_operator(color: list[float] | tuple[float, ...] | None) -> str:
    values = list(color or [0])
    if len(values) == 1:
        return f"{values[0]:g} g"
    if len(values) == 4:
        return " ".join(f"{value:g}" for value in values) + " k"
    return " ".join(f"{value:g}" for value in values[:3]) + " rg"


def _wrap(text: str, size: float, width: float) -> list[str]:
    metrics = _metrics()
    lines: list[str] = []
    for paragraph in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        current = ""
        for word in paragraph.split(" "):
            candidate = f"{current} {word}" if current else word
            if current and metrics.width(candidate, size) > width:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current)
    return lines


def _comb_cells(widget: pymupdf.Widget) -> int:
    if widget.field_type != pymupdf.PDF_WIDGET_TYPE_TEXT:
        return 0
    if not widget.field_flags & pymupdf.PDF_TX_FIELD_IS_COMB:
        return 0
    return max(0, int(widget.text_maxlen or 0))


class UnicodeAppearance:
    def __init__(self, document: pymupdf.Document) -> None:
        self.document = document
        self.font_xref = 0
        self.used: dict[int, tuple[int, str]] = {}
        self.missing: set[str] = set()

    def redraw(self, widget: pymupdf.Widget, force: bool = False) -> bool:
        if widget.field_type not in TEXT_KINDS:
            return False
        if not force and not any(needs_unicode_font(text) for text in _widget_texts(widget)):
            return False
        kind, value = self.document.xref_get_key(widget.xref, "AP/N")
        if kind != "xref":
            return False
        stream_xref = int(value.split()[0])
        bbox = self.document.xref_get_key(stream_xref, "BBox")
        numbers = [float(item) for item in re.findall(r"-?\d+(?:\.\d+)?", bbox[1])]
        if len(numbers) != 4:
            return False
        width, height = numbers[2] - numbers[0], numbers[3] - numbers[1]
        if width <= 0 or height <= 0:
            return False
        if not self.font_xref:
            self.font_xref = self.document.get_new_xref()
            self.document.update_object(self.font_xref, "<< >>")
        original = self.document.xref_stream(stream_xref) or b""
        marker = original.find(b"/Tx BMC")
        prefix = original[:marker] if marker > 0 else b""
        body = self._body(widget, width, height)
        self.document.update_stream(stream_xref, prefix + body.encode("latin-1"))
        if self.document.xref_get_key(stream_xref, "Resources/Font")[0] == "dict":
            self.document.xref_set_key(
                stream_xref, f"Resources/Font/{FONT_RESOURCE}", f"{self.font_xref} 0 R"
            )
        else:
            self.document.xref_set_key(
                stream_xref,
                "Resources",
                f"<< /Font << /{FONT_RESOURCE} {self.font_xref} 0 R >> >>",
            )
        return True

    def _encode(self, text: str) -> str:
        metrics = _metrics()
        codes = []
        for character in text:
            gid, advance = metrics.glyph(character)
            if gid:
                self.used.setdefault(gid, (advance, character))
            elif not character.isspace():
                self.missing.add(character)
            codes.append(f"{gid:04x}")
        return "<" + "".join(codes) + ">"

    def _quadding(self, widget: pymupdf.Widget) -> int:
        kind, value = self.document.xref_get_key(widget.xref, "Q")
        if kind == "int":
            return int(value)
        parent_kind, parent_value = self.document.xref_get_key(widget.xref, "Parent/Q")
        return int(parent_value) if parent_kind == "int" else 0

    def _line_x(self, text: str, size: float, width: float, quadding: int) -> float:
        free = width - 2 * PADDING - _metrics().width(text, size)
        if quadding == 1:
            return PADDING + max(0.0, free / 2)
        if quadding == 2:
            return PADDING + max(0.0, free)
        return PADDING

    def _body(self, widget: pymupdf.Widget, width: float, height: float) -> str:
        metrics = _metrics()
        size = float(widget.text_fontsize or 0)
        color = _color_operator(widget.text_color)
        quadding = self._quadding(widget)
        inner = width - 2 * PADDING
        commands = ["/Tx BMC", "q", f"1 1 {width - 2:g} {height - 2:g} re W n"]
        if widget.field_type == pymupdf.PDF_WIDGET_TYPE_LISTBOX:
            pairs = choice_pairs(widget)
            size = size or MAX_AUTO_SIZE
            line = size * LINE_FACTOR
            selected = set(selected_options(self.document, widget))
            top = height - PADDING
            for export, _label in pairs:
                if export in selected:
                    commands.append(
                        f"{SELECTION_COLOR} 1 {top - line:g} {width - 2:g} {line:g} re f"
                    )
                top -= line
            commands.append("BT")
            commands.append(f"/{FONT_RESOURCE} {size:g} Tf {color}")
            baseline = height - PADDING - size * metrics.ascent / 1000
            for _export, label in pairs:
                x = self._line_x(label, size, width, quadding)
                commands.append(f"1 0 0 1 {x:.2f} {baseline:.2f} Tm {self._encode(label)} Tj")
                baseline -= line
            commands.append("ET")
        else:
            text = choice_label(widget, str(widget.field_value or ""))
            if widget.field_flags & pymupdf.PDF_TX_FIELD_IS_PASSWORD:
                text = "•" * len(text)
            multiline = bool(widget.field_flags & pymupdf.PDF_TX_FIELD_IS_MULTILINE)
            if multiline:
                if not size:
                    size = MAX_AUTO_SIZE
                    while size > MIN_AUTO_SIZE and (
                        len(_wrap(text, size, inner)) * size * LINE_FACTOR > height - 2 * PADDING
                    ):
                        size -= 0.5
                lines = _wrap(text, size, inner)
                baseline = height - PADDING - size * metrics.ascent / 1000
            else:
                if not size:
                    size = max(MIN_AUTO_SIZE, (height - 2 * PADDING) / LINE_FACTOR)
                    natural = metrics.width(text, 1)
                    if natural > 0:
                        size = max(MIN_AUTO_SIZE, min(size, inner / natural))
                lines = [text.replace("\n", " ")]
                ascent = size * metrics.ascent / 1000
                descent = size * metrics.descent / 1000
                baseline = (height - (ascent - descent)) / 2 - descent
            commands.append("BT")
            commands.append(f"/{FONT_RESOURCE} {size:g} Tf {color}")
            cells = _comb_cells(widget)
            if cells and not multiline:
                cell = width / cells
                for position, character in enumerate(lines[0][:cells]):
                    x = position * cell + (cell - metrics.width(character, size)) / 2
                    commands.append(
                        f"1 0 0 1 {x:.2f} {baseline:.2f} Tm {self._encode(character)} Tj"
                    )
                lines = []
            for line in lines:
                x = self._line_x(line, size, width, quadding)
                commands.append(f"1 0 0 1 {x:.2f} {baseline:.2f} Tm {self._encode(line)} Tj")
                baseline -= size * LINE_FACTOR
            commands.append("ET")
        commands.extend(["Q", "EMC"])
        return "\n".join(commands) + "\n"

    def finish(self) -> None:
        if not self.font_xref:
            return
        from fontTools import subset

        metrics = _metrics()
        glyph_ids = sorted(self.used) or [0]
        options = subset.Options()
        options.retain_gids = True
        options.notdef_outline = True
        options.name_IDs = ["*"]
        options.layout_features = []
        options.drop_tables = [*options.drop_tables, "FFTM"]
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(gids=[0, *glyph_ids])
        from fontTools.ttLib import TTFont

        font = TTFont(io.BytesIO(metrics.data))
        subsetter.subset(font)
        buffer = io.BytesIO()
        font.save(buffer)
        font.close()
        font_bytes = buffer.getvalue()
        document = self.document
        file_xref = document.get_new_xref()
        document.update_object(file_xref, f"<< /Length1 {len(font_bytes)} >>")
        document.update_stream(file_xref, font_bytes)
        descriptor_xref = document.get_new_xref()
        document.update_object(
            descriptor_xref,
            f"<< /Type /FontDescriptor /FontName /{FONT_TAG} /Flags 32 "
            f"/FontBBox [{' '.join(str(value) for value in metrics.bbox)}] /ItalicAngle 0 "
            f"/Ascent {metrics.ascent} /Descent {metrics.descent} "
            f"/CapHeight {metrics.cap_height} /StemV 80 /FontFile2 {file_xref} 0 R >>",
        )
        widths = " ".join(f"{gid} [{self.used[gid][0]}]" for gid in sorted(self.used))
        cid_xref = document.get_new_xref()
        document.update_object(
            cid_xref,
            f"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{FONT_TAG} "
            "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
            f"/FontDescriptor {descriptor_xref} 0 R /CIDToGIDMap /Identity /DW 1000 "
            f"/W [{widths}] >>",
        )
        unicode_xref = document.get_new_xref()
        document.update_object(unicode_xref, "<< >>")
        document.update_stream(unicode_xref, self._to_unicode().encode("ascii"))
        document.update_object(
            self.font_xref,
            f"<< /Type /Font /Subtype /Type0 /BaseFont /{FONT_TAG} /Encoding /Identity-H "
            f"/DescendantFonts [{cid_xref} 0 R] /ToUnicode {unicode_xref} 0 R >>",
        )

    def _to_unicode(self) -> str:
        entries = sorted(self.used.items())
        blocks = []
        for start in range(0, len(entries), 100):
            chunk = entries[start : start + 100]
            lines = []
            for gid, (_advance, character) in chunk:
                encoded = character.encode("utf-16-be").hex().upper()
                lines.append(f"<{gid:04X}> <{encoded}>")
            blocks.append(f"{len(chunk)} beginbfchar\n" + "\n".join(lines) + "\nendbfchar")
        return (
            "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
            "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
            "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n"
            "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
            + "\n".join(blocks)
            + "\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n"
        )
