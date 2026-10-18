import pymupdf


def insertion_matrix(page: pymupdf.Page) -> pymupdf.Matrix:
    if page.rotation == 0:
        return pymupdf.Matrix(1, 0, 0, 1, 0, 0)
    crop, media = page.cropbox, page.mediabox
    shift = pymupdf.Matrix(1, 0, 0, 1, crop.x0, crop.y1 - media.y1)
    return page.derotation_matrix * shift


def unrotated_insertion_matrix(page: pymupdf.Page) -> pymupdf.Matrix:
    if page.rotation == 0:
        return pymupdf.Matrix(1, 0, 0, 1, 0, 0)
    return page.rotation_matrix * insertion_matrix(page)


def text_to_pdf_matrix(page: pymupdf.Page) -> pymupdf.Matrix:
    crop, media = page.cropbox, page.mediabox
    return pymupdf.Matrix(1, 0, 0, -1, max(crop.x0, media.x0), min(media.y1 - crop.y0, media.y1))


def write_text_on(
    page: pymupdf.Page,
    writer: pymupdf.TextWriter,
    morph: tuple[pymupdf.Point, pymupdf.Matrix] | None = None,
    **options: object,
) -> None:
    to_pdf = text_to_pdf_matrix(page)
    start = page.cropbox_position
    turned = page.rect.height - page.rect.width if page.rotation in (90, 270) else 0
    shift = pymupdf.Matrix(
        1,
        0,
        0,
        1,
        to_pdf.e - start.x,
        to_pdf.f - page.rect.height - start.y - page.mediabox.y0 + turned,
    )
    if morph is not None:
        pivot = morph[0] * writer.ictm
        about = pymupdf.Matrix(1, 1).pretranslate(pivot.x, pivot.y)
        shift = ~about * morph[1] * about * shift
    writer.write_text(page, matrix=shift, **options)


def drop_unplaceable_annotations(page: pymupdf.Page) -> int:
    doomed = [annot for annot in page.annots() if annot.rect.is_infinite or annot.rect.is_empty]
    for annot in doomed:
        page.delete_annot(annot)
    return len(doomed)


UPRIGHT_ROTATION = {(1, 0): 0, (0, -1): 90, (-1, 0): 180, (0, 1): 270}


def reading_rotation(page: pymupdf.Page) -> int:
    weights: dict[int, int] = {}
    for block in page.get_text("dict", flags=pymupdf.TEXT_MEDIABOX_CLIP)["blocks"]:
        for line in block.get("lines", ()):
            rotation = UPRIGHT_ROTATION.get((round(line["dir"][0]), round(line["dir"][1])))
            if rotation is not None:
                characters = sum(len(span["text"].strip()) for span in line["spans"])
                weights[rotation] = weights.get(rotation, 0) + characters
    if not weights:
        return page.rotation
    best = max(weights, key=weights.__getitem__)
    return best if weights[best] > weights.get(page.rotation, 0) else page.rotation


def turn_text_upright(document: pymupdf.Document, indices: list[int]) -> list[int]:
    turned: list[int] = []
    for index in indices:
        page = document[index]
        rotation = reading_rotation(page)
        if rotation != page.rotation:
            page.set_rotation(rotation)
            turned.append(index + 1)
    return turned
