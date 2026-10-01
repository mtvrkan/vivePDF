import threading
from pathlib import Path

import pikepdf
import pymupdf
import pytest

from vivepdf.ops import compress as compress_module
from vivepdf.ops.compress import CompressParams, Shrunk, compress
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


def _picture(seed: int) -> pymupdf.Pixmap:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 600, 400), False)
    for band in range(8):
        pixmap.set_rect(
            pymupdf.IRect(band * 75, 0, band * 75 + 75, 400),
            ((seed * 37 + band * 29) % 256, (band * 53) % 256, (seed * 11) % 256),
        )
    return pixmap


@pytest.fixture
def pictured(tmp_path: Path) -> Path:
    document = pymupdf.open()
    shared = _picture(99)
    for number in range(20):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 60), f"Page {number + 1}")
        page.insert_image(pymupdf.Rect(40, 80, 200, 187), pixmap=_picture(number))
        page.insert_image(pymupdf.Rect(300, 80, 460, 187), pixmap=shared)
    path = tmp_path / "pictured.pdf"
    document.save(path)
    document.close()
    return path


def _recording(cancel_on: str | None = None) -> tuple[Progress, list[tuple[float, str | None]]]:
    events: list[tuple[float, str | None]] = []
    cancel = threading.Event()

    def sink(value, message, _detail):
        events.append((value, message))
        if cancel_on is not None and message == cancel_on:
            cancel.set()

    return Progress(sink, cancel), events


def _page_texts(path: str) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text().strip() for page in document]


def test_images_are_rewritten_in_page_batches_with_progress(pictured: Path, tmp_path: Path) -> None:
    progress, events = _recording()
    batched = compress(
        CompressParams(path=str(pictured), output=str(tmp_path / "batched.pdf"), profile="extreme"),
        progress,
    )
    batch_messages = [
        message for _value, message in events if message == "progress.rewritingImagesPages"
    ]
    assert len(batch_messages) == 3
    values = [value for value, _message in events]
    assert values == sorted(values)
    assert _page_texts(batched.output) == [f"Page {number}" for number in range(1, 21)]
    assert batched.bytes_after < batched.bytes_before


