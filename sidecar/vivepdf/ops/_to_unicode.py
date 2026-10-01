import re

CMAP_CHUNK = 100
CMAP_PAIR = re.compile(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>")
CMAP_RANGE = re.compile(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>")
CMAP_RANGE_ARRAY = re.compile(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]")


def cmap_entries(data: bytes) -> dict[int, str]:
    entries: dict[int, str] = {}
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", data, re.DOTALL):
        for start, finish, listing in CMAP_RANGE_ARRAY.findall(block):
            values = re.findall(rb"<([0-9A-Fa-f]*)>", listing)
            for offset, value in enumerate(values[: int(finish, 16) - int(start, 16) + 1]):
                entries[int(start, 16) + offset] = _utf16(value)
        stripped = CMAP_RANGE_ARRAY.sub(b"", block)
        for start, finish, first in CMAP_RANGE.findall(stripped):
            low, high = int(start, 16), int(finish, 16)
            base = _utf16(first)
            if not base or high < low or high - low > 0xFFFF:
                continue
            for offset in range(high - low + 1):
                entries[low + offset] = base[:-1] + chr(min(0x10FFFF, ord(base[-1]) + offset))
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", data, re.DOTALL):
        for code, value in CMAP_PAIR.findall(block):
            entries[int(code, 16)] = _utf16(value)
    return entries


def _utf16(value: bytes) -> str:
    try:
        return bytes.fromhex(value.decode("ascii")).decode("utf-16-be", errors="replace")
    except ValueError:
        return ""


def cmap_stream(entries: dict[int, str]) -> bytes:
    lines = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /Adobe-Identity-UCS def",
        "/CMapType 2 def",
        "1 begincodespacerange",
        "<0000> <FFFF>",
        "endcodespacerange",
    ]
    codes = sorted(code for code in entries if 0 <= code <= 0xFFFF and entries[code])
    for index in range(0, len(codes), CMAP_CHUNK):
        chunk = codes[index : index + CMAP_CHUNK]
        lines.append(f"{len(chunk)} beginbfchar")
        lines.extend(
            f"<{code:04X}> <{entries[code].encode('utf-16-be').hex().upper()}>" for code in chunk
        )
        lines.append("endbfchar")
    lines.extend(["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"])
    return ("\n".join(lines) + "\n").encode("ascii")
