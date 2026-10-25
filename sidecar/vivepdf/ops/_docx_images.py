import pymupdf
from pdf2docx.image import ImagesExtractor as images_extractor

from vivepdf.ops._docx_visible import visible_images

MIN_IMAGE_AREA = 4
CLIPPED_MARK = "vivepdfClipped"
COVER_TOLERANCE = 1.0


def hide_page_text_and_images(
    page: pymupdf.Page, rm_text: bool, rm_image: bool
) -> dict[int, bytes]:
    xref_list = [xref for (xref, _name, _invoker, _bbox) in page.get_xobjects()]
    xref_list.extend(page.get_contents())
    image_names = [item[7] for item in page.get_images(full=True)] if rm_image else []

    def hide_text(stream: bytes) -> tuple[bytes, bool]:
        result = stream
        found = False
        for key in ["BT", "Tm", "Td", "2 Tr"]:
            marker = key.encode()
            if marker in stream:
                found = True
                result = result.replace(marker, f"{key} 3 Tr".encode())
        return result, found

    def hide_images(stream: bytes) -> tuple[bytes, bool]:
        result = stream
        found = False
        for name in image_names:
            marker = f"/{name} Do".encode()
            if marker in stream:
                found = True
                result = result.replace(marker, b"")
        return result, found

    document = page.parent
    source: dict[int, bytes] = {}
    for xref in xref_list:
        original = document.xref_stream(xref)
        stream, found_text = hide_text(original) if rm_text else (original, False)
        stream, found_images = hide_images(stream) if rm_image else (stream, False)
        if found_text or found_images:
            document.update_stream(xref, stream)
            source[xref] = original
    return source


class _PageInItsOwnFrame:
    def __init__(self, page: pymupdf.Page) -> None:
        object.__setattr__(self, "_page", page)

    def __getattr__(self, name: str) -> object:
        return getattr(object.__getattribute__(self, "_page"), name)

    @property
    def cropbox(self) -> pymupdf.Rect:
        box = object.__getattribute__(self, "_page").cropbox
        return pymupdf.Rect(0, 0, box.width, box.height)


_plain_extract_images = images_extractor.ImagesExtractor.extract_images


def _inline_image_areas(page: pymupdf.Page, taken: list[pymupdf.Rect]) -> list[pymupdf.Rect]:
    areas: list[pymupdf.Rect] = []
    for info in page.get_image_info(xrefs=True):
        bbox = pymupdf.Rect(info["bbox"]) & page.cropbox
        if info["xref"] or bbox.get_area() <= MIN_IMAGE_AREA:
            continue
        if any(bbox.intersects(other) for other in taken):
            continue
        for area in [area for area in areas if area.intersects(bbox)]:
            bbox |= area
            areas.remove(area)
        areas.append(bbox)
    return areas


def _widened(area: pymupdf.Rect) -> pymupdf.Rect:
    return area + (-COVER_TOLERANCE, -COVER_TOLERANCE, COVER_TOLERANCE, COVER_TOLERANCE)


def shown_area(
    bbox: pymupdf.Rect,
    placements: list[tuple[pymupdf.Rect, pymupdf.Rect]],
    frame: pymupdf.Rect,
) -> pymupdf.Rect:
    inside = [shown for placed, shown in placements if _widened(bbox).contains(placed)]
    if not inside:
        return pymupdf.Rect(bbox) & frame
    area = pymupdf.Rect()
    for shown in inside:
        if not shown.is_empty:
            area = pymupdf.Rect(shown) if area.is_empty else area | shown
    return area & frame


def extract_images_inside_the_page(extractor, clip_image_res_ratio: float = 3.0):
    page = extractor._page
    extractor._page = _PageInItsOwnFrame(page)
    plain_clip = extractor.clip_page_to_dict

    def clip(bbox=None, rm_image=False, ratio=clip_image_res_ratio):
        image = plain_clip(bbox, rm_image, ratio)
        image[CLIPPED_MARK] = True
        return image

    extractor.clip_page_to_dict = clip
    try:
        frame = extractor._page.cropbox
        placements = visible_images(page)
        images = []
        for image in _plain_extract_images(extractor, clip_image_res_ratio):
            bbox = pymupdf.Rect(image["bbox"])
            shown = shown_area(bbox, placements, frame)
            if shown.is_empty or shown.get_area() <= MIN_IMAGE_AREA:
                continue
            if _widened(shown).contains(bbox):
                images.append(image)
            else:
                images.append(clip(shown, False, clip_image_res_ratio))
        taken = [pymupdf.Rect(image["bbox"]) for image in images]
        for area in _inline_image_areas(extractor._page, taken):
            images.append(clip(area, False, clip_image_res_ratio))
        return images
    finally:
        del extractor.clip_page_to_dict
        extractor._page = page


_plain_to_raw_dict = images_extractor.ImagesExtractor._to_raw_dict


def _to_raw_dict_even_when_empty(image: pymupdf.Pixmap, bbox: pymupdf.Rect) -> dict:
    if image.width < 1 or image.height < 1:
        image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 1, 1), True)
        image.clear_with(255)
        image.set_alpha(bytes(1))
    return _plain_to_raw_dict(image, bbox)
