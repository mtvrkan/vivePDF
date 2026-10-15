import base64
import threading
import zipfile
from pathlib import Path

import pytest

from vivepdf.ops import support
from vivepdf.ops.support import SupportBundleParams, safe_name, support_bundle
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _bundle(tmp_path: Path, **fields: object) -> Path:
    params = SupportBundleParams.model_validate({"output": str(tmp_path / "support.zip"), **fields})
    result = support_bundle(params, silent_progress())
    assert result.output == str(tmp_path / "support.zip")
    return Path(result.output)


def test_writes_report_logs_pictures_and_files_into_their_folders(tmp_path: Path) -> None:
    attachment = tmp_path / "sample.pdf"
    attachment.write_bytes(b"%PDF-1.7 test")

    output = _bundle(
        tmp_path,
        texts=[
            {"name": "report.txt", "text": "Merhaba — مرحبا"},
            {"name": "diagnostics.txt", "text": "os: windows"},
            {"name": "vivepdf.log", "text": "line", "folder": "logs"},
        ],
        images=[
            {"name": "screenshot.png", "base64": _b64(PNG)},
            {"name": "photo", "base64": _b64(JPEG)},
        ],
        attachments=[str(attachment)],
    )

    with zipfile.ZipFile(output) as archive:
        assert sorted(archive.namelist()) == [
            "attachments/photo.jpg",
            "attachments/sample.pdf",
            "attachments/screenshot.png",
            "diagnostics.txt",
            "logs/vivepdf.log",
            "report.txt",
        ]
        assert archive.read("report.txt").decode("utf-8") == "Merhaba — مرحبا"
        assert archive.read("attachments/sample.pdf") == b"%PDF-1.7 test"
        assert archive.read("attachments/screenshot.png") == PNG


def test_flattens_unsafe_names_and_numbers_repeats(tmp_path: Path) -> None:
    first = tmp_path / "a" / "same.txt"
    second = tmp_path / "b" / "same.txt"
    for path in (first, second):
        path.parent.mkdir()
        path.write_text("x", encoding="utf-8")

    output = _bundle(
        tmp_path,
        texts=[{"name": "../../evil.txt", "text": "x"}, {"name": "..\\..\\evil.txt", "text": "y"}],
        attachments=[str(first), str(second)],
    )

    with zipfile.ZipFile(output) as archive:
        names = sorted(archive.namelist())
    assert names == ["attachments/same (2).txt", "attachments/same.txt", "evil (2).txt", "evil.txt"]
    assert all(".." not in name for name in names)


def test_safe_name_keeps_a_usable_short_name() -> None:
    assert safe_name("C:\\Users\\me\\re:port?.txt") == "re_port_.txt"
    assert safe_name("...") == "file"
    long = safe_name("a" * 300 + ".png")
    assert len(long) == 100
    assert long.endswith(".png")


def test_refuses_a_picture_that_is_not_png_or_jpeg(tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        _bundle(tmp_path, images=[{"name": "x.png", "base64": _b64(b"GIF89a....")}])

    assert raised.value.code == ErrorCode.INVALID_PARAMS
    assert raised.value.data == {"reason": "badImage", "name": "x.png"}
    assert not (tmp_path / "support.zip").exists()


def test_refuses_broken_base64(tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        _bundle(tmp_path, images=[{"name": "x.png", "base64": "not base64!"}])

    assert raised.value.data and raised.value.data["reason"] == "badImage"


def test_refuses_files_over_the_size_limits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(support, "MAX_ATTACHMENT_BYTES", 10)
    monkeypatch.setattr(support, "MAX_ATTACHMENTS_BYTES", 15)
    big = tmp_path / "big.bin"
    big.write_bytes(b"x" * 11)
    small = [tmp_path / f"s{index}.bin" for index in range(2)]
    for path in small:
        path.write_bytes(b"x" * 8)

    with pytest.raises(OpError) as single:
        _bundle(tmp_path, attachments=[str(big)])
    with pytest.raises(OpError) as total:
        _bundle(tmp_path, attachments=[str(path) for path in small])

    assert single.value.data == {"reason": "tooLarge", "limitMb": 0, "name": "big.bin"}
    assert total.value.data and total.value.data["reason"] == "tooLarge"


def test_refuses_pictures_over_their_total(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(support, "MAX_IMAGES_BYTES", len(PNG) + 1)

    with pytest.raises(OpError) as raised:
        _bundle(
            tmp_path,
            images=[{"name": "a.png", "base64": _b64(PNG)}, {"name": "b.png", "base64": _b64(PNG)}],
        )

    assert raised.value.data and raised.value.data["reason"] == "tooLarge"


def test_never_writes_over_an_attachment_or_an_existing_file(tmp_path: Path) -> None:
    existing = tmp_path / "support.zip"
    existing.write_bytes(b"keep")

    with pytest.raises(OpError) as same:
        _bundle(tmp_path, attachments=[str(existing)], overwrite=True)
    with pytest.raises(OpError) as exists:
        _bundle(tmp_path, texts=[{"name": "report.txt", "text": "x"}])

    assert same.value.data == {"reason": "sameAsInput"}
    assert exists.value.data and exists.value.data["exists"] is True
    assert existing.read_bytes() == b"keep"


def test_missing_attachment_is_reported(tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        _bundle(tmp_path, attachments=[str(tmp_path / "gone.pdf")])

    assert raised.value.code == ErrorCode.FILE_NOT_FOUND


def test_cancelling_leaves_no_file(tmp_path: Path) -> None:
    attachment = tmp_path / "sample.pdf"
    attachment.write_bytes(b"data")
    cancel = threading.Event()
    cancel.set()
    params = SupportBundleParams.model_validate(
        {"output": str(tmp_path / "support.zip"), "attachments": [str(attachment)]}
    )

    with pytest.raises(OpError) as raised:
        support_bundle(params, Progress(lambda *_: None, cancel))

    assert raised.value.code == ErrorCode.CANCELLED
    assert list(tmp_path.iterdir()) == [attachment]
