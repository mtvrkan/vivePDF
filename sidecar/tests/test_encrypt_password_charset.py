from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.security import EncryptParams, encrypt, legacy_password_encodable
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.mark.parametrize("algorithm", ["aes128", "rc4"])
@pytest.mark.parametrize("encrypt_metadata", [True, False])
def test_legacy_encryption_refuses_letters_it_cannot_store(
    sample_pdf: Path, tmp_path: Path, algorithm: str, encrypt_metadata: bool
) -> None:
    with pytest.raises(OpError) as caught:
        encrypt(
            EncryptParams(
                path=str(sample_pdf),
                output=str(tmp_path / "out.pdf"),
                user_password="şifreĞİ",
                algorithm=algorithm,
                encrypt_metadata=encrypt_metadata,
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "passwordCharset"}
    assert not (tmp_path / "out.pdf").exists()


@pytest.mark.parametrize("algorithm", ["aes128", "rc4"])
def test_legacy_encryption_keeps_latin_letters(
    sample_pdf: Path, tmp_path: Path, algorithm: str
) -> None:
    target = tmp_path / "out.pdf"
    encrypt(
        EncryptParams(
            path=str(sample_pdf),
            output=str(target),
            user_password="çüö-pass",
            owner_password="sahip",
            algorithm=algorithm,
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert document.needs_pass
        assert document.authenticate("çüö-pass")


@pytest.mark.parametrize("encrypt_metadata", [True, False])
def test_aes256_takes_any_letter(sample_pdf: Path, tmp_path: Path, encrypt_metadata: bool) -> None:
    target = tmp_path / "out.pdf"
    encrypt(
        EncryptParams(
            path=str(sample_pdf),
            output=str(target),
            user_password="çok gizli ğüşİı",
            encrypt_metadata=encrypt_metadata,
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert document.authenticate("çok gizli ğüşİı")


def test_the_encoding_check() -> None:
    assert legacy_password_encodable("abcÇÜÖ")
    assert legacy_password_encodable("ı")
    assert not legacy_password_encodable("ş")
    assert not legacy_password_encodable("İ")
