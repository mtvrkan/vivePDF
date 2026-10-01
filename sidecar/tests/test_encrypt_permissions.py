import io
import unicodedata
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import security
from vivepdf.ops._document import open_document
from vivepdf.ops._protection import protection_of
from vivepdf.ops.security import EncryptParams, Permissions, encrypt
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

NO_PRINT = Permissions(print=False, print_high_quality=False)


def _encrypt(sample_pdf: Path, tmp_path: Path, **fields) -> security.EncryptResult:
    return encrypt(
        EncryptParams(path=str(sample_pdf), output=str(tmp_path / "locked.pdf"), **fields),
        silent_progress(),
    )


def test_a_blank_owner_password_is_generated_and_keeps_the_limits(
    sample_pdf: Path, tmp_path: Path
) -> None:
    result = _encrypt(sample_pdf, tmp_path, user_password="open-me", permissions=NO_PRINT)
    assert len(result.generated_owner_password) >= 24
    with pymupdf.open(result.output) as locked:
        assert locked.authenticate("open-me") == 2
        assert not locked.permissions & pymupdf.PDF_PERM_PRINT
    with pymupdf.open(result.output) as locked:
        assert locked.authenticate(result.generated_owner_password) & 4


def test_a_typed_owner_password_is_not_echoed(sample_pdf: Path, tmp_path: Path) -> None:
    result = _encrypt(sample_pdf, tmp_path, user_password="a", owner_password="b")
    assert result.generated_owner_password == ""


def test_the_same_owner_and_open_password_is_refused_with_limits(
    sample_pdf: Path, tmp_path: Path
) -> None:
    with pytest.raises(OpError) as error:
        _encrypt(
            sample_pdf, tmp_path, user_password="same", owner_password="same", permissions=NO_PRINT
        )
    assert error.value.data["reason"] == "ownerEqualsUser"


def test_a_long_password_is_kept_whole(sample_pdf: Path, tmp_path: Path) -> None:
    password = "correct horse battery staple " * 2
    result = _encrypt(sample_pdf, tmp_path, user_password=password)
    with pymupdf.open(result.output) as locked:
        assert not locked.authenticate(password[:40])
        assert locked.authenticate(password)


@pytest.mark.parametrize(
    ("algorithm", "password", "limit"),
    [("aes256", "ş" * 64, 127), ("aes128", "x" * 33, 32), ("rc4", "y" * 40, 32)],
)
def test_a_password_over_the_byte_limit_is_refused(
    sample_pdf: Path, tmp_path: Path, algorithm: str, password: str, limit: int
) -> None:
    with pytest.raises(OpError) as error:
        _encrypt(sample_pdf, tmp_path, user_password=password, algorithm=algorithm)
    assert error.value.data == {"reason": "passwordTooLong", "maxBytes": limit}


@pytest.mark.parametrize("encrypt_metadata", [True, False])
def test_a_decomposed_password_opens_in_a_conforming_reader(
    sample_pdf: Path, tmp_path: Path, encrypt_metadata: bool
) -> None:
    from pyhanko.pdf_utils.reader import PdfFileReader

    composed = "şifre"
    decomposed = unicodedata.normalize("NFD", composed)
    result = _encrypt(
        sample_pdf, tmp_path, user_password=decomposed, encrypt_metadata=encrypt_metadata
    )
    data = Path(result.output).read_bytes()
    for typed in (composed, decomposed):
        reader = PdfFileReader(io.BytesIO(data), strict=False)
        assert reader.decrypt(typed).status.name != "FAILED"
        with open_document(result.output, typed) as document:
            assert document.page_count == 3


def test_a_prohibited_password_names_its_reason(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as error:
        _encrypt(sample_pdf, tmp_path, user_password="abcاب")
    assert error.value.data == {"reason": "passwordProhibited"}


@pytest.mark.parametrize("encrypt_metadata", [True, False])
def test_no_plain_copy_is_left_when_writing_fails(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, encrypt_metadata: bool
) -> None:
    folder = tmp_path / "out"
    folder.mkdir()
    target = folder / "locked.pdf"
    target.write_bytes(b"earlier file")

    def broken(*_args, **_kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(security, "_standard_handler", broken)
    monkeypatch.setattr(security, "save_document", broken)
    with pytest.raises(RuntimeError):
        encrypt(
            EncryptParams(
                path=str(sample_pdf),
                output=str(target),
                overwrite=True,
                user_password="pw",
                encrypt_metadata=encrypt_metadata,
            ),
            silent_progress(),
        )
    assert [entry.name for entry in folder.iterdir()] == ["locked.pdf"]
    assert target.read_bytes() == b"earlier file"


def test_a_copy_written_without_encrypted_metadata_leaves_no_temporary_file(
    sample_pdf: Path, tmp_path: Path
) -> None:
    folder = tmp_path / "out"
    folder.mkdir()
    encrypt(
        EncryptParams(
            path=str(sample_pdf),
            output=str(folder / "locked.pdf"),
            user_password="pw",
            encrypt_metadata=False,
        ),
        silent_progress(),
    )
    assert [entry.name for entry in folder.iterdir()] == ["locked.pdf"]


def test_other_tools_keep_the_limits_when_only_the_open_password_is_known(
    sample_pdf: Path, tmp_path: Path
) -> None:
    result = _encrypt(
        sample_pdf, tmp_path, user_password="reader", owner_password="author", permissions=NO_PRINT
    )
    with open_document(result.output, "reader") as document:
        protection = protection_of(document, result.output, "reader")
    assert protection is not None
    assert protection.user_password == "reader"
    assert protection.owner_password not in ("reader", "")
    assert not protection.owner_password_known
