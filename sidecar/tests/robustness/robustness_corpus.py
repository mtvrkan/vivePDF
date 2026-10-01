import io
import random
import struct
import zipfile
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pymupdf

DEFAULT_SEED = 20260919
FONT_FILE = Path(__file__).resolve().parents[2] / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"


@dataclass(frozen=True)
class Variant:
    name: str
    category: str
    file_name: str
    build: Callable[[], bytes]


def stream_object(data: bytes, entries: bytes = b"") -> bytes:
    return b"<< /Length %d %s>>\nstream\n" % (len(data), entries) + data + b"\nendstream"


def assemble(
    objects: list[bytes], root: int = 1, trailer_extra: bytes = b"", header: bytes = b"1.7"
) -> bytes:
    out = bytearray(b"%PDF-" + header + b"\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref_offset = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root %d 0 R %s>>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        root,
        trailer_extra,
        xref_offset,
    )
    return bytes(out)


TEXT_CONTENT = b"BT /F1 18 Tf 72 720 Td (Robustness sample page) Tj ET"
FONT_OBJECT = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"


def single_page(
    page_extra: bytes = b"",
    content: bytes = TEXT_CONTENT,
    content_entries: bytes = b"",
    resources: bytes = b"<< /Font << /F1 4 0 R >> >>",
    media_box: bytes = b"[0 0 612 792]",
    extra_objects: list[bytes] | None = None,
    catalog_extra: bytes = b"",
    trailer_extra: bytes = b"",
) -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R %s>>" % catalog_extra,
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox %s /Resources %s /Contents 5 0 R %s>>"
        % (media_box, resources, page_extra),
        FONT_OBJECT,
        stream_object(content, content_entries),
    ]
    objects.extend(extra_objects or [])
    return assemble(objects, trailer_extra=trailer_extra)


def raw_base() -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R /AcroForm << /Fields [12 0 R] >> >>",
        b"<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R] /Count 3 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R"
        b" >> /XObject << /Im1 8 0 R >> >> /Contents 5 0 R /Annots [11 0 R 12 0 R] >>",
        FONT_OBJECT,
        stream_object(
            zlib.compress(TEXT_CONTENT + b"\nq 100 0 0 100 72 500 cm /Im1 Do Q"),
            b"/Filter /FlateDecode ",
        ),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Rotate 90 /Resources << /Font"
        b" << /F1 4 0 R >> >> /Contents 13 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Contents 14 0 R"
        b" >>",
        stream_object(
            zlib.compress(bytes(range(256)) * 12),
            b"/Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceRGB"
            b" /BitsPerComponent 8 /Filter /FlateDecode ",
        ),
        b"<< /Type /Outlines /First 10 0 R /Last 10 0 R /Count 1 >>",
        b"<< /Title (Chapter) /Parent 9 0 R /Dest [3 0 R /XYZ 0 792 0] >>",
        b"<< /Type /Annot /Subtype /Text /Rect [300 700 320 720] /Contents (Note) /NM (n1) >>",
        b"<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (Value) /Rect [72 600 272 620]"
        b" /P 3 0 R >>",
        stream_object(b"BT /F1 14 Tf 72 500 Td (Second page) Tj ET"),
        stream_object(b""),
    ]
    return assemble(objects, trailer_extra=b"/Info << /Title (Robustness) >> ")


