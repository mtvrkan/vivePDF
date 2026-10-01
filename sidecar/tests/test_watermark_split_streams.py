from pathlib import Path

import pymupdf

from vivepdf.ops._content import cut_pieces, join_streams
from vivepdf.ops.watermark_detection import DetectWatermarkParams, detect_watermark
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.progress import silent_progress

HEAD = (
    b"BT /helv 14 Tf 72 720 Td (ilk govde satiri) Tj ET\n"
    b"q /Artifact <</Subtype/Watermark>> BDC\n"
    b"BT 1 0 0 1 180 400 Tm /helv 40 Tf (TASLAK) Tj ET\n"
)
TAIL = (
    b"BT 1 0 0 1 180 360 Tm /helv 40 Tf (GIZLI) Tj ET\nEMC Q\n"
    b"BT /helv 14 Tf 72 300 Td (son govde satiri) Tj ET\n"
)


def _stream(document: pymupdf.Document, data: bytes) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, "<<>>")
    document.update_stream(xref, data)
    return xref


def _split_document(path: Path) -> None:
    document = pymupdf.open()
    first = document.new_page(width=595, height=842)
    first.insert_text((72, 100), "ust bilgi", fontsize=10)
    head = _stream(document, HEAD)
    tail = _stream(document, TAIL)
    own = first.get_contents()[0]
    document.xref_set_key(first.xref, "Contents", f"[{own} 0 R {head} 0 R {tail} 0 R]")
    second = document.new_page(width=595, height=842)
    second.insert_text((72, 100), "ikinci sayfa metni", fontsize=12)
    document.save(path)
    document.close()


def test_cut_pieces_cuts_a_span_that_crosses_a_stream_boundary() -> None:
    pieces = [b"aa X1", b"X2 bb", b"cc"]
    data = join_streams(pieces)
    start = data.index(b"X1")
    end = data.index(b"X2") + 2
    assert cut_pieces(pieces, [(start, end)]) == [b"aa ", b" bb", b"cc"]


def test_a_mark_split_across_two_content_streams_is_cut_out(tmp_path: Path) -> None:
    source = tmp_path / "bolunmus.pdf"
    _split_document(source)
    found = detect_watermark(DetectWatermarkParams(path=str(source)), silent_progress())
    assert any(candidate.kind == "artifact" for candidate in found.candidates)
    with pymupdf.open(source) as original:
        second_before = original[1].read_contents()
        second_count = len(original[1].get_contents())
    target = tmp_path / "temiz.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(target),
            artifacts=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_marks == 1
    with pymupdf.open(target) as cleaned:
        first = cleaned[0]
        text = first.get_text()
        assert "TASLAK" not in text and "GIZLI" not in text
        assert "ilk govde satiri" in text and "son govde satiri" in text
        assert "ust bilgi" in text
        assert len(first.get_contents()) == 3
        joined = first.read_contents()
        assert joined.count(b"q") == joined.count(b"Q")
        assert len(cleaned[1].get_contents()) == second_count
        assert cleaned[1].read_contents() == second_before
