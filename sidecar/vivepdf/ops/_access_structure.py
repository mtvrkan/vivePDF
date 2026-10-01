import io
import re
from dataclasses import dataclass, field

import numpy as np
import pymupdf
from PIL import Image

from vivepdf.ops._content import content_tokens

MAX_NODES = 250_000
MCID_PATTERN = re.compile(rb"/MCID\s+(\d+)")
MCR_MCID_PATTERN = re.compile(r"/MCID\s+(\d+)")
MCR_PAGE_PATTERN = re.compile(r"/Pg\s+(\d+)\s+\d+\s+R")
ROLE_PATTERN = re.compile(r"/([^\s/<>\[\]()]+)\s*/([^\s/<>\[\]()]+)")
MAX_ROLE_STEPS = 5
LIST_CHILDREN = {"/LI", "/Caption", "/L", "/NonStruct", "/Artifact"}
ITEM_CHILDREN = {"/Lbl", "/LBody", "/NonStruct", "/Artifact"}
MIN_MOVED = 2
MOVED_SHARE = 0.25
NORMAL_CONTRAST = 4.5
LARGE_CONTRAST = 3.0
LARGE_TEXT_PT = 18.0
LARGE_BOLD_TEXT_PT = 14.0
BOLD_FLAG = 16
WHITE = (1.0, 1.0, 1.0)
SAMPLE_DPI = 36
RING_PT = 2.5
IMAGE_SAMPLE_SIDE = 160


@dataclass
class StructureFacts:
    order: dict[int, list[int]] = field(default_factory=dict)
    lists: int = 0
    list_errors: int = 0


def _key(document: pymupdf.Document, xref: int, key: str) -> tuple[str, str]:
    try:
        return document.xref_get_key(xref, key)
    except Exception:
        return ("null", "null")


def _page_ref(document: pymupdf.Document, xref: int, inherited: int | None) -> int | None:
    kind, value = _key(document, xref, "Pg")
    if kind == "xref":
        return int(value.split()[0])
    return inherited


def _kids(value: str, page: int | None) -> list[tuple[str, int, int | None]]:
    tokens = [token[2] for token in content_tokens(value.encode("latin-1", "replace"))]
    kids: list[tuple[str, int, int | None]] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.isdigit():
            if index + 2 < len(tokens) and tokens[index + 2] == b"R":
                kids.append(("node", int(token), page))
                index += 3
                continue
            kids.append(("mcid", int(token), page))
        elif token.startswith(b"<<"):
            text = token.decode("latin-1")
            mcid = MCR_MCID_PATTERN.search(text)
            if mcid and "/OBJR" not in text:
                owner = MCR_PAGE_PATTERN.search(text)
                kids.append(("mcid", int(mcid.group(1)), int(owner.group(1)) if owner else page))
        index += 1
    return kids


def _children(
    document: pymupdf.Document, xref: int, page: int | None
) -> list[tuple[str, int, int | None]]:
    kind, value = _key(document, xref, "K")
    if kind == "int":
        return [("mcid", int(value), page)]
    if kind == "xref":
        return [("node", int(value.split()[0]), page)]
    if kind in ("array", "dict"):
        return _kids(value if kind == "array" else f"[{value}]", page)
    return []


def role_map(document: pymupdf.Document, root: int) -> dict[str, str]:
    kind, value = _key(document, root, "RoleMap")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]), compressed=True)
    elif kind != "dict":
        return {}
    return {f"/{source}": f"/{target}" for source, target in ROLE_PATTERN.findall(value)}


def _opaque(drawing: dict) -> bool:
    opacity = drawing.get("fill_opacity")
    return opacity is None or opacity >= 1


def standard_role(name: str, roles: dict[str, str]) -> str:
    seen: set[str] = set()
    while name in roles and name not in seen and len(seen) < MAX_ROLE_STEPS:
        seen.add(name)
        name = roles[name]
    return name


def _check_list_parent(parent: str | None, kind: str) -> bool:
    if kind == "/LI":
        return parent == "/L"
    if kind in ("/Lbl", "/LBody"):
        return parent == "/LI"
    return True