def rich_base() -> bytes:
    document = pymupdf.open()
    for index in range(4):
        page = document.new_page(width=595 if index % 2 == 0 else 842, height=842)
        page.insert_text(
            (72, 100),
            f"Sayfa {index + 1} şğıİüöç",
            fontname="dejavu",
            fontfile=str(FONT_FILE),
            fontsize=14,
        )
        page.insert_text((72, 140), "Lorem ipsum dolor sit amet 12345", fontsize=11)
        page.add_highlight_annot(pymupdf.Rect(72, 125, 300, 145))
        page.insert_link(
            {
                "kind": pymupdf.LINK_URI,
                "from": pymupdf.Rect(72, 160, 200, 180),
                "uri": "https://example.org",
            }
        )
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 24, 24), False)
    pixmap.set_rect(pixmap.irect, (200, 30, 30))
    document[0].insert_image(pymupdf.Rect(300, 300, 400, 400), pixmap=pixmap)
    widget = pymupdf.Widget()
    widget.field_name = "email"
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.rect = pymupdf.Rect(72, 600, 300, 620)
    widget.field_value = "a@example.org"
    document[1].add_widget(widget)
    document.embfile_add("notes.txt", b"attached text", filename="notes.txt")
    document.set_toc([[1, "Bir", 1], [2, "Iki", 2], [1, "Uc", 3]])
    document.set_metadata(
        {"title": "Rich", "author": "Robustness", "creationDate": "", "modDate": ""}
    )
    for xref in range(1, document.xref_length()):
        for key in ("CreationDate", "ModDate", "M", "Params/CreationDate", "Params/ModDate"):
            if document.xref_get_key(xref, key)[0] != "null":
                document.xref_set_key(xref, key, "(D:20260101000000Z)")
    data = document.tobytes(garbage=3, deflate=True, no_new_id=True)
    document.close()
    return data


def pages_document(count: int, media_box: bytes = b"[0 0 200 200]") -> bytes:
    kids_start = 5
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [%s] /Count %d >>"
        % (b" ".join(b"%d 0 R" % (kids_start + i) for i in range(count)), count),
        FONT_OBJECT,
        stream_object(b"BT /F1 12 Tf 20 100 Td (p) Tj ET"),
    ]
    for _ in range(count):
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox %s /Resources << /Font << /F1 3 0 R >> >>"
            b" /Contents 4 0 R >>" % media_box
        )
    return assemble(objects)


def zero_pages() -> bytes:
    return assemble([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [] /Count 0 >>"])


def cyclic_kid_is_root() -> bytes:
    return assemble(
        [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R 2 0 R] /Count 2 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
            stream_object(b""),
        ]
    )


def cyclic_mutual_pages() -> bytes:
    return assemble(
        [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 2 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 200] >>",
        ]
    )


def cyclic_self_page() -> bytes:
    return assemble(
        [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Pages /Parent 3 0 R /Kids [3 0 R] /Count 1 >>",
        ]
    )


def lying_count() -> bytes:
    return assemble(
        [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1000000 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
        ]
    )


def deep_page_tree(depth: int) -> bytes:
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    for level in range(depth):
        number = level + 2
        parent = b"/Parent %d 0 R " % (number - 1) if level else b""
        objects.append(b"<< /Type /Pages %s/Kids [%d 0 R] /Count 1 >>" % (parent, number + 1))
    objects.append(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 200 200] >>" % (depth + 1))
    return assemble(objects)


def outline_chain(depth: int) -> bytes:
    first = 7
    extra = [b"<< /Type /Outlines /First %d 0 R /Last %d 0 R /Count %d >>" % (first, first, depth)]
    for level in range(depth):
        number = first + level
        parent = number - 1
        child = (
            b"/First %d 0 R /Last %d 0 R /Count 1 " % (number + 1, number + 1)
            if (level < depth - 1)
            else b""
        )
        extra.append(
            b"<< /Title (Level %d) /Parent %d 0 R %s/Dest [3 0 R /Fit] >>" % (level, parent, child)
        )
    return single_page(extra_objects=extra, catalog_extra=b"/Outlines 6 0 R ")


def outline_cycle_next() -> bytes:
    return single_page(
        extra_objects=[
            b"<< /Type /Outlines /First 7 0 R /Last 8 0 R /Count 2 >>",
            b"<< /Title (A) /Parent 6 0 R /Next 8 0 R /Dest [3 0 R /Fit] >>",
            b"<< /Title (B) /Parent 6 0 R /Prev 7 0 R /Next 7 0 R /Dest [3 0 R /Fit] >>",
        ],
        catalog_extra=b"/Outlines 6 0 R ",
    )


def outline_self_child() -> bytes:
    return single_page(
        extra_objects=[
            b"<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 1 >>",
            b"<< /Title (Loop) /Parent 7 0 R /First 7 0 R /Last 7 0 R /Count 1 /Dest [3 0 R /Fit]"
            b" >>",
        ],
        catalog_extra=b"/Outlines 6 0 R ",
    )


