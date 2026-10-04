import contextlib
import hashlib
import io
import json
import os
from collections.abc import Callable
from pathlib import Path

from PIL import Image

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops._output import write_atomically
from vivepdf.ops._studio_models import StudioImageItem, StudioPage, StudioTextItem
from vivepdf.ops.fonts import resolve_face

CACHE_VERSION = 2
CACHE_LIMIT = 600
STYLES = ((False, False), (True, False), (False, True), (True, True))

Rendered = tuple[bytes, int, int]


def _stamp(path: Path) -> list[str | int]:
    try:
        stat = path.stat()
    except OSError:
        return [str(path)]
    return [str(path), stat.st_size, stat.st_mtime_ns]


def cache_key(page: StudioPage, language: str, side: int) -> str:
    fonts = sorted(
        {
            font_id or ""
            for item in page.items
            if isinstance(item, StudioTextItem)
            for font_id in (
                item.font_id,
                *(run.font_id for run in item.runs),
                *(segment.font_id for segment in item.segments or []),
            )
        }
    )
    faces = [
        [font_id, *_stamp(resolve_face(font_id or None, bold, italic)[0])]
        for font_id in fonts
        for bold, italic in STYLES
    ]
    images = [_stamp(Path(item.path)) for item in page.items if isinstance(item, StudioImageItem)]
    payload = [CACHE_VERSION, page.model_dump(mode="json"), language, side, faces, images]
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def cache_folder() -> Path:
    folder = user_data_dir() / "cache" / "thumbnails"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _read(path: Path) -> Rendered | None:
    try:
        data = path.read_bytes()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
        os.utime(path)
    except (OSError, Image.UnidentifiedImageError):
        return None
    return data, width, height


def _prune(folder: Path) -> None:
    entries = []
    for path in folder.glob("*.jpg"):
        try:
            entries.append((path.stat().st_mtime_ns, path))
        except OSError:
            continue
    entries.sort()
    for _, path in entries[: max(0, len(entries) - CACHE_LIMIT)]:
        path.unlink(missing_ok=True)


def cached_thumbnail(
    page: StudioPage, language: str, side: int, render: Callable[[], Rendered]
) -> Rendered:
    try:
        folder = cache_folder()
        target = folder / f"{cache_key(page, language, side)}.jpg"
    except OSError:
        return render()
    known = _read(target) if target.is_file() else None
    if known is not None:
        return known
    rendered = render()
    with contextlib.suppress(OSError):
        write_atomically(target, lambda path: path.write_bytes(rendered[0]))
        _prune(folder)
    return rendered
