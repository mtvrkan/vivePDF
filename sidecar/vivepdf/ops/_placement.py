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
