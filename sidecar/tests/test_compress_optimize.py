import io
import threading
from pathlib import Path

import pymupdf
import pytest
from fontTools.ttLib import TTFont

from vivepdf.ops import compress as compress_module
from vivepdf.ops.compress import (
    TARGET_ATTEMPTS,
    CompressParams,
    Shrunk,
    compress,
)
from vivepdf.rpc.progress import Progress, silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def lettered(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for number in range(2):
        page = document.new_page(width=595, height=842)
        page.insert_text(
            (72, 120),
            f"Sayfa {number + 1} şğüİıöç gövde metni",
            fontsize=14,
            fontname="dejavu",
            fontfile=FONT,
        )
    path = tmp_path / "lettered.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def coloured(tmp_path: Path) -> Path:
    document = pymupdf.open()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 300, 200), False)
    pixmap.set_rect(pixmap.irect, (220, 40, 40))
    page = document.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(40, 40, 340, 240), pixmap=pixmap)
    path = tmp_path / "coloured.pdf"
    document.save(path)
    document.close()
    return path


def _recording() -> tuple[Progress, list[float]]:
    values: list[float] = []
    return Progress(lambda value, _m, _d: values.append(value), threading.Event()), values


def _font_tables(path: str) -> set[str]:
    with pymupdf.open(path) as document:
        for xref in range(1, document.xref_length()):
            if document.xref_get_key(xref, "Length1")[0] != "null":
                return set(TTFont(io.BytesIO(document.xref_stream(xref))).keys())
    return set()


