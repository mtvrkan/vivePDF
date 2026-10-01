from pathlib import Path

import pytest

from vivepdf.ops.codes import CodesReadParams, QrAddParams, add_qr, read_codes
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def test_add_qr_then_read_back(sample_pdf: Path, tmp_path: Path) -> None:
    result = add_qr(
        QrAddParams(
            path=str(sample_pdf),
            output=str(tmp_path / "qr.pdf"),
            text="DOC-{n}/{total} {file}",
            size=90,
            position="bottom-right",
        ),
        silent_progress(),
    )
    assert result.stamped == 3
    found = read_codes(CodesReadParams(path=result.output), silent_progress())
    assert found.pages_scanned == 3
    assert [code.text for code in found.codes] == [
        "DOC-1/3 sample",
        "DOC-2/3 sample",
        "DOC-3/3 sample",
    ]
    assert all(code.format == "QRCode" for code in found.codes)
    first = found.codes[0]
    assert first.page == 1
    assert first.x0 > 595 / 2 and first.y0 > 842 / 2


def test_read_codes_on_plain_pages_is_empty(sample_pdf: Path) -> None:
    found = read_codes(CodesReadParams(path=str(sample_pdf), pages="1"), silent_progress())
    assert found.codes == []
    assert found.pages_scanned == 1


def test_add_qr_rejects_same_output(sample_pdf: Path) -> None:
    with pytest.raises(OpError) as error:
        add_qr(
            QrAddParams(path=str(sample_pdf), output=str(sample_pdf), text="x"), silent_progress()
        )
    assert error.value.code == ErrorCode.INVALID_PARAMS
