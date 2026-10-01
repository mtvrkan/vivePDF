from pathlib import Path

import pytest

from vivepdf.ops._watermark_style import WatermarkParams
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.ops.security import EncryptParams, encrypt
from vivepdf.ops.security_watermark import watermark
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def pageless(tmp_path: Path) -> Path:
    path = tmp_path / "kırık.pdf"
    path.write_bytes(
        b"%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )
    return path


def test_a_file_with_no_readable_page_is_invalid_everywhere(pageless: Path, tmp_path: Path) -> None:
    calls = [
        lambda: encrypt(
            EncryptParams(
                path=str(pageless),
                output=str(tmp_path / "e.pdf"),
                user_password="x",
                encrypt_metadata=False,
            ),
            silent_progress(),
        ),
        lambda: sanitize(
            SanitizeParams(path=str(pageless), output=str(tmp_path / "s.pdf")), silent_progress()
        ),
        lambda: watermark(
            WatermarkParams(path=str(pageless), output=str(tmp_path / "w.pdf"), text="X"),
            silent_progress(),
        ),
    ]
    for call in calls:
        with pytest.raises(OpError) as caught:
            call()
        assert caught.value.code == ErrorCode.INVALID_PDF