def test_output_is_never_bigger_than_the_input(
    lettered: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bloated = Shrunk(b"%PDF-1.7\n" + b"0" * (lettered.stat().st_size * 2), 0, 0)
    monkeypatch.setattr(compress_module, "_shrink", lambda *args, **kwargs: bloated)
    result = compress(
        CompressParams(path=str(lettered), output=str(tmp_path / "out.pdf"), profile="balanced"),
        silent_progress(),
    )
    assert result.kept_original
    assert result.profile_used == "original"
    assert result.bytes_after == result.bytes_before
    assert Path(result.output).read_bytes() == lettered.read_bytes()


def test_a_requested_change_is_written_even_if_bigger(
    lettered: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bloated = Shrunk(b"%PDF-1.7\n" + b"0" * (lettered.stat().st_size * 2), 0, 0)
    monkeypatch.setattr(compress_module, "_shrink", lambda *args, **kwargs: bloated)
    result = compress(
        CompressParams(
            path=str(lettered), output=str(tmp_path / "out.pdf"), profile="light", grayscale=True
        ),
        silent_progress(),
    )
    assert not result.kept_original
    assert result.bytes_after > result.bytes_before


def test_target_mode_keeps_the_original_when_nothing_helps(
    lettered: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bloated = Shrunk(b"%PDF-1.7\n" + b"0" * (lettered.stat().st_size * 2), 0, 0)
    monkeypatch.setattr(compress_module, "_shrink", lambda *args, **kwargs: bloated)
    result = compress(
        CompressParams(
            path=str(lettered), output=str(tmp_path / "out.pdf"), target_bytes=10_000_000
        ),
        silent_progress(),
    )
    assert result.kept_original
    assert result.target_met is True


def test_grayscale_applies_to_the_light_profile(coloured: Path, tmp_path: Path) -> None:
    result = compress(
        CompressParams(
            path=str(coloured), output=str(tmp_path / "gray.pdf"), profile="light", grayscale=True
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        xref = document[0].get_images()[0][0]
        assert document.extract_image(xref)["colorspace"] == 1


def test_fonts_lose_tables_a_pdf_reader_never_uses(lettered: Path, tmp_path: Path) -> None:
    assert {"GSUB", "GPOS"} & _font_tables(str(lettered))
    result = compress(
        CompressParams(path=str(lettered), output=str(tmp_path / "slim.pdf"), profile="light"),
        silent_progress(),
    )
    assert result.font_bytes_saved >= 0
    tables = _font_tables(result.output)
    assert not {"GSUB", "GPOS", "GDEF"} & tables
    assert {"glyf", "hmtx"} <= tables
    with pymupdf.open(lettered) as before, pymupdf.open(result.output) as after:
        assert after[0].get_text() == before[0].get_text()
        assert "şğüİıöç" in after[0].get_text()
        assert after[0].get_pixmap(dpi=72).samples == before[0].get_pixmap(dpi=72).samples


def test_discard_extras_drops_thumbnails_and_private_data(lettered: Path, tmp_path: Path) -> None:
    with pymupdf.open(lettered) as document:
        blob = document.get_new_xref()
        document.update_object(blob, "<<>>")
        document.update_stream(blob, b"private application data " * 4000)
        thumb = document.get_new_xref()
        document.update_object(thumb, "<< /Width 8 /Height 8 >>")
        document.update_stream(thumb, bytes(range(256)) * 200)
        page_xref = document[0].xref
        document.xref_set_key(
            page_xref, "PieceInfo", f"<< /Illustrator << /Private {blob} 0 R >> >>"
        )
        document.xref_set_key(page_xref, "Thumb", f"{thumb} 0 R")
        extras = tmp_path / "extras.pdf"
        document.save(extras)
    kept = compress(
        CompressParams(path=str(extras), output=str(tmp_path / "kept.pdf"), profile="light"),
        silent_progress(),
    )
    dropped = compress(
        CompressParams(
            path=str(extras),
            output=str(tmp_path / "dropped.pdf"),
            profile="light",
            discard_extras=True,
        ),
        silent_progress(),
    )
    assert dropped.extras_removed == 2
    assert dropped.bytes_after < kept.bytes_after
    with pymupdf.open(dropped.output) as document:
        page_xref = document[0].xref
        assert document.xref_get_key(page_xref, "PieceInfo")[0] == "null"
        assert document.xref_get_key(page_xref, "Thumb")[0] == "null"
        assert "Sayfa 1" in document[0].get_text()


def test_target_progress_only_moves_forward(lettered: Path, tmp_path: Path) -> None:
    progress, values = _recording()
    result = compress(
        CompressParams(path=str(lettered), output=str(tmp_path / "t.pdf"), target_bytes=10_000),
        progress,
    )
    assert values == sorted(values)
    assert all(0 <= value <= 1 for value in values)
    assert result.target_bytes == 10_000


def test_target_search_tries_at_most_a_few_rungs(
    lettered: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[int] = []
    original = compress_module._attempt

    def counting(params, rung, progress, attempt):
        calls.append(rung)
        return original(params, rung, progress, attempt)

    monkeypatch.setattr(compress_module, "_attempt", counting)
    compress(
        CompressParams(path=str(lettered), output=str(tmp_path / "t.pdf"), target_bytes=10_000),
        silent_progress(),
    )
    assert 1 <= len(calls) <= TARGET_ATTEMPTS


def test_a_file_already_under_the_target_only_gets_the_lossless_pass(
    lettered: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[int] = []
    original = compress_module._attempt

    def counting(params, rung, progress, attempt):
        calls.append(rung)
        return original(params, rung, progress, attempt)

    monkeypatch.setattr(compress_module, "_attempt", counting)
    result = compress(
        CompressParams(
            path=str(lettered), output=str(tmp_path / "out.pdf"), target_bytes=10_000_000
        ),
        silent_progress(),
    )
    assert calls == [0]
    assert result.profile_used in ("light", "original")
    assert result.target_met is True


def test_privacy_options_still_run_when_the_file_is_under_the_target(
    lettered: Path, tmp_path: Path
) -> None:
    result = compress(
        CompressParams(
            path=str(lettered),
            output=str(tmp_path / "out.pdf"),
            target_bytes=10_000_000,
            strip_metadata=True,
        ),
        silent_progress(),
    )
    assert not result.kept_original


def test_a_compressed_file_replaces_an_earlier_output_in_one_step(
    lettered: Path, tmp_path: Path
) -> None:
    target = tmp_path / "out.pdf"
    target.write_bytes(b"earlier")
    compress(
        CompressParams(path=str(lettered), output=str(target), overwrite=True, profile="light"),
        silent_progress(),
    )
    assert target.read_bytes().startswith(b"%PDF")
    assert not any(path.suffix == ".part" for path in tmp_path.iterdir())
