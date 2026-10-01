from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import stamp as stamp_module
from vivepdf.ops.stamp import StampParams, render_stamp_text, stamp
from vivepdf.rpc.progress import silent_progress


def test_user_is_the_login_name(monkeypatch: pytest.MonkeyPatch, sample_pdf: Path) -> None:
    monkeypatch.setattr(stamp_module.getpass, "getuser", lambda: "ayse.yilmaz")
    assert render_stamp_text("{user} {name}", 1, 1, "Ayşe", str(sample_pdf), "%Y") == (
        "ayse.yilmaz Ayşe"
    )


def test_a_missing_login_leaves_the_placeholder_empty(
    monkeypatch: pytest.MonkeyPatch, sample_pdf: Path
) -> None:
    def refuse() -> str:
        raise OSError("no login")

    monkeypatch.setattr(stamp_module.getpass, "getuser", refuse)
    assert render_stamp_text("ONAY {user}", 1, 1, "", str(sample_pdf), "%Y") == "ONAY "


def test_the_login_name_is_stamped(
    monkeypatch: pytest.MonkeyPatch, sample_pdf: Path, tmp_path: Path
) -> None:
    monkeypatch.setattr(stamp_module.getpass, "getuser", lambda: "mehmet")
    result = stamp(
        StampParams(path=str(sample_pdf), output=str(tmp_path / "out.pdf"), text="OK {user}"),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert "OK mehmet" in document[0].get_text()


def test_fonts_are_subset_with_fonttools_not_the_lossy_builtin(
    monkeypatch: pytest.MonkeyPatch, sample_pdf: Path, tmp_path: Path
) -> None:
    from vivepdf.ops._watermark_style import WatermarkParams
    from vivepdf.ops.security_watermark import watermark

    calls: list[dict] = []
    original = pymupdf.Document.subset_fonts

    def spy(self: pymupdf.Document, *args: object, **kwargs: object) -> object:
        calls.append(kwargs)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(pymupdf.Document, "subset_fonts", spy)
    stamp(
        StampParams(path=str(sample_pdf), output=str(tmp_path / "s.pdf"), text="ONAY"),
        silent_progress(),
    )
    watermark(
        WatermarkParams(path=str(sample_pdf), output=str(tmp_path / "w.pdf"), text="TASLAK"),
        silent_progress(),
    )
    assert len(calls) == 2
    assert all(call.get("fallback") is False for call in calls)