def outline_wide(count: int) -> bytes:
    first = 7
    extra = [
        b"<< /Type /Outlines /First %d 0 R /Last %d 0 R /Count %d >>"
        % (first, first + count - 1, count)
    ]
    for index in range(count):
        number = first + index
        previous = b"/Prev %d 0 R " % (number - 1) if index else b""
        following = b"/Next %d 0 R " % (number + 1) if index < count - 1 else b""
        extra.append(
            b"<< /Title (Item %d) /Parent 6 0 R %s%s/Dest [3 0 R /Fit] >>"
            % (index, previous, following)
        )
    return single_page(extra_objects=extra, catalog_extra=b"/Outlines 6 0 R ")


def xobject_recursive_self() -> bytes:
    return single_page(
        content=b"/X1 Do",
        resources=b"<< /XObject << /X1 6 0 R >> >>",
        extra_objects=[
            stream_object(
                b"0 0 m 10 10 l S /X1 Do",
                b"/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject <<"
                b" /X1 6 0 R >> >> ",
            )
        ],
    )


def xobject_recursive_mutual() -> bytes:
    return single_page(
        content=b"/XA Do",
        resources=b"<< /XObject << /XA 6 0 R >> >>",
        extra_objects=[
            stream_object(
                b"/XB Do",
                b"/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject <<"
                b" /XB 7 0 R >> >> ",
            ),
            stream_object(
                b"/XA Do",
                b"/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject <<"
                b" /XA 6 0 R >> >> ",
            ),
        ],
    )


def xobject_deep_chain(depth: int) -> bytes:
    extra = []
    for level in range(depth):
        number = 6 + level
        if level < depth - 1:
            extra.append(
                stream_object(
                    b"/X Do",
                    b"/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject <<"
                    b" /X %d 0 R >> >> " % (number + 1),
                )
            )
        else:
            extra.append(
                stream_object(b"0 0 m 5 5 l S", b"/Type /XObject /Subtype /Form /BBox [0 0 9 9] ")
            )
    return single_page(
        content=b"/X Do", resources=b"<< /XObject << /X 6 0 R >> >>", extra_objects=extra
    )


def pattern_recursive() -> bytes:
    return single_page(
        content=b"/Pattern cs /P1 scn 0 0 200 200 re f",
        resources=b"<< /Pattern << /P1 6 0 R >> >>",
        extra_objects=[
            stream_object(
                b"/Pattern cs /P1 scn 0 0 10 10 re f",
                b"/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10"
                b" /Resources << /Pattern << /P1 6 0 R >> >> ",
            )
        ],
    )


def font_document(font: bytes, extra: list[bytes]) -> bytes:
    return single_page(
        content=b"BT /FX 18 Tf 72 700 Td (Broken font text) Tj ET",
        resources=b"<< /Font << /FX 6 0 R >> >>",
        extra_objects=[font, *extra],
    )


def broken_truetype() -> bytes:
    return font_document(
        b"<< /Type /Font /Subtype /TrueType /BaseFont /Broken /FirstChar 32 /LastChar 126"
        b" /Widths [500] /FontDescriptor 7 0 R >>",
        [
            b"<< /Type /FontDescriptor /FontName /Broken /Flags 32 /FontBBox [0 0 1000 1000]"
            b" /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 8 0 R"
            b" >>",
            stream_object(b"\x00\x01\x00\x00" + bytes(range(256)) * 4),
        ],
    )


def broken_cff() -> bytes:
    return font_document(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /BrokenCff /FontDescriptor 7 0 R >>",
        [
            b"<< /Type /FontDescriptor /FontName /BrokenCff /Flags 32 /FontBBox [0 0 1000 1000]"
            b" /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile3 8 0 R"
            b" >>",
            stream_object(b"\x01\x00\x04\x02" + b"\xff" * 700, b"/Subtype /Type1C "),
        ],
    )


def broken_type0() -> bytes:
    return font_document(
        b"<< /Type /Font /Subtype /Type0 /BaseFont /Missing /Encoding /Identity-H"
        b" /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>",
        [
            b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Missing /CIDSystemInfo 99 0 R"
            b" /W [0 [1 2 3] 5 99999999 7] >>",
            stream_object(b"begincmap garbage endcmap \xff\xfe"),
        ],
    )