def test_batched_rewrite_matches_a_single_pass(
    pictured: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    batched = compress(
        CompressParams(path=str(pictured), output=str(tmp_path / "batched.pdf"), profile="strong"),
        silent_progress(),
    )
    monkeypatch.setattr(compress_module, "IMAGE_BATCH_PAGES", 1000)
    single = compress(
        CompressParams(path=str(pictured), output=str(tmp_path / "single.pdf"), profile="strong"),
        silent_progress(),
    )
    assert batched.bytes_after <= single.bytes_after * 1.02
    with pymupdf.open(batched.output) as document:
        assert document.page_count == 20
        catalog = document.pdf_catalog()
        pages = document.xref_get_key(catalog, "Pages")
        assert document.xref_get_key(int(pages[1].split()[0]), "Count")[1] == "20"


def test_cancel_takes_effect_inside_the_image_rewrite(pictured: Path, tmp_path: Path) -> None:
    progress, events = _recording(cancel_on="progress.rewritingImagesPages")
    target = tmp_path / "cancelled.pdf"
    with pytest.raises(OpError) as caught:
        compress(
            CompressParams(path=str(pictured), output=str(target), profile="extreme"), progress
        )
    assert caught.value.code == ErrorCode.CANCELLED
    assert [message for _v, message in events].count("progress.rewritingImagesPages") == 1
    assert not target.exists()


def test_fast_web_view_writes_a_linearized_file(pictured: Path, tmp_path: Path) -> None:
    result = compress(
        CompressParams(
            path=str(pictured),
            output=str(tmp_path / "web.pdf"),
            profile="balanced",
            linearize=True,
        ),
        silent_progress(),
    )
    assert result.linearized
    with pikepdf.open(result.output) as pdf:
        assert pdf.is_linearized
        assert pdf.check_linearization()
    assert result.bytes_after == Path(result.output).stat().st_size
    assert _page_texts(result.output)[19] == "Page 20"


def test_fast_web_view_keeps_the_password_and_permissions(sample_pdf: Path, tmp_path: Path) -> None:
    protected = tmp_path / "şifreli belge.pdf"
    with pymupdf.open(sample_pdf) as document:
        document.save(
            protected,
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw="kullanıcı",
            owner_pw="sahip",
            permissions=pymupdf.PDF_PERM_PRINT,
        )
    result = compress(
        CompressParams(
            path=str(protected),
            password="kullanıcı",
            output=str(tmp_path / "web.pdf"),
            profile="light",
            linearize=True,
        ),
        silent_progress(),
    )
    with pikepdf.open(result.output, password="kullanıcı") as pdf:
        assert pdf.is_linearized
        assert pdf.is_encrypted
        assert pdf.encryption.R == 6
        assert not pdf.allow.modify_other
    with pymupdf.open(result.output) as document:
        assert document.needs_pass
        assert document.authenticate("sahip") == 4
        assert document[0].get_text().strip() == "Page 1"


def test_fast_web_view_also_applies_to_a_kept_original(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bloated = Shrunk(b"%PDF-1.7\n" + b"0" * (sample_pdf.stat().st_size * 2), 0, 0)
    monkeypatch.setattr(compress_module, "_shrink", lambda *args, **kwargs: bloated)
    result = compress(
        CompressParams(
            path=str(sample_pdf), output=str(tmp_path / "web.pdf"), profile="light", linearize=True
        ),
        silent_progress(),
    )
    assert result.kept_original
    assert result.linearized
    with pikepdf.open(result.output) as pdf:
        assert pdf.is_linearized


def test_fast_web_view_is_refused_when_protection_cannot_be_kept(
    encrypted_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_args, **_kwargs):
        raise pikepdf.PasswordError("unsupported security handler")

    monkeypatch.setattr(pikepdf, "open", refuse)
    target = tmp_path / "web.pdf"
    with pytest.raises(OpError) as caught:
        compress(
            CompressParams(
                path=str(encrypted_pdf),
                password="secret",
                output=str(target),
                profile="light",
                linearize=True,
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.UNSUPPORTED
    assert caught.value.data == {"reason": "linearizeEncrypted"}
    assert not target.exists()


def test_discard_extras_keeps_the_original_when_nothing_was_removed(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bloated = Shrunk(b"%PDF-1.7\n" + b"0" * (sample_pdf.stat().st_size * 2), 0, 0)
    monkeypatch.setattr(compress_module, "_shrink", lambda *args, **kwargs: bloated)
    result = compress(
        CompressParams(
            path=str(sample_pdf),
            output=str(tmp_path / "out.pdf"),
            profile="light",
            discard_extras=True,
        ),
        silent_progress(),
    )
    assert result.kept_original
    assert not result.grew
    assert Path(result.output).read_bytes() == sample_pdf.read_bytes()


def test_discard_extras_falls_back_to_removing_only_the_extras(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pymupdf.open(sample_pdf) as document:
        thumb = document.get_new_xref()
        document.update_object(thumb, "<< /Width 8 /Height 8 >>")
        document.update_stream(thumb, bytes(range(256)) * 40)
        document.xref_set_key(document[0].xref, "Thumb", f"{thumb} 0 R")
        extras = tmp_path / "extras.pdf"
        document.save(extras)
    bloated = Shrunk(b"%PDF-1.7\n" + b"0" * (extras.stat().st_size * 2), 0, 1)
    monkeypatch.setattr(compress_module, "_shrink", lambda *args, **kwargs: bloated)
    result = compress(
        CompressParams(
            path=str(extras),
            output=str(tmp_path / "out.pdf"),
            profile="light",
            discard_extras=True,
        ),
        silent_progress(),
    )
    assert result.privacy_only
    assert result.profile_used == "privacyOnly"
    assert result.extras_removed == 1
    assert result.bytes_after < len(bloated.data)
    assert result.grew == (result.bytes_after > result.bytes_before)
    with pymupdf.open(result.output) as document:
        assert document.xref_get_key(document[0].xref, "Thumb")[0] == "null"
        assert document[0].get_text().strip() == "Page 1"


def test_a_growing_grayscale_result_is_flagged(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bloated = Shrunk(b"%PDF-1.7\n" + b"0" * (sample_pdf.stat().st_size * 2), 0, 0)
    monkeypatch.setattr(compress_module, "_shrink", lambda *args, **kwargs: bloated)
    result = compress(
        CompressParams(
            path=str(sample_pdf), output=str(tmp_path / "out.pdf"), profile="light", grayscale=True
        ),
        silent_progress(),
    )
    assert result.grew
    assert not result.privacy_only
