from pathlib import Path

import pymupdf

from vivepdf.ops import _document
from vivepdf.ops._document import forget_document, open_document
from vivepdf.ops.privacy import InspectParams
from vivepdf.ops.privacy_sanitize import SanitizeParams
from vivepdf.ops.security import DecryptParams, EncryptParams, EncryptResult
from vivepdf.ops.security_certificate import DecryptCertificateParams, EncryptCertificateParams

SECRET = "Pa55-word-never-shown"


def test_parameter_reprs_never_show_a_password() -> None:
    models = [
        EncryptParams(path="a.pdf", output="b.pdf", user_password=SECRET, owner_password=SECRET),
        DecryptParams(path="a.pdf", output="b.pdf", password=SECRET),
        EncryptCertificateParams(
            path="a.pdf", output="b.pdf", password=SECRET, certificates=["x.cer"]
        ),
        DecryptCertificateParams(
            path="a.pdf", output="b.pdf", certificate_path="k.p12", certificate_password=SECRET
        ),
        InspectParams(path="a.pdf", password=SECRET),
        SanitizeParams(path="a.pdf", output="b.pdf", password=SECRET),
        EncryptResult(output="b.pdf", page_count=1, bytes=1, generated_owner_password=SECRET),
    ]
    for model in models:
        assert SECRET not in repr(model)
        assert SECRET not in str(model)


def test_passwords_still_reach_the_operation() -> None:
    params = EncryptParams(path="a.pdf", output="b.pdf", user_password=SECRET)
    assert params.user_password == SECRET
    assert (
        DecryptParams.model_validate(
            {"path": "a.pdf", "output": "b.pdf", "password": SECRET}
        ).password
        == SECRET
    )


def test_the_document_cache_keeps_no_password_in_its_keys(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "locked")
    source = tmp_path / "locked.pdf"
    document.save(
        source, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=SECRET, owner_pw=SECRET + "x"
    )
    document.close()
    try:
        with open_document(str(source), SECRET, mutable=False) as opened:
            assert opened.page_count == 1
        keys = [key for key in _document._cache if key[0] == str(source.resolve())]
        assert len(keys) == 1
        assert SECRET not in repr(keys)
        with open_document(str(source), SECRET, mutable=False) as again:
            assert again.page_count == 1
        assert len([key for key in _document._cache if key[0] == str(source.resolve())]) == 1
    finally:
        forget_document(str(source))
