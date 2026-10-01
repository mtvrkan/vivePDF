import pymupdf
from pymupdf import mupdf


def promote_inline_annotations(document: pymupdf.Document) -> int:
    if not document.is_pdf:
        return 0
    pdf = pymupdf._as_pdf_document(document)
    promoted = 0
    for index in range(document.page_count):
        try:
            page = mupdf.pdf_lookup_page_obj(pdf, index)
            annotations = mupdf.pdf_dict_get(page, mupdf.PDF_ENUM_NAME_Annots)
            if not mupdf.pdf_is_array(annotations):
                continue
            for position in range(mupdf.pdf_array_len(annotations)):
                item = mupdf.pdf_array_get(annotations, position)
                if mupdf.pdf_is_indirect(item) or not mupdf.pdf_is_dict(item):
                    continue
                mupdf.pdf_array_put(annotations, position, mupdf.pdf_add_object(pdf, item))
                promoted += 1
        except mupdf.FzErrorBase:
            continue
    return promoted