def _check_list_children(
    document: pymupdf.Document, xref: int, kind: str, roles: dict[str, str]
) -> bool:
    allowed = LIST_CHILDREN if kind == "/L" else ITEM_CHILDREN if kind == "/LI" else None
    if allowed is None:
        return True
    for child_kind, child, _page in _children(document, xref, None):
        if child_kind != "node":
            continue
        child_type, child_name = _key(document, child, "S")
        if child_type == "name" and standard_role(child_name, roles) not in allowed:
            return False
    return True


def structure_facts(document: pymupdf.Document, root: int) -> StructureFacts:
    facts = StructureFacts()
    stack: list[tuple[str, int, int | None, str | None]] = [
        (kind, value, page, None) for kind, value, page in reversed(_children(document, root, None))
    ]
    seen: set[int] = set()
    length = document.xref_length()
    roles = role_map(document, root)
    while stack and len(seen) < MAX_NODES:
        kind, value, page, parent = stack.pop()
        if kind == "mcid":
            if page is not None:
                facts.order.setdefault(page, []).append(value)
            continue
        if value in seen or value <= 0 or value >= length:
            continue
        seen.add(value)
        name_type, raw_name = _key(document, value, "S")
        name = standard_role(raw_name, roles)
        own_page = _page_ref(document, value, page)
        if name_type != "name":
            mcid_type, mcid = _key(document, value, "MCID")
            if mcid_type == "int" and own_page is not None:
                facts.order.setdefault(own_page, []).append(int(mcid))
            continue
        if name == "/L":
            facts.lists += 1
        if not _check_list_parent(parent, name) or not _check_list_children(
            document, value, name, roles
        ):
            facts.list_errors += 1
        stack.extend(
            (child_kind, child, child_page, name)
            for child_kind, child, child_page in reversed(_children(document, value, own_page))
        )
    return facts


def content_mcids(document: pymupdf.Document, page: pymupdf.Page) -> list[int]:
    try:
        data = page.read_contents()
    except Exception:
        return []
    if b"BDC" not in data:
        return []
    tokens = content_tokens(data)
    found: list[int] = []
    for index, (_start, _end, text) in enumerate(tokens):
        if text != b"BDC" or index < 1:
            continue
        operand = tokens[index - 1][2]
        if operand.startswith(b"<<"):
            match = MCID_PATTERN.search(operand)
            if match:
                found.append(int(match.group(1)))
        elif operand.startswith(b"/"):
            name = operand.decode("latin-1").lstrip("/")
            kind, value = _key(document, page.xref, f"Resources/Properties/{name}/MCID")
            if kind == "int":
                found.append(int(value))
    return found


def _longest_rising(values: list[int]) -> int:
    tails: list[int] = []
    for value in values:
        low, high = 0, len(tails)
        while low < high:
            middle = (low + high) // 2
            if tails[middle] < value:
                low = middle + 1
            else:
                high = middle
        if low == len(tails):
            tails.append(value)
        else:
            tails[low] = value
    return len(tails)


def order_differs(structure: list[int], content: list[int]) -> bool:
    position = {mcid: index for index, mcid in enumerate(content)}
    placed = [position[mcid] for mcid in structure if mcid in position]
    moved = len(placed) - _longest_rising(placed)
    return moved > max(MIN_MOVED, len(placed) * MOVED_SHARE)


def _linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4


