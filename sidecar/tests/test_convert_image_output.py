import sys
import threading
import zipfile
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops import _page_images, convert_images
from vivepdf.ops.convert_images import ImagesParams, to_images
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


@pytest.fixture
def colour_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for shade in ((1, 0, 0), (0, 0.6, 0), (0, 0, 1)):
        page = document.new_page(width=200, height=100)
        page.draw_rect(pymupdf.Rect(20, 20, 180, 80), color=shade, fill=shade)
    target = tmp_path / "renkli sayfalar.pdf"
    document.save(target)
    return target


def _cancel_after(renders: int) -> Progress:
    cancel = threading.Event()
    seen: list[str | None] = []

    def sink(_value, message, _detail):
        seen.append(message)
        if seen.count("progress.rendering") >= renders:
            cancel.set()

    return Progress(sink, cancel)


def test_gray_pages_are_single_channel(colour_pdf: Path, tmp_path: Path) -> None:
    result = to_images(
        ImagesParams(path=str(colour_pdf), output_dir=str(tmp_path / "gri"), gray=True),
        silent_progress(),
    )
    assert len(result.outputs) == 3
    for output in result.outputs:
        with Image.open(output) as picture:
            assert picture.mode == "L"


def test_gray_transparent_webp_and_jpg_are_written(colour_pdf: Path, tmp_path: Path) -> None:
    for image_format in ("webp", "jpg"):
        result = to_images(
            ImagesParams(
                path=str(colour_pdf),
                output_dir=str(tmp_path / image_format),
                format=image_format,
                gray=True,
                transparent=True,
                pages="1",
            ),
            silent_progress(),
        )
        with Image.open(result.outputs[0]) as picture:
            picture.load()
            assert picture.width in (416, 417)


def test_single_tiff_holds_one_frame_per_page(colour_pdf: Path, tmp_path: Path) -> None:
    result = to_images(
        ImagesParams(
            path=str(colour_pdf), output_dir=str(tmp_path), format="tiff", single=True, dpi=72
        ),
        silent_progress(),
    )
    assert result.outputs == [str(tmp_path / "renkli sayfalar.tiff")]
    with Image.open(result.outputs[0]) as picture:
        assert picture.n_frames == 3
        assert picture.size == (200, 100)
        assert picture.info.get("compression") == "tiff_lzw"
    assert list(tmp_path.glob(".vivepdf-*")) == []


def test_tiff_pages_are_separate_files_by_default(colour_pdf: Path, tmp_path: Path) -> None:
    result = to_images(
        ImagesParams(path=str(colour_pdf), output_dir=str(tmp_path / "t"), format="tiff"),
        silent_progress(),
    )
    assert [Path(output).name for output in result.outputs] == [
        "renkli sayfalar-1.tiff",
        "renkli sayfalar-2.tiff",
        "renkli sayfalar-3.tiff",
    ]


def test_archive_holds_every_page_and_leaves_nothing_else(colour_pdf: Path, tmp_path: Path) -> None:
    folder = tmp_path / "zip"
    result = to_images(
        ImagesParams(path=str(colour_pdf), output_dir=str(folder), archive=True, format="jpg"),
        silent_progress(),
    )
    assert result.outputs == [str(folder / "renkli sayfalar.zip")]
    assert result.bytes == (folder / "renkli sayfalar.zip").stat().st_size
    assert result.page_count == 3
    with zipfile.ZipFile(result.outputs[0]) as archive:
        assert archive.namelist() == [
            "renkli sayfalar-1.jpg",
            "renkli sayfalar-2.jpg",
            "renkli sayfalar-3.jpg",
        ]
    assert sorted(path.name for path in folder.iterdir()) == ["renkli sayfalar.zip"]
    with pytest.raises(OpError) as caught:
        to_images(
            ImagesParams(path=str(colour_pdf), output_dir=str(folder), archive=True),
            silent_progress(),
        )
    assert caught.value.data == {"exists": True, "path": str(folder / "renkli sayfalar.zip")}


def test_cancelled_archive_leaves_nothing(colour_pdf: Path, tmp_path: Path) -> None:
    folder = tmp_path / "iptal"
    with pytest.raises(OpError) as caught:
        to_images(
            ImagesParams(path=str(colour_pdf), output_dir=str(folder), archive=True),
            _cancel_after(1),
        )
    assert caught.value.code == ErrorCode.CANCELLED
    assert list(folder.iterdir()) == []


def test_render_workers_only_for_long_runs() -> None:
    assert _page_images.render_workers(5, cpus=16) == 1
    assert _page_images.render_workers(40, cpus=16) == _page_images.MAX_WORKERS
    assert _page_images.render_workers(40, cpus=2) == 1
    assert _page_images.render_workers(12, cpus=16) == 3