def font_without_base() -> bytes:
    return font_document(b"<< /Type /Font /Subtype /Type1 >>", [])


def type3_recursive() -> bytes:
    return font_document(
        b"<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001"
        b" 0 0] /CharProcs << /a 7 0 R >> /Encoding << /Differences [65 /a 66 /a 82 /a 98 /a"
        b" 114 /a] >> /FirstChar 32 /LastChar 126 /Widths [] /Resources << /Font << /FX 6 0 R"
        b" >> >> >>",
        [stream_object(b"1000 0 d0 BT /FX 12 Tf (Rab) Tj ET")],
    )


def font_widths_wrong() -> bytes:
    return font_document(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 200 /LastChar 10"
        b" /Widths 7 0 R >>",
        [b"[-1 1e308 (x) /Name]"],
    )


def image_document(image: bytes, extra: list[bytes] | None = None) -> bytes:
    return single_page(
        content=b"q 200 0 0 200 72 400 cm /Im Do Q",
        resources=b"<< /XObject << /Im 6 0 R >> >>",
        extra_objects=[image, *(extra or [])],
    )


def image_stream(data: bytes, entries: bytes, width: int = 64, height: int = 64) -> bytes:
    return stream_object(
        data,
        b"/Type /XObject /Subtype /Image /Width %d /Height %d %s" % (width, height, entries),
    )