def luminance(colour: tuple[float, float, float]) -> float:
    red, green, blue = (_linear(value) for value in colour)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_ratio(first: tuple[float, float, float], second: tuple[float, float, float]) -> float:
    light, dark = sorted((luminance(first), luminance(second)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def _srgb(value: int) -> tuple[float, float, float]:
    return ((value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255)


def _required(span: dict) -> float:
    size = float(span.get("size") or 0)
    bold = bool(int(span.get("flags") or 0) & BOLD_FLAG)
    large = size >= LARGE_TEXT_PT or (bold and size >= LARGE_BOLD_TEXT_PT)
    return LARGE_CONTRAST if large else NORMAL_CONTRAST


def _fill_colour(fill) -> tuple[float, float, float] | None:
    if not fill:
        return None
    values = [float(value) for value in fill]
    if len(values) == 1:
        return (values[0], values[0], values[0])
    if len(values) == 3:
        return (values[0], values[1], values[2])
    if len(values) == 4:
        cyan, magenta, yellow, black = values
        return ((1 - cyan) * (1 - black), (1 - magenta) * (1 - black), (1 - yellow) * (1 - black))
    return None


def _covering_fill(
    box: pymupdf.Rect, fills: list[tuple[pymupdf.Rect, tuple[float, float, float]]]
) -> tuple[pymupdf.Rect, tuple[float, float, float]] | None:
    covering = [(rect, colour) for rect, colour in fills if rect.contains(box)]
    if not covering:
        return None
    return min(covering, key=lambda item: item[0].get_area())


class ImageSamples:
    def __init__(self, document: pymupdf.Document) -> None:
        self.document = document
        self.arrays: dict[int, np.ndarray | None] = {}

    def array(self, xref: int) -> np.ndarray | None:
        if xref not in self.arrays:
            self.arrays[xref] = self._decode(xref)
        return self.arrays[xref]

    def _decode(self, xref: int) -> np.ndarray | None:
        return self._decode_jpeg(xref) if self._is_jpeg(xref) else self._decode_pixmap(xref)

    def _is_jpeg(self, xref: int) -> bool:
        try:
            kind, value = self.document.xref_get_key(xref, "Filter")
        except Exception:
            return False
        return kind == "name" and value == "/DCTDecode"

    def _decode_jpeg(self, xref: int) -> np.ndarray | None:
        try:
            with Image.open(io.BytesIO(self.document.xref_stream_raw(xref))) as picture:
                picture.draft("RGB", (IMAGE_SAMPLE_SIDE, IMAGE_SAMPLE_SIDE))
                rgb = picture.convert("RGB")
                rgb.thumbnail((IMAGE_SAMPLE_SIDE, IMAGE_SAMPLE_SIDE))
                return np.asarray(rgb, dtype=np.uint8)
        except Exception:
            return self._decode_pixmap(xref)

    def _decode_pixmap(self, xref: int) -> np.ndarray | None:
        try:
            pixmap = pymupdf.Pixmap(self.document, xref)
            if pixmap.alpha:
                pixmap = pymupdf.Pixmap(pixmap, 0)
            if pixmap.n != 3:
                pixmap = pymupdf.Pixmap(pymupdf.csRGB, pixmap)
            steps = 0
            while max(pixmap.width, pixmap.height) >> steps > IMAGE_SAMPLE_SIDE:
                steps += 1
            if steps:
                pixmap.shrink(steps)
            return (
                np.frombuffer(pixmap.samples, dtype=np.uint8)
                .reshape(pixmap.height, pixmap.stride)[:, : pixmap.width * 3]
                .reshape(pixmap.height, pixmap.width, 3)
            )
        except Exception:
            return None

    def colour_under(self, info: dict, box: pymupdf.Rect) -> tuple[float, float, float] | None:
        xref = int(info.get("xref") or 0)
        if xref <= 0:
            return None
        pixels = self.array(xref)
        if pixels is None:
            return None
        try:
            a, b, c, d, e, f = (float(value) for value in info["transform"])
        except Exception:
            return None
        determinant = a * d - b * c
        if not determinant:
            return None
        height, width = pixels.shape[:2]
        us: list[float] = []
        vs: list[float] = []
        for x, y in ((box.x0, box.y0), (box.x1, box.y0), (box.x0, box.y1), (box.x1, box.y1)):
            shifted_x, shifted_y = x - e, y - f
            u = (d * shifted_x - c * shifted_y) / determinant
            v = (a * shifted_y - b * shifted_x) / determinant
            us.append(min(max(u, 0.0), 1.0) * width)
            vs.append(min(max(v, 0.0), 1.0) * height)
        x0 = min(int(min(us)), width - 1)
        y0 = min(int(min(vs)), height - 1)
        x1 = max(x0 + 1, min(width, int(np.ceil(max(us)))))
        y1 = max(y0 + 1, min(height, int(np.ceil(max(vs)))))
        red, green, blue = (
            float(value) / 255 for value in pixels[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
        )
        return (red, green, blue)


class _BackdropSampler:
    def __init__(self, page: pymupdf.Page) -> None:
        self.page = page
        self.pixels: np.ndarray | None = None

    def _render(self) -> np.ndarray:
        if self.pixels is None:
            pixmap = self.page.get_pixmap(dpi=SAMPLE_DPI, colorspace=pymupdf.csRGB, alpha=False)
            self.pixels = (
                np.frombuffer(pixmap.samples, dtype=np.uint8)
                .reshape(pixmap.height, pixmap.stride)[:, : pixmap.width * 3]
                .reshape(pixmap.height, pixmap.width, 3)
            )
        return self.pixels

    def colour_around(self, box: pymupdf.Rect) -> tuple[float, float, float]:
        pixels = self._render()
        height, width = pixels.shape[:2]
        scale = SAMPLE_DPI / 72.0
        seen = box * self.page.rotation_matrix
        outer = seen + (-RING_PT, -RING_PT, RING_PT, RING_PT)
        x0 = max(0, int(outer.x0 * scale))
        y0 = max(0, int(outer.y0 * scale))
        x1 = min(width, int(np.ceil(outer.x1 * scale)))
        y1 = min(height, int(np.ceil(outer.y1 * scale)))
        if x1 <= x0 or y1 <= y0:
            return WHITE
        region = pixels[y0:y1, x0:x1].reshape(-1, 3)
        rows, columns = np.mgrid[y0:y1, x0:x1]
        inside = (
            (columns >= int(seen.x0 * scale))
            & (columns < int(np.ceil(seen.x1 * scale)))
            & (rows >= int(seen.y0 * scale))
            & (rows < int(np.ceil(seen.y1 * scale)))
        ).reshape(-1)
        ring = region[~inside] if (~inside).any() else region
        red, green, blue = (float(value) / 255 for value in np.median(ring, axis=0))
        return (red, green, blue)


def _image_entries(page: pymupdf.Page) -> list[dict]:
    entries = page.get_image_info()
    if not entries:
        return entries
    by_size: dict[tuple[int, int], set[int]] = {}
    for item in page.get_images(full=True):
        by_size.setdefault((int(item[2]), int(item[3])), set()).add(int(item[0]))
    for entry in entries:
        matches = by_size.get((int(entry.get("width") or 0), int(entry.get("height") or 0)), set())
        entry["xref"] = next(iter(matches)) if len(matches) == 1 else 0
    return entries


def low_contrast_runs(page: pymupdf.Page, samples: ImageSamples | None = None) -> int:
    try:
        blocks = page.get_text("dict", flags=0)["blocks"]
    except Exception:
        return 0
    spans: list[tuple[pymupdf.Rect, tuple[float, float, float], float]] = []
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if not str(span.get("text") or "").strip() or span.get("alpha", 255) == 0:
                    continue
                box = pymupdf.Rect(span["bbox"])
                if box.is_empty:
                    continue
                spans.append((box, _srgb(int(span.get("color") or 0)), _required(span)))
    if not spans:
        return 0
    images = [(pymupdf.Rect(info["bbox"]), info) for info in _image_entries(page)]
    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []
    fills = [
        (pymupdf.Rect(drawing["rect"]), colour)
        for drawing in drawings
        if drawing.get("type") in ("f", "fs")
        and (colour := _fill_colour(drawing.get("fill"))) is not None
        and _opaque(drawing)
    ]
    sampler = _BackdropSampler(page)
    images_of = samples or ImageSamples(page.parent)
    low = 0
    for box, colour, required in spans:
        under = [(rect, info) for rect, info in images if rect.intersects(box)]
        fill = _covering_fill(box, fills)
        if not under:
            backdrop = fill[1] if fill else WHITE
        elif fill is not None and fill[0].get_area() < under[-1][0].get_area():
            backdrop = fill[1]
        else:
            backdrop = images_of.colour_under(under[-1][1], box) or sampler.colour_around(box)
        if contrast_ratio(colour, backdrop) < required:
            low += 1
    return low