def test_parallel_rendering_matches_serial_output(
    colour_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    serial = to_images(
        ImagesParams(path=str(colour_pdf), output_dir=str(tmp_path / "tek")), silent_progress()
    )
    monkeypatch.setattr(convert_images, "render_workers", lambda pages: 2)
    parallel = to_images(
        ImagesParams(path=str(colour_pdf), output_dir=str(tmp_path / "çok")), silent_progress()
    )
    assert [Path(path).name for path in parallel.outputs] == [
        Path(path).name for path in serial.outputs
    ]
    for left, right in zip(serial.outputs, parallel.outputs, strict=True):
        assert Path(left).read_bytes() == Path(right).read_bytes()
    assert list((tmp_path / "çok").glob(".vivepdf-*")) == []


def test_parallel_rendering_cleans_up_on_cancel(
    colour_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(convert_images, "render_workers", lambda pages: 2)
    folder = tmp_path / "paralel iptal"
    with pytest.raises(OpError) as caught:
        to_images(ImagesParams(path=str(colour_pdf), output_dir=str(folder)), _cancel_after(1))
    assert caught.value.code == ErrorCode.CANCELLED
    assert list(folder.iterdir()) == []


def test_parallel_rendering_opens_protected_files(tmp_path: Path) -> None:
    document = pymupdf.open()
    for _ in range(3):
        document.new_page(width=100, height=100).insert_text((10, 50), "gizli")
    source = tmp_path / "kilitli.pdf"
    document.save(source, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="açık", owner_pw="sahip")
    settings = _page_images.RenderSettings("png", 72, 88, False, False)
    with pymupdf.open(source) as opened:
        opened.authenticate("açık")
        jobs = [(index, tmp_path / f"{index}.png") for index in range(3)]
        results = list(
            _page_images.rendered_in_order(
                _page_images.RenderSource(opened, str(source), "açık"),
                jobs,
                settings,
                lambda: None,
                2,
            )
        )
    assert [index for index, _reduced in results] == [0, 1, 2]
    assert all(target.stat().st_size > 0 for _index, target in jobs)


def test_parallel_worker_that_cannot_open_the_file_fails_instead_of_hanging(
    tmp_path: Path,
) -> None:
    document = pymupdf.open()
    for _ in range(2):
        document.new_page(width=100, height=100)
    source = tmp_path / "yanlış.pdf"
    document.save(source, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="doğru", owner_pw="x")
    settings = _page_images.RenderSettings("png", 72, 88, False, False)
    with pymupdf.open(source) as opened, pytest.raises(RuntimeError, match="unlock"):
        opened.authenticate("doğru")
        list(
            _page_images.rendered_in_order(
                _page_images.RenderSource(opened, str(source), "yanlış"),
                [(0, tmp_path / "0.png"), (1, tmp_path / "1.png")],
                settings,
                lambda: None,
                2,
            )
        )


def test_rendering_carries_on_in_process_when_workers_die(
    colour_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    serial = to_images(
        ImagesParams(path=str(colour_pdf), output_dir=str(tmp_path / "tek")), silent_progress()
    )
    monkeypatch.setattr(convert_images, "render_workers", lambda pages: 2)
    monkeypatch.setattr(_page_images, "_start_worker", sys.exit)
    fallback = to_images(
        ImagesParams(path=str(colour_pdf), output_dir=str(tmp_path / "yedek")), silent_progress()
    )
    for left, right in zip(serial.outputs, fallback.outputs, strict=True):
        assert Path(left).read_bytes() == Path(right).read_bytes()


@pytest.mark.filterwarnings("error::pytest.PytestUnraisableExceptionWarning")
def test_single_tiff_writer_is_closed_once_without_a_late_error(
    colour_pdf: Path, tmp_path: Path
) -> None:
    import gc

    result = to_images(
        ImagesParams(path=str(colour_pdf), output_dir=str(tmp_path), format="tiff", single=True),
        silent_progress(),
    )
    gc.collect()

    with Image.open(result.outputs[0]) as picture:
        assert picture.n_frames == 3


@pytest.mark.filterwarnings("error::pytest.PytestUnraisableExceptionWarning")
def test_single_tiff_failing_mid_page_reports_the_real_error_and_leaves_nothing(
    colour_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import gc

    rendered = convert_images.page_pixmap
    calls: list[int] = []

    def fail_on_second_page(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise OpError(ErrorCode.INTERNAL, "render failed")
        return rendered(*args, **kwargs)

    monkeypatch.setattr(convert_images, "page_pixmap", fail_on_second_page)

    with pytest.raises(OpError, match="render failed"):
        to_images(
            ImagesParams(
                path=str(colour_pdf), output_dir=str(tmp_path), format="tiff", single=True
            ),
            silent_progress(),
        )
    gc.collect()

    assert [path.name for path in tmp_path.iterdir()] == ["renkli sayfalar.pdf"]
