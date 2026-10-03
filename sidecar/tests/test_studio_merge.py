from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._studio_models import StudioRenderParams
from vivepdf.ops.sign_certificate import CreateCertificateParams, create_certificate
from vivepdf.ops.sign_verify import VerifyParams, verify
from vivepdf.ops.studio import render
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

PASSWORD = "pw-12345"


@pytest.fixture(scope="module")
def certificate(tmp_path_factory: pytest.TempPathFactory) -> Path:
    folder = tmp_path_factory.mktemp("cert")
    result = create_certificate(
        CreateCertificateParams(
            output=str(folder / "signer.p12"),
            password=PASSWORD,
            common_name="Studio Signer",
            key_type="ec",
        ),
        silent_progress(),
    )
    return Path(result.output)


@pytest.fixture
def table(tmp_path: Path) -> Path:
    path = tmp_path / "people.csv"
    path.write_text("Name,Course\nAyşe Yılmaz,Design\nCan Demir,Print\nAyşe Yılmaz,Web\n", "utf-8")
    return path


def _params(**extra) -> StudioRenderParams:
    page = {
        "width": 300,
        "height": 200,
        "items": [
            {
                "kind": "text",
                "x": 10,
                "y": 10,
                "width": 280,
                "height": 60,
                "runs": [{"text": "{Name} · {Course} · #{n}"}],
                "fontSize": 14,
            }
        ],
    }
    payload = {"pages": [page], "overwrite": True}
    payload.update(extra)
    return StudioRenderParams.model_validate(payload)


def _text(path: str | Path, page: int = 0) -> str:
    with pymupdf.open(path) as document:
        return document[page].get_text().strip()


def test_a_table_fills_one_page_set_per_row_in_one_pdf(tmp_path: Path, table: Path):
    output = tmp_path / "all.pdf"

    result = render(_params(dataPath=str(table), output=str(output)), silent_progress())

    assert result.page_count == 3
    assert [_text(output, index) for index in range(3)] == [
        "Ayşe Yılmaz · Design · #1",
        "Can Demir · Print · #2",
        "Ayşe Yılmaz · Web · #3",
    ]


def test_one_file_per_row_is_named_by_the_pattern_and_kept_unique(tmp_path: Path, table: Path):
    folder = tmp_path / "out"

    result = render(
        _params(dataPath=str(table), split=True, outputDir=str(folder), pattern="{Name}"),
        silent_progress(),
    )

    names = [Path(path).name for path in result.outputs]
    assert names == ["Ayşe Yılmaz.pdf", "Can Demir.pdf", "Ayşe Yılmaz-2.pdf"]
    assert _text(folder / "Can Demir.pdf") == "Can Demir · Print · #2"
    assert result.page_count == 3


def test_one_file_per_row_refuses_to_replace_files_unless_asked(tmp_path: Path, table: Path):
    folder = tmp_path / "out"
    folder.mkdir()
    (folder / "2.pdf").write_bytes(b"%PDF-1.7\n")

    with pytest.raises(OpError) as caught:
        render(
            _params(dataPath=str(table), split=True, outputDir=str(folder), overwrite=False),
            silent_progress(),
        )

    assert caught.value.data["exists"] is True
    assert not (folder / "1.pdf").exists()


def test_one_file_per_row_needs_pdf_and_a_folder(tmp_path: Path, table: Path):
    with pytest.raises(OpError) as picture:
        render(
            _params(dataPath=str(table), split=True, outputDir=str(tmp_path), format="png"),
            silent_progress(),
        )
    with pytest.raises(OpError) as folder:
        render(_params(dataPath=str(table), split=True), silent_progress())

    assert picture.value.data["reason"] == "splitNeedsPdf"
    assert folder.value.data["reason"] == "noOutputDir"


def test_an_empty_table_is_refused(tmp_path: Path):
    empty = tmp_path / "empty.csv"
    empty.write_text("Name\n", "utf-8")

    with pytest.raises(OpError) as caught:
        render(_params(dataPath=str(empty), output=str(tmp_path / "x.pdf")), silent_progress())

    assert caught.value.data["reason"] == "noRows"


def test_every_row_file_is_signed_with_the_certificate(
    tmp_path: Path, table: Path, certificate: Path
):
    folder = tmp_path / "signed"
    sign = {"certificatePath": str(certificate), "certificatePassword": PASSWORD}

    result = render(
        _params(dataPath=str(table), split=True, outputDir=str(folder), sign=sign),
        silent_progress(),
    )

    assert len(result.outputs) == 3
    for path in result.outputs:
        signatures = verify(VerifyParams(path=path), silent_progress()).signatures
        assert len(signatures) == 1
        assert signatures[0].intact and signatures[0].valid
    assert not list(folder.glob("*.part"))


def test_a_wrong_certificate_password_stops_before_any_file_is_kept(
    tmp_path: Path, table: Path, certificate: Path
):
    output = tmp_path / "all.pdf"
    sign = {"certificatePath": str(certificate), "certificatePassword": "wrong"}

    with pytest.raises(OpError):
        render(_params(dataPath=str(table), output=str(output), sign=sign), silent_progress())

    assert not output.exists()
