import math
import struct
from pathlib import Path

SECTOR = 512
MINI_SECTOR = 64
MINI_CUTOFF = 4096
END_OF_CHAIN = 0xFFFFFFFE
FREE_SECTOR = 0xFFFFFFFF
FAT_SECTOR = 0xFFFFFFFD
NO_STREAM = 0xFFFFFFFF
STORAGE, STREAM, ROOT = 1, 2, 5
Tree = dict[str, "bytes | Tree"]


def _flatten(name: str, node, entries: list[dict]) -> int:
    index = len(entries)
    entry: dict = {"name": name}
    entries.append(entry)
    if isinstance(node, dict):
        entry["type"] = STORAGE
        entry["children"] = [_flatten(key, value, entries) for key, value in node.items()]
    else:
        entry["type"] = STREAM
        entry["data"] = node
    return index


def _chain(start: int, count: int) -> list[int]:
    return [start + offset + 1 if offset < count - 1 else END_OF_CHAIN for offset in range(count)]


def _directory_entry(entry: dict) -> bytes:
    name = entry["name"].encode("utf-16-le") + b"\0\0"
    return struct.pack(
        "<64sHBBIII16sIQQIQ",
        name,
        len(name),
        entry["type"],
        1,
        NO_STREAM,
        entry.get("right", NO_STREAM),
        entry.get("child", NO_STREAM),
        b"\0" * 16,
        0,
        0,
        0,
        entry.get("start", END_OF_CHAIN),
        entry.get("size", 0),
    )


def write_compound_file(path: Path, tree: Tree) -> None:
    entries: list[dict] = []
    _flatten("Root Entry", tree, entries)
    entries[0]["type"] = ROOT
    for entry in entries:
        children = entry.get("children", [])
        if children:
            entry["child"] = children[0]
            for current, following in zip(children, children[1:], strict=False):
                entries[current]["right"] = following
    mini = bytearray()
    mini_fat: list[int] = []
    large = []
    for entry in entries:
        if entry["type"] != STREAM:
            continue
        data = entry["data"]
        entry["size"] = len(data)
        if len(data) >= MINI_CUTOFF:
            large.append(entry)
            continue
        count = math.ceil(len(data) / MINI_SECTOR)
        if count:
            entry["start"] = len(mini_fat)
            mini_fat += _chain(len(mini_fat), count)
            mini += data + b"\0" * (count * MINI_SECTOR - len(data))
    directory_sectors = math.ceil(len(entries) * 128 / SECTOR)
    mini_fat_sectors = math.ceil(len(mini_fat) * 4 / SECTOR)
    mini_sectors = math.ceil(len(mini) / SECTOR)
    large_sectors = [math.ceil(len(entry["data"]) / SECTOR) for entry in large]
    content = directory_sectors + mini_fat_sectors + mini_sectors + sum(large_sectors)
    fat_sectors = 1
    while fat_sectors * (SECTOR // 4) < content + fat_sectors:
        fat_sectors += 1
    fat = [FAT_SECTOR] * fat_sectors
    first_directory = len(fat)
    fat += _chain(first_directory, directory_sectors)
    first_mini_fat = len(fat) if mini_fat_sectors else END_OF_CHAIN
    fat += _chain(len(fat), mini_fat_sectors)
    entries[0]["start"] = len(fat) if mini_sectors else END_OF_CHAIN
    entries[0]["size"] = len(mini)
    fat += _chain(len(fat), mini_sectors)
    for entry, count in zip(large, large_sectors, strict=True):
        entry["start"] = len(fat)
        fat += _chain(len(fat), count)
    fat += [FREE_SECTOR] * (fat_sectors * (SECTOR // 4) - len(fat))
    difat = list(range(fat_sectors)) + [FREE_SECTOR] * (109 - fat_sectors)
    header = (
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
        + b"\0" * 16
        + struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6)
        + b"\0" * 6
        + struct.pack(
            "<IIIIIIIII",
            0,
            fat_sectors,
            first_directory,
            0,
            MINI_CUTOFF,
            first_mini_fat,
            mini_fat_sectors,
            END_OF_CHAIN,
            0,
        )
        + struct.pack("<109I", *difat)
    )

    def padded(data: bytes, sectors: int, filler: bytes = b"\0") -> bytes:
        return data + filler * (sectors * SECTOR - len(data))

    directory = b"".join(_directory_entry(entry) for entry in entries)
    empty_entry = struct.pack(
        "<64sHBBIII16sIQQIQ",
        b"",
        0,
        0,
        0,
        NO_STREAM,
        NO_STREAM,
        NO_STREAM,
        b"\0" * 16,
        0,
        0,
        0,
        0,
        0,
    )
    directory += empty_entry * (directory_sectors * 4 - len(entries))
    body = (
        struct.pack(f"<{len(fat)}I", *fat)
        + directory
        + padded(struct.pack(f"<{len(mini_fat)}I", *mini_fat), mini_fat_sectors, b"\xff")
        + padded(bytes(mini), mini_sectors)
        + b"".join(
            padded(entry["data"], count) for entry, count in zip(large, large_sectors, strict=True)
        )
    )
    path.write_bytes(header + body)