def bad_images(rng: random.Random) -> list[tuple[str, bytes]]:
    garbage = bytes(rng.randrange(256) for _ in range(900))
    gray = b"/ColorSpace /DeviceGray /BitsPerComponent 1 "
    return [
        ("jbig2_garbage", image_document(image_stream(garbage, gray + b"/Filter /JBIG2Decode "))),
        (
            "jbig2_missing_globals",
            image_document(
                image_stream(
                    b"\x00\x00\x00\x00\x30\x00\x01" + garbage[:200],
                    gray + b"/Filter /JBIG2Decode /DecodeParms << /JBIG2Globals 99 0 R >> ",
                )
            ),
        ),
        (
            "jpx_garbage",
            image_document(
                image_stream(b"\x00\x00\x00\x0cjP  \r\n\x87\n" + garbage, b"/Filter /JPXDecode ")
            ),
        ),
        (
            "ccitt_garbage",
            image_document(
                image_stream(
                    garbage,
                    gray
                    + b"/Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 64 /Rows 64 >> ",
                )
            ),
        ),
        (
            "ccitt_bad_columns",
            image_document(
                image_stream(
                    garbage[:50],
                    gray + b"/Filter /CCITTFaxDecode /DecodeParms << /K 0 /Columns 0 /Rows -5 >> ",
                )
            ),
        ),
        (
            "dct_garbage",
            image_document(
                image_stream(
                    b"\xff\xd8\xff\xe0" + garbage,
                    b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ",
                )
            ),
        ),
        (
            "flate_garbage",
            image_document(
                image_stream(
                    garbage, b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
                )
            ),
        ),
        (
            "huge_image_dimensions",
            image_document(
                image_stream(
                    zlib.compress(b"\x00" * 1000),
                    b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ",
                    width=60000,
                    height=60000,
                )
            ),
        ),
        (
            "invalid_bits_per_component",
            image_document(
                image_stream(b"\x00" * 64, b"/ColorSpace /DeviceRGB /BitsPerComponent 3 ")
            ),
        ),
        (
            "unknown_colour_space",
            image_document(image_stream(b"\x00" * 64, b"/ColorSpace /Nope /BitsPerComponent 8 ")),
        ),
        (
            "cyclic_soft_mask",
            image_document(
                image_stream(
                    b"\x80" * (64 * 64 * 3),
                    b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 7 0 R ",
                ),
                [
                    image_stream(
                        b"\x80" * (64 * 64),
                        b"/ColorSpace /DeviceGray /BitsPerComponent 8 /SMask 6 0 R ",
                    )
                ],
            ),
        ),
        (
            "unknown_filter",
            image_document(
                image_stream(garbage, b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /Nope ")
            ),
        ),
    ]


def action_documents() -> list[tuple[str, bytes]]:
    return [
        (
            "javascript_open_action",
            single_page(
                extra_objects=[b"<< /S /JavaScript /JS (app.alert\\('x'\\); while\\(1\\){}) >>"],
                catalog_extra=b"/OpenAction 6 0 R ",
            ),
        ),
        (
            "launch_action",
            single_page(
                extra_objects=[
                    b"<< /S /Launch /F (cmd.exe) /Win << /F (cmd.exe) /P (/c calc) >> >>"
                ],
                catalog_extra=b"/OpenAction 6 0 R ",
            ),
        ),
        (
            "javascript_name_tree",
            single_page(
                extra_objects=[
                    b"<< /JavaScript << /Names [(a) 7 0 R] >> >>",
                    b"<< /S /JavaScript /JS 8 0 R >>",
                    stream_object(b"this.print(); app.launchURL('http://example.invalid');"),
                ],
                catalog_extra=b"/Names 6 0 R ",
            ),
        ),
        (
            "page_additional_actions",
            single_page(
                page_extra=b"/AA << /O 6 0 R /C 6 0 R >> ",
                extra_objects=[b"<< /S /JavaScript /JS (this.closeDoc\\(\\)) >>"],
            ),
        ),
        (
            "javascript_uri_link",
            single_page(
                page_extra=b"/Annots [6 0 R] ",
                extra_objects=[
                    b"<< /Type /Annot /Subtype /Link /Rect [72 700 200 720] /A << /S /URI"
                    b" /URI (javascript:alert\\(1\\)) >> >>"
                ],
            ),
        ),
        (
            "submit_form_action",
            single_page(
                extra_objects=[
                    b"<< /S /SubmitForm /F << /FS /URL /F (http://example.invalid/submit) >>"
                    b" /Flags 4 >>"
                ],
                catalog_extra=b"/OpenAction 6 0 R ",
            ),
        ),
        (
            "remote_goto_action",
            single_page(
                page_extra=b"/Annots [6 0 R] ",
                extra_objects=[
                    b"<< /Type /Annot /Subtype /Link /Rect [72 700 200 720] /A << /S /GoToR"
                    b" /F (..\\\\..\\\\Windows\\\\win.ini) /D [0 /Fit] >> >>"
                ],
            ),
        ),
        (
            "annotation_javascript",
            single_page(
                page_extra=b"/Annots [6 0 R] ",
                extra_objects=[
                    b"<< /Type /Annot /Subtype /Widget /FT /Btn /T (b) /Rect [72 600 200 640]"
                    b" /A << /S /JavaScript /JS (app.alert\\(1\\)) >> /AA << /E << /S /JavaScript"
                    b" /JS (1) >> >> >>"
                ],
                catalog_extra=b"/AcroForm << /Fields [6 0 R] >> ",
            ),
        ),
    ]


def geometry_documents() -> list[tuple[str, bytes]]:
    boxes = {
        "huge_media_box": b"[0 0 1000000 1000000]",
        "astronomic_media_box": b"[0 0 1e30 1e30]",
        "maximum_media_box": b"[0 0 14400 14400]",
        "negative_media_box": b"[-500 -500 -100 -100]",
        "inverted_media_box": b"[612 792 0 0]",
        "zero_size_page": b"[0 0 0 0]",
        "zero_width_page": b"[0 0 0 792]",
        "overflow_media_box": b"[0 0 1e999 1e999]",
        "short_media_box": b"[0 0 612]",
        "non_numeric_media_box": b"[(a) /b null true]",
    }
    documents = [(name, single_page(media_box=box)) for name, box in boxes.items()]
    documents.append(("missing_media_box", single_page(media_box=b"null")))
    documents.append(("odd_rotation", single_page(page_extra=b"/Rotate 45 ")))
    documents.append(("huge_user_unit", single_page(page_extra=b"/UserUnit 75000 ")))
    documents.append(
        ("crop_box_outside", single_page(page_extra=b"/CropBox [5000 5000 6000 6000] "))
    )
    return documents


def dangling_object_stream_entry() -> bytes:
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}

    def add(number: int, body: bytes) -> None:
        offsets[number] = len(out)
        out.extend(b"%d 0 obj\n" % number + body + b"\nendobj\n")

    add(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    add(2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    add(3, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>")
    header = b"5 0 "
    packed = header + b"<< /Type /FontDescriptor /FontName /X >>"
    add(
        4,
        b"<< /Type /ObjStm /N 1 /First %d /Length %d >>\nstream\n" % (len(header), len(packed))
        + packed
        + b"\nendstream",
    )
    xref_offset = len(out)
    rows = [(0, 0, 255), *((1, offsets[n], 0) for n in range(1, 5)), (2, 4, 0), (2, 4, 1)]
    rows.append((1, xref_offset, 0))
    table = b"".join(
        bytes([kind]) + field.to_bytes(3, "big") + bytes([index]) for kind, field, index in rows
    )
    out.extend(
        b"7 0 obj\n<< /Type /XRef /Size 8 /W [1 3 1] /Root 1 0 R /Length %d >>\nstream\n"
        % len(table)
        + table
        + b"\nendstream\nendobj\nstartxref\n%d\n%%%%EOF\n" % xref_offset
    )
    return bytes(out)


def structure_documents(base: bytes) -> list[tuple[str, bytes]]:
    duplicate = base.replace(b"\n4 0 obj", b"\n3 0 obj", 1)
    huge_numbers = base.replace(b"\n4 0 obj", b"\n99999999 0 obj", 1)
    negative_generation = base.replace(b"\n5 0 obj", b"\n5 -3 obj", 1)
    garbled = base.replace(b" 0 obj", b" 0 ojb", 3)
    missing_root = base.replace(b"/Root 1 0 R", b"/Rooot 1 0 R")
    root_not_dict = base.replace(b"/Root 1 0 R", b"/Root 42")
    kids_not_array = base.replace(b"/Kids [3 0 R 6 0 R 7 0 R]", b"/Kids 3 0 R")
    no_xref = base[: base.rfind(b"xref")] + b"%%EOF\n"
    wrong_startxref = base[: base.rfind(b"startxref")] + b"startxref\n999999999\n%%EOF\n"
    stream_length_lies = base.replace(b"/Length ", b"/Length 9", 2)
    missing_endstream = base.replace(b"endstream", b"endstrem")
    self_reference_length = base.replace(b"/Length ", b"/Length 5 0 R %", 1)
    return [
        ("duplicate_object_number", duplicate),
        ("huge_object_number", huge_numbers),
        ("negative_generation", negative_generation),
        ("garbled_object_keyword", garbled),
        ("missing_root", missing_root),
        ("root_not_dictionary", root_not_dict),
        ("kids_not_array", kids_not_array),
        ("missing_xref", no_xref),
        ("wrong_startxref", wrong_startxref),
        ("stream_length_lies", stream_length_lies),
        ("missing_endstream", missing_endstream),
        ("self_referencing_length", self_reference_length),
        ("cyclic_kid_is_root", cyclic_kid_is_root()),
        ("cyclic_mutual_pages", cyclic_mutual_pages()),
        ("cyclic_self_pages", cyclic_self_page()),
        ("lying_page_count", lying_count()),
        ("deep_page_tree", deep_page_tree(400)),
        ("header_only", b"%PDF-1.7\n"),
        ("header_and_eof", b"%PDF-1.7\n%%EOF\n"),
        ("garbage_before_header", bytes(4096) + base),
        ("utf8_bom_before_header", b"\xef\xbb\xbf" + base),
        ("future_version", base.replace(b"%PDF-1.7", b"%PDF-9.9", 1)),
        ("dangling_object_stream_entry", dangling_object_stream_entry()),
    ]


def encrypted_documents(source: bytes) -> list[tuple[str, bytes]]:
    methods = {
        "rc4_40": pymupdf.PDF_ENCRYPT_RC4_40,
        "rc4_128": pymupdf.PDF_ENCRYPT_RC4_128,
        "aes_128": pymupdf.PDF_ENCRYPT_AES_128,
        "aes_256": pymupdf.PDF_ENCRYPT_AES_256,
    }
    documents = []
    for label, method in methods.items():
        for mode, user in (("user_password", "secret"), ("owner_only", "")):
            with pymupdf.open(stream=source, filetype="pdf") as document:
                data = document.tobytes(
                    encryption=method,
                    user_pw=user,
                    owner_pw="owner",
                    permissions=pymupdf.PDF_PERM_PRINT,
                    no_new_id=True,
                )
            documents.append((f"encrypted_{label}_{mode}", data))
    with pymupdf.open(stream=source, filetype="pdf") as document:
        same = document.tobytes(
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw="same",
            owner_pw="same",
            no_new_id=True,
        )
    documents.append(("encrypted_same_passwords", same))
    documents.append(
        (
            "encrypt_dictionary_broken",
            single_page(
                extra_objects=[b"<< /Filter /Standard /V 9 /R 99 /O (x) /U (y) /P -4 >>"],
                trailer_extra=b"/Encrypt 6 0 R /ID [(a) (a)] ",
            ),
        )
    )
    documents.append(
        (
            "encrypt_unknown_handler",
            single_page(
                extra_objects=[b"<< /Filter /Nonexistent /V 1 /R 2 >>"],
                trailer_extra=b"/Encrypt 6 0 R ",
            ),
        )
    )
    return documents


def png_bytes() -> bytes:
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * 4 for _ in range(4))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def zip_bytes(names: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in names.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            archive.writestr(info, data)
    return buffer.getvalue()


def non_pdf_documents(rng: random.Random) -> list[tuple[str, bytes]]:
    return [
        ("empty_file", b""),
        ("single_byte", b"%"),
        ("nul_bytes", bytes(2048)),
        ("whitespace_only", b" \r\n\t" * 100),
        ("png_renamed", png_bytes()),
        ("jpeg_header_renamed", b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + bytes(200) + b"\xff\xd9"),
        ("zip_renamed", zip_bytes({"a.txt": b"hello"})),
        (
            "docx_renamed",
            zip_bytes(
                {
                    "[Content_Types].xml": b"<Types/>",
                    "word/document.xml": b"<w:document/>",
                }
            ),
        ),
        ("html_renamed", b"<!doctype html><html><body><h1>Not a PDF</h1></body></html>"),
        ("text_renamed", "Düz metin dosyası, PDF değil.\n".encode() * 20),
        ("random_bytes", bytes(rng.randrange(256) for _ in range(4096))),
        ("pdf_word_only", b"%PDF-"),
        (
            "fdf_renamed",
            b"%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [] >> >>\nendobj\ntrailer\n"
            b"<< /Root 1 0 R >>\n%%EOF\n",
        ),
        (
            "postscript_renamed",
            b"%!PS-Adobe-3.0\n/Helvetica findfont 12 scalefont setfont\n"
            b"72 720 moveto (hi) show showpage\n",
        ),
    ]


def decompression_bomb() -> bytes:
    compressor = zlib.compressobj(9)
    chunk = b"0 0 m 1 1 l S\n" * 4096
    data = b"".join(compressor.compress(chunk) for _ in range(1500)) + compressor.flush()
    return single_page(content=data, content_entries=b"/Filter /FlateDecode ")


def truncations(label: str, data: bytes, count: int) -> list[tuple[str, bytes]]:
    size = len(data)
    offsets = {1, 8, 9, 16, size - 1, size - 8, size - 20, size - 40, size // 2}
    for index in range(1, count):
        offsets.add(size * index // count)
    return [
        (f"truncated_{label}_{offset:07d}", data[:offset])
        for offset in sorted(value for value in offsets if 0 < value < size)
    ]


def regions(data: bytes) -> dict[str, tuple[int, int]]:
    xref = data.rfind(b"xref")
    trailer = data.rfind(b"trailer")
    start = data.find(b"stream\n")
    end = data.rfind(b"endstream")
    spans = {"anywhere": (0, len(data))}
    if xref > 0:
        spans["xref"] = (xref, trailer if trailer > xref else len(data))
    if trailer > 0:
        spans["trailer"] = (trailer, len(data))
    if 0 < start < end:
        spans["streams"] = (start, end)
    return spans


def byte_flips(
    label: str, data: bytes, rng: random.Random, per_region: dict[str, int]
) -> list[tuple[str, bytes]]:
    documents = []
    for region, (low, high) in regions(data).items():
        for index in range(per_region.get(region, 0)):
            mutated = bytearray(data)
            for _ in range(rng.randint(1, 8)):
                position = rng.randrange(low, max(low + 1, high))
                mutated[position] = rng.randrange(256)
            documents.append((f"flip_{label}_{region}_{index:02d}", bytes(mutated)))
    return documents


def valid_documents() -> list[tuple[str, bytes]]:
    return [
        ("valid_raw_base", raw_base()),
        ("valid_rich_base", rich_base()),
        ("single_page", single_page()),
        ("zero_pages", zero_pages()),
        ("ten_thousand_pages", pages_document(10000, b"[0 0 72 72]")),
        ("deep_outline", outline_chain(1500)),
        ("wide_outline", outline_wide(5000)),
        ("outline_cycle_next", outline_cycle_next()),
        ("outline_self_child", outline_self_child()),
        ("xobject_recursive_self", xobject_recursive_self()),
        ("xobject_recursive_mutual", xobject_recursive_mutual()),
        ("xobject_deep_chain", xobject_deep_chain(300)),
        ("pattern_recursive", pattern_recursive()),
        ("font_truetype_garbage", broken_truetype()),
        ("font_cff_garbage", broken_cff()),
        ("font_type0_broken", broken_type0()),
        ("font_without_base", font_without_base()),
        ("font_type3_recursive", type3_recursive()),
        ("font_widths_wrong", font_widths_wrong()),
    ]


NAME_VARIANTS = {
    "name_turkish": "Şirket raporu ğüıİöç.pdf",
    "name_emoji": "belge 😀 🧾.pdf",
    "name_cjk": "文件测试.pdf",
    "name_arabic_rtl": "ملف ‮txt.pdf",
    "name_combining": "été café.pdf",
    "name_leading_dash": "-rf --output.pdf",
    "name_shell_characters": "a;b&c$d`e'f(g)%h!.pdf",
    "name_many_dots": "a.b.c.d..pdf",
    "name_long_150": ("uzun-dosya-adı-" * 10)[:146] + ".pdf",
    "name_long_220": ("x" * 216) + ".pdf",
    "name_uppercase_extension": "UPPER.PDF",
    "name_no_extension": "noextension",
}


def build_variants(seed: int = DEFAULT_SEED) -> list[Variant]:
    rng = random.Random(seed)
    raw = raw_base()
    rich = rich_base()
    entries: list[tuple[str, str, bytes]] = []
    for name, data in valid_documents():
        entries.append((name, "valid", data))
    for name, data in truncations("raw", raw, 30) + truncations("rich", rich, 30):
        entries.append((name, "truncated", data))
    flips = byte_flips("raw", raw, rng, {"xref": 20, "trailer": 15, "streams": 20, "anywhere": 15})
    flips += byte_flips(
        "rich", rich, rng, {"xref": 15, "trailer": 15, "streams": 15, "anywhere": 15}
    )
    for name, data in flips:
        entries.append((name, "flipped", data))
    for name, data in structure_documents(raw):
        entries.append((name, "structure", data))
    for name, data in geometry_documents():
        entries.append((name, "geometry", data))
    for name, data in bad_images(rng):
        entries.append((f"image_{name}", "image", data))
    for name, data in encrypted_documents(raw):
        entries.append((name, "encrypted", data))
    for name, data in action_documents():
        entries.append((name, "actions", data))
    for name, data in non_pdf_documents(rng):
        entries.append((name, "not_pdf", data))
    entries.append(("decompression_bomb", "bomb", decompression_bomb()))
    variants = [
        Variant(name, category, f"{name}.pdf", _constant(data)) for name, category, data in entries
    ]
    for name, file_name in NAME_VARIANTS.items():
        variants.append(Variant(name, "names", file_name, _constant(raw)))
    return variants


def _constant(data: bytes) -> Callable[[], bytes]:
    return lambda: data


def write_corpus(directory: Path, seed: int = DEFAULT_SEED, names: set[str] | None = None) -> dict:
    written = {}
    for variant in build_variants(seed):
        if names is not None and variant.name not in names:
            continue
        folder = directory / variant.name
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / variant.file_name
        target.write_bytes(variant.build())
        written[variant.name] = (variant, target)
    return written
