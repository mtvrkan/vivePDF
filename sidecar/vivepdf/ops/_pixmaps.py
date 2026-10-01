import pymupdf
from pymupdf import mupdf


def png_ready(pixmap: pymupdf.Pixmap) -> pymupdf.Pixmap:
    colorspace = pixmap.colorspace
    if colorspace is None:
        return pixmap
    if mupdf.fz_colorspace_is_gray(colorspace.this) or mupdf.fz_colorspace_is_rgb(colorspace.this):
        return pixmap
    return pymupdf.Pixmap(pymupdf.csRGB, pixmap)
