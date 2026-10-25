import hashlib
import re
from collections.abc import Iterator
from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._image_masks import BLACK, is_stencil, stencil_colours, stencil_png
from vivepdf.ops._inline_images import inline_images
from vivepdf.ops._naming import sanitize_file_name
from vivepdf.ops._pixmaps import png_ready
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._visible_images import page_pictures, shown_picture
from vivepdf.rpc.paths import ReadPath, WriteDir
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

INVOKED_XOBJECT = re.compile(rb"/([^\s/\[\]()<>{}%]+)\s+Do\b")


class ExtractImagesParams(RpcModel):
    path: ReadPath
    password: str | None = None
    output_dir: WriteDir
    pages: str | None = None
    min_size: int = Field(default=64, ge=1)
    dedupe: bool = True
    as_seen: bool = False


class ExtractImagesResult(RpcModel):
    outputs: list[str]
    count: int
    skipped: int
    bytes: int


def _image_bytes(document: pymupdf.Document, xref: int, smask: int) -> tuple[bytes, str] | None:
    if smask:
        pixmap = pymupdf.Pixmap(document, xref)
        mask = pymupdf.Pixmap(document, smask)
        pixmap = png_ready(pixmap)
        if pixmap.alpha:
            pixmap = pymupdf.Pixmap(pixmap, 0)
        if (mask.width, mask.height) != (pixmap.width, pixmap.height):
            mask = pymupdf.Pixmap(mask, pixmap.width, pixmap.height, None)
        try:
            combined = pymupdf.Pixmap(pixmap, mask)
        except Exception:
            return pixmap.tobytes("png"), "png"
        return combined.tobytes("png"), "png"
    extracted = document.extract_image(xref)
    if not extracted:
        return None
    data = extracted["image"]
    ext = str(extracted.get("ext") or "png").lower()
    if ext in ("jpx", "jb2", "jbig2") or (extracted.get("colorspace") or 0) >= 4:
        pixmap = pymupdf.Pixmap(document, xref)
        pixmap = png_ready(pixmap)
        return pixmap.tobytes("png"), "png"
    return data, ("jpg" if ext == "jpeg" else ext)


def _invoked_names(stream: bytes) -> Iterator[str]:
    return (name.decode("latin-1") for name in INVOKED_XOBJECT.findall(stream))


def _drawn_xrefs(page: pymupdf.Page, listed: dict[int, tuple]) -> list[int]:
    document = page.parent
    forms = {(invoker, name): xref for xref, name, invoker, _bbox in page.get_xobjects()}
    images = {(image[9], image[7]): xref for xref, image in listed.items()}
    drawn: list[int] = []
    visited: set[int] = set()
    stack = [(0, _invoked_names(page.read_contents()))]
    while stack:
        owner, names = stack[-1]
        name = next(names, None)
        if name is None:
            stack.pop()
            continue
        key = (owner, name) if (owner, name) in images or (owner, name) in forms else (0, name)
        if key in images:
            drawn.append(images[key])
        form = forms.get(key)
        if form is not None and form not in visited:
            visited.add(form)
            stack.append((form, _invoked_names(document.xref_stream(form) or b"")))
    return list(dict.fromkeys(drawn))


def free_path(folder: Path, stem: str, extension: str) -> Path:
    target = folder / f"{stem}.{extension}"
    number = 2
    while target.exists():
        target = folder / f"{stem} ({number}).{extension}"
        number += 1
    return target


@op("convert.extract_images", ExtractImagesParams)
def extract_images(params: ExtractImagesParams, progress: Progress) -> ExtractImagesResult:
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[str] = []
    try:
        total_bytes, skipped = _extract_page_images(params, progress, output_dir, outputs)
    except BaseException:
        for path in outputs:
            Path(path).unlink(missing_ok=True)
        raise
    return ExtractImagesResult(
        outputs=outputs, count=len(outputs), skipped=skipped, bytes=total_bytes
    )


def _first_time(contents: set[bytes], fingerprint: bytes) -> bool:
    if fingerprint in contents:
        return False
    contents.add(fingerprint)
    return True


def _extract_shown_images(
    page: pymupdf.Page,
    params: ExtractImagesParams,
    output_dir: Path,
    prefix: str,
    contents: set[bytes],
    outputs: list[str],
) -> tuple[int, int]:
    written = 0
    pictures, skipped = page_pictures(page)
    for number, image in enumerate(pictures, 1):
        if params.dedupe and image.key and not _first_time(contents, "".join(image.key).encode()):
            continue
        pixmap, data, ext = shown_picture(page, image)
        if pixmap.width < params.min_size or pixmap.height < params.min_size:
            skipped += 1
            continue
        if (
            params.dedupe
            and not image.key
            and not _first_time(contents, hashlib.sha1(data).digest())
        ):
            continue
        target = free_path(output_dir, f"{prefix}-{number:02d}", ext)
        outputs.append(str(target))
        target.write_bytes(data)
        written += len(data)
    return written, skipped


def _extract_page_images(
    params: ExtractImagesParams,
    progress: Progress,
    output_dir: Path,
    outputs: list[str],
) -> tuple[int, int]:
    skipped = 0
    total_bytes = 0
    seen: set[int] = set()
    contents: set[bytes] = set()
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        stem = sanitize_file_name(Path(params.path).stem)
        width = len(str(document.page_count))
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            if params.as_seen:
                written, missed = _extract_shown_images(
                    page, params, output_dir, f"{stem}-{index + 1:0{width}d}", contents, outputs
                )
                total_bytes += written
                skipped += missed
                if position % 5 == 0:
                    progress.report(
                        position / max(1, len(indices)),
                        "progress.extracting",
                        {"current": position + 1, "total": len(indices)},
                    )
                continue
            listed = {image[0]: image for image in page.get_images(full=True)}
            drawn = _drawn_xrefs(page, listed)
            stencils = [xref for xref in drawn if is_stencil(document, xref)]
            colours = stencil_colours(page, stencils) if stencils else {}
            for image_index, xref in enumerate(drawn):
                smask, img_width, img_height = listed[xref][1:4]
                if params.dedupe and xref in seen:
                    continue
                seen.add(xref)
                if img_width < params.min_size or img_height < params.min_size:
                    skipped += 1
                    continue
                payload = (
                    (stencil_png(document, xref, colours.get(xref, BLACK)), "png")
                    if xref in stencils
                    else _image_bytes(document, xref, smask)
                )
                if payload is None:
                    skipped += 1
                    continue
                data, ext = payload
                if params.dedupe:
                    fingerprint = hashlib.sha1(data).digest()
                    if fingerprint in contents:
                        continue
                    contents.add(fingerprint)
                target = free_path(
                    output_dir, f"{stem}-{index + 1:0{width}d}-{image_index + 1:02d}", ext
                )
                outputs.append(str(target))
                target.write_bytes(data)
                total_bytes += len(data)
            for image_index, (data, ext, img_width, img_height) in enumerate(
                inline_images(page), len(drawn)
            ):
                if img_width < params.min_size or img_height < params.min_size:
                    skipped += 1
                    continue
                if params.dedupe and not _first_time(contents, hashlib.sha1(data).digest()):
                    continue
                target = free_path(
                    output_dir, f"{stem}-{index + 1:0{width}d}-{image_index + 1:02d}", ext
                )
                outputs.append(str(target))
                target.write_bytes(data)
                total_bytes += len(data)
            if position % 5 == 0:
                progress.report(
                    position / max(1, len(indices)),
                    "progress.extracting",
                    {"current": position + 1, "total": len(indices)},
                )
    return total_bytes, skipped
