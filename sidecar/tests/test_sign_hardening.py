import re
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._sign_params import SignParams
from vivepdf.ops.sign import SignatureFieldsParams, sign, signature_fields
from vivepdf.ops.sign_certificate import CreateCertificateParams, create_certificate
from vivepdf.ops.sign_verify import VerifyParams, verify
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture(scope="module")
def certificate(tmp_path_factory: pytest.TempPathFactory) -> Path:
    folder = tmp_path_factory.mktemp("cert")
    result = create_certificate(
        CreateCertificateParams(
            output=str(folder / "signer.p12"),
            password="pw-12345",
            common_name="Çağrı Şükrü İnönü",
            key_type="ec",
        ),
        silent_progress(),
    )
    return Path(result.output)


@pytest.fixture
def rotated_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for rotation in (0, 90, 180, 270):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"rotation {rotation}")
        page.set_rotation(rotation)
    path = tmp_path / "rotated.pdf"
    document.save(path)
    document.close()
    return path


def _sign(source: Path, output: Path, certificate: Path, **extra) -> Path:
    result = sign(
        SignParams(
            path=str(source),
            output=str(output),
            certificate_path=str(certificate),
            certificate_password="pw-12345",
            **extra,
        ),
        silent_progress(),
    )
    return Path(result.output)


def _signature_widget_rect(path: Path, page_index: int) -> tuple[pymupdf.Rect, str]:
    document = pymupdf.open(path)
    widget = next(iter(document[page_index].widgets()))
    raw = document.xref_get_key(widget.xref, "Rect")[1]
    appearance = int(document.xref_get_key(widget.xref, "AP/N")[1].split()[0])
    matrix = document.xref_get_key(appearance, "Matrix")[1]
    document.close()
    values = [float(value) for value in raw.strip("[]").split()]
    return pymupdf.Rect(values), matrix


@pytest.mark.parametrize(
    ("page", "expected_matrix"),
    [(2, "[0 1 -1 0 0 0]"), (3, "[-1 0 0 -1 0 0]"), (4, "[0 -1 1 0 0 0]")],
)
def test_visible_signature_on_a_rotated_page_stays_on_the_page_and_upright(
    rotated_pdf: Path, certificate: Path, tmp_path: Path, page: int, expected_matrix: str
) -> None:
    signed = _sign(rotated_pdf, tmp_path / "signed.pdf", certificate, page=page)
    rect, matrix = _signature_widget_rect(signed, page - 1)
    assert 0 <= rect.x0 < rect.x1 <= 595
    assert 0 <= rect.y0 < rect.y1 <= 842
    assert re.sub(r"\s+", " ", matrix) == expected_matrix
    document = pymupdf.open(signed)
    display = document[page - 1].rect
    shown = (
        pymupdf.Rect(rect.x0, 842 - rect.y1, rect.x1, 842 - rect.y0)
        * document[page - 1].rotation_matrix
    )
    document.close()
    assert shown.x0 > display.width / 2 and shown.y0 > display.height / 2
    assert verify(VerifyParams(path=str(signed)), silent_progress()).signatures[0].intact


@pytest.mark.parametrize(("user", "owner", "given"), [("u", "o", "u"), ("", "o", None)])
def test_encrypted_documents_can_be_signed(
    rotated_pdf: Path,
    certificate: Path,
    tmp_path: Path,
    user: str,
    owner: str,
    given: str | None,
) -> None:
    source = tmp_path / "locked.pdf"
    document = pymupdf.open(rotated_pdf)
    document.save(source, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=user, owner_pw=owner)
    document.close()
    signed = _sign(source, tmp_path / "signed.pdf", certificate, password=given)
    reopened = pymupdf.open(signed)
    assert b"/Encrypt" in signed.read_bytes()
    reopened.close()
    signatures = verify(VerifyParams(path=str(signed), password=given), silent_progress())
    assert len(signatures.signatures) == 1
    assert signatures.signatures[0].intact and signatures.signatures[0].valid


def test_verify_refuses_a_wrong_password_instead_of_reporting_nothing(
    rotated_pdf: Path, tmp_path: Path
) -> None:
    source = tmp_path / "locked.pdf"
    document = pymupdf.open(rotated_pdf)
    document.save(source, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
    document.close()
    with pytest.raises(OpError) as raised:
        verify(VerifyParams(path=str(source), password="wrong"), silent_progress())
    assert raised.value.code == ErrorCode.NEEDS_PASSWORD
    assert raised.value.data == {"wrongPassword": True}


def test_content_changed_after_signing_is_reported_as_modified(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    signed = _sign(rotated_pdf, tmp_path / "signed.pdf", certificate)
    untouched = verify(VerifyParams(path=str(signed)), silent_progress()).signatures[0]
    assert not untouched.modified
    document = pymupdf.open(signed)
    document[0].insert_text((100, 300), "added later")
    document.saveIncr()
    document.close()
    changed = verify(VerifyParams(path=str(signed)), silent_progress()).signatures[0]
    assert changed.intact
    assert changed.modified


def test_unreachable_timestamp_server_fails_as_a_network_error(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    output = tmp_path / "stamped.pdf"
    with pytest.raises(OpError) as raised:
        _sign(rotated_pdf, output, certificate, timestamp_url="http://127.0.0.1:9/tsr")
    assert raised.value.code == ErrorCode.NETWORK
    assert raised.value.data == {"reason": "timestamp"}
    assert not output.exists()
    with pytest.raises(OpError) as invalid:
        _sign(rotated_pdf, output, certificate, timestamp_url="not a server")
    assert invalid.value.data == {"reason": "timestampUrl"}


def test_blank_stamp_text_falls_back_to_the_default(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    signed = _sign(rotated_pdf, tmp_path / "signed.pdf", certificate, stamp_text="  ", reason="%5")
    assert verify(VerifyParams(path=str(signed)), silent_progress()).signatures[0].valid


def test_stamp_font_widths_are_in_thousandths(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    signed = _sign(rotated_pdf, tmp_path / "signed.pdf", certificate)
    document = pymupdf.open(signed)
    widths = []
    for xref in range(1, document.xref_length()):
        try:
            if document.xref_get_key(xref, "Subtype")[1] == "/CIDFontType2":
                widths = [
                    float(value)
                    for value in re.findall(r"\d+(?:\.\d+)?", document.xref_get_key(xref, "W")[1])
                ]
        except Exception:  # noqa: BLE001
            continue
    document.close()
    assert widths
    assert max(widths) < 1100


def _with_empty_field(source: Path, target: Path) -> Path:
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign.fields import SigFieldSpec, append_signature_field

    with open(source, "rb") as handle:
        writer = IncrementalPdfFileWriter(handle)
        append_signature_field(
            writer, SigFieldSpec(sig_field_name="Approver", on_page=0, box=(300, 100, 500, 160))
        )
        with open(target, "wb") as output:
            writer.write(output)
    return target


def test_certified_document_is_signed_in_its_empty_field_only(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    prepared = _with_empty_field(rotated_pdf, tmp_path / "prepared.pdf")
    certified = _sign(
        prepared, tmp_path / "certified.pdf", certificate, certify=True, visible=False
    )
    info = signature_fields(SignatureFieldsParams(path=str(certified)), silent_progress())
    assert info.certification == "forms"
    assert {(field.name, field.signed) for field in info.fields} >= {("Approver", False)}
    with pytest.raises(OpError) as refused:
        _sign(certified, tmp_path / "new-field.pdf", certificate)
    assert refused.value.code == ErrorCode.PERMISSION_DENIED
    assert refused.value.data["reason"] == "certifiedNeedsField"
    assert refused.value.data["fields"] == ["Approver"]
    approved = _sign(certified, tmp_path / "approved.pdf", certificate, existing_field="Approver")
    statuses = verify(VerifyParams(path=str(approved)), silent_progress()).signatures
    assert len(statuses) == 2
    assert statuses[0].certified and statuses[0].permission == "forms"
    assert not any(status.modified for status in statuses)
    with pytest.raises(OpError) as again:
        _sign(approved, tmp_path / "third.pdf", certificate, certify=True)
    assert again.value.data == {"reason": "certifyNotFirst"}


def test_no_changes_certification_refuses_any_further_signature(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    prepared = _with_empty_field(rotated_pdf, tmp_path / "prepared.pdf")
    certified = _sign(
        prepared, tmp_path / "certified.pdf", certificate, certify=True, certify_permission="none"
    )
    with pytest.raises(OpError) as refused:
        _sign(certified, tmp_path / "second.pdf", certificate, existing_field="Approver")
    assert refused.value.data == {"reason": "certifiedNoChanges"}


def test_lock_after_signing_blocks_later_signatures(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    locked = _sign(rotated_pdf, tmp_path / "locked.pdf", certificate, lock=True)
    assert signature_fields(SignatureFieldsParams(path=str(locked)), silent_progress()).locked
    with pytest.raises(OpError) as refused:
        _sign(locked, tmp_path / "second.pdf", certificate, page=2)
    assert refused.value.data == {"reason": "lockedBySignature"}


def test_unknown_existing_field_is_refused(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    with pytest.raises(OpError) as refused:
        _sign(rotated_pdf, tmp_path / "x.pdf", certificate, existing_field="Missing")
    assert refused.value.data["reason"] == "fieldNotFound"


def test_signature_appearance_can_carry_an_image(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    from PIL import Image, ImageDraw

    picture = Image.new("RGBA", (200, 80), (0, 0, 0, 0))
    ImageDraw.Draw(picture).line([(5, 70), (60, 10), (195, 60)], fill=(10, 10, 90, 255), width=6)
    image_path = tmp_path / "ink.png"
    picture.save(image_path)
    signed = _sign(rotated_pdf, tmp_path / "signed.pdf", certificate, image_path=str(image_path))
    document = pymupdf.open(signed)
    widget = next(iter(document[0].widgets()))
    appearance = int(document.xref_get_key(widget.xref, "AP/N")[1].split()[0])
    resources = document.xref_object(appearance)
    document.close()
    assert "/XObject" in resources or "/Resources" in resources
    with pytest.raises(OpError) as broken:
        _sign(rotated_pdf, tmp_path / "bad.pdf", certificate, image_base64="bm90IGFuIGltYWdl")
    assert broken.value.data == {"reason": "image"}


@pytest.mark.parametrize(
    ("email", "accepted"),
    [("ayse@şirket.com.tr", True), ("ayşe@example.com", False), ("not an address", False)],
)
def test_certificate_email_is_validated(tmp_path: Path, email: str, accepted: bool) -> None:
    params = CreateCertificateParams(
        output=str(tmp_path / "c.p12"),
        password="pw-12345",
        common_name="Ali",
        email=email,
        key_type="ec",
    )
    if accepted:
        assert create_certificate(params, silent_progress()).subject
    else:
        with pytest.raises(OpError) as raised:
            create_certificate(params, silent_progress())
        assert raised.value.data == {"reason": "email"}


def test_certificate_name_cannot_be_blank(tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        create_certificate(
            CreateCertificateParams(
                output=str(tmp_path / "c.p12"), password="pw-12345", common_name="  "
            ),
            silent_progress(),
        )
    assert raised.value.data == {"reason": "commonName"}


def test_certificate_subject_names_the_email_attribute(tmp_path: Path) -> None:
    params = CreateCertificateParams(
        output=str(tmp_path / "c.p12"),
        password="pw-12345",
        common_name="Ali",
        email="ali@example.com",
        key_type="ec",
    )
    subject = create_certificate(params, silent_progress()).subject
    assert "E=ali@example.com" in subject
    assert "1.2.840.113549.1.9.1" not in subject


def test_a_failed_timestamp_leaves_an_existing_output_untouched(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    output = _sign(rotated_pdf, tmp_path / "earlier.pdf", certificate)
    before = output.read_bytes()
    with pytest.raises(OpError) as raised:
        _sign(
            rotated_pdf,
            output,
            certificate,
            overwrite=True,
            timestamp_url="http://127.0.0.1:9/tsr",
        )
    assert raised.value.data == {"reason": "timestamp"}
    assert output.read_bytes() == before
    assert not list(tmp_path.glob(".vivepdf-*.part"))


def test_signing_over_an_existing_output_replaces_it_whole(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    output = tmp_path / "again.pdf"
    output.write_bytes(b"old content that is not a pdf")
    _sign(rotated_pdf, output, certificate, overwrite=True)
    signatures = verify(VerifyParams(path=str(output)), silent_progress()).signatures
    assert len(signatures) == 1
    assert signatures[0].intact


def _damaged_catalog(source: Path, target: Path) -> Path:
    document = pymupdf.open(source)
    document.xref_set_key(document.pdf_catalog(), "Perms", "7")
    document.save(target)
    document.close()
    return target


def test_unreadable_certification_permissions_refuse_signing(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    damaged = _damaged_catalog(rotated_pdf, tmp_path / "damaged.pdf")
    output = tmp_path / "out.pdf"
    with pytest.raises(OpError) as raised:
        _sign(damaged, output, certificate)
    assert raised.value.code == ErrorCode.PERMISSION_DENIED
    assert raised.value.data == {"reason": "permissionsUnreadable"}
    assert not output.exists()


def test_an_unreadable_signature_lock_refuses_signing(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    signed = _sign(rotated_pdf, tmp_path / "first.pdf", certificate)
    document = pymupdf.open(signed)
    widget = next(widget for page in document for widget in page.widgets())
    document.xref_set_key(widget.xref, "Lock", "(broken)")
    document.saveIncr()
    document.close()
    with pytest.raises(OpError) as raised:
        _sign(signed, tmp_path / "second.pdf", certificate)
    assert raised.value.code == ErrorCode.PERMISSION_DENIED
    assert raised.value.data == {"reason": "permissionsUnreadable"}


def test_a_document_without_permissions_still_signs(
    rotated_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    signed = _sign(rotated_pdf, tmp_path / "plain.pdf", certificate)
    second = _sign(signed, tmp_path / "plain-second.pdf", certificate)
    assert len(verify(VerifyParams(path=str(second)), silent_progress()).signatures) == 2
