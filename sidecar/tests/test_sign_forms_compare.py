from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._sign_params import SignParams
from vivepdf.ops.compare import CompareParams, compare
from vivepdf.ops.forms import (
    FieldsParams,
    FillParams,
    ResetParams,
    fill_fields,
    list_fields,
    reset_fields,
)
from vivepdf.ops.sign import SignaturesPresentParams, count_signatures, sign
from vivepdf.ops.sign_certificate import CreateCertificateParams, create_certificate
from vivepdf.ops.sign_verify import VerifyParams, verify
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def certificate(tmp_path: Path) -> Path:
    result = create_certificate(
        CreateCertificateParams(
            output=str(tmp_path / "me.p12"),
            password="pw-12345",
            common_name="Ayşe Yılmaz",
            email="ayse@example.com",
            organization="vivePDF",
            key_type="ec",
        ),
        silent_progress(),
    )
    assert "Ay" in result.subject
    return Path(result.output)


@pytest.fixture
def form_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    text = pymupdf.Widget()
    text.field_name = "name"
    text.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    text.rect = pymupdf.Rect(72, 72, 300, 96)
    text.field_label = "Ad Soyad"
    page.add_widget(text)
    check = pymupdf.Widget()
    check.field_name = "agree"
    check.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
    check.rect = pymupdf.Rect(72, 110, 90, 128)
    page.add_widget(check)
    combo = pymupdf.Widget()
    combo.field_name = "city"
    combo.field_type = pymupdf.PDF_WIDGET_TYPE_COMBOBOX
    combo.rect = pymupdf.Rect(72, 140, 200, 164)
    combo.choice_values = ["Ankara", "İzmir", "İstanbul"]
    page.add_widget(combo)
    path = tmp_path / "form.pdf"
    document.save(path)
    document.close()
    return path


def test_sign_and_verify(sample_pdf: Path, certificate: Path, tmp_path: Path) -> None:
    result = sign(
        SignParams(
            path=str(sample_pdf),
            output=str(tmp_path / "signed.pdf"),
            certificate_path=str(certificate),
            certificate_password="pw-12345",
            reason="Onay",
            page=1,
        ),
        silent_progress(),
    )
    assert "Ay" in result.signer and result.page_count == 3
    with pymupdf.open(result.output) as document:
        assert any(
            widget.field_type == pymupdf.PDF_WIDGET_TYPE_SIGNATURE
            for widget in document[0].widgets()
        )
        assert "Ay" in document[0].get_text()
    verified = verify(VerifyParams(path=result.output), silent_progress())
    assert len(verified.signatures) == 1
    signature = verified.signatures[0]
    assert signature.intact and signature.valid and not signature.trusted
    assert signature.reason == "Onay"
    assert (
        count_signatures(SignaturesPresentParams(path=result.output), silent_progress()).count == 1
    )


def test_sign_second_signature_and_invisible(
    sample_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    first = sign(
        SignParams(
            path=str(sample_pdf),
            output=str(tmp_path / "s1.pdf"),
            certificate_path=str(certificate),
            certificate_password="pw-12345",
            visible=False,
        ),
        silent_progress(),
    )
    second = sign(
        SignParams(
            path=first.output,
            output=str(tmp_path / "s2.pdf"),
            certificate_path=str(certificate),
            certificate_password="pw-12345",
            field_name="Sig2",
            page=2,
            box=[50, 50, 250, 110],
        ),
        silent_progress(),
    )
    verified = verify(VerifyParams(path=second.output), silent_progress())
    assert len(verified.signatures) == 2
    assert all(item.intact for item in verified.signatures)


def test_sign_rejects_wrong_certificate_password(
    sample_pdf: Path, certificate: Path, tmp_path: Path
) -> None:
    with pytest.raises(OpError) as raised:
        sign(
            SignParams(
                path=str(sample_pdf),
                output=str(tmp_path / "x.pdf"),
                certificate_path=str(certificate),
                certificate_password="nope",
            ),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS and raised.value.data == {
        "reason": "certificatePassword",
    }
    with pytest.raises(OpError) as missing:
        sign(
            SignParams(
                path=str(sample_pdf),
                output=str(tmp_path / "y.pdf"),
                certificate_path=str(tmp_path / "none.p12"),
            ),
            silent_progress(),
        )
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND


def test_verify_unsigned_document(sample_pdf: Path) -> None:
    assert verify(VerifyParams(path=str(sample_pdf)), silent_progress()).signatures == []


def test_form_fields_fill_and_reset(form_pdf: Path, tmp_path: Path) -> None:
    listed = list_fields(FieldsParams(path=str(form_pdf)), silent_progress())
    assert listed.is_form and not listed.xfa
    kinds = {field.name: field.kind for field in listed.fields}
    assert kinds == {"name": "text", "agree": "checkbox", "city": "combobox"}
    assert next(field for field in listed.fields if field.name == "city").options == [
        "Ankara",
        "İzmir",
        "İstanbul",
    ]

    filled = fill_fields(
        FillParams(
            path=str(form_pdf),
            output=str(tmp_path / "filled.pdf"),
            values={"name": "Ayşe Yılmaz", "agree": True, "city": "İzmir"},
        ),
        silent_progress(),
    )
    assert filled.filled == 3
    after = list_fields(FieldsParams(path=filled.output), silent_progress())
    values = {field.name: field.value for field in after.fields}
    assert values == {"name": "Ayşe Yılmaz", "agree": True, "city": "İzmir"}

    flat = fill_fields(
        FillParams(
            path=str(form_pdf),
            output=str(tmp_path / "flat.pdf"),
            values={"name": "Düz"},
            flatten=True,
        ),
        silent_progress(),
    )
    with pymupdf.open(flat.output) as document:
        assert not document.is_form_pdf and "Düz" in document[0].get_text()

    with pytest.raises(OpError):
        fill_fields(
            FillParams(
                path=str(form_pdf), output=str(tmp_path / "bad.pdf"), values={"city": "Bursa"}
            ),
            silent_progress(),
        )
    reset = reset_fields(
        ResetParams(path=filled.output, output=str(tmp_path / "reset.pdf")), silent_progress()
    )
    assert reset.page_count == 1
    cleared = list_fields(FieldsParams(path=reset.output), silent_progress())
    assert cleared.is_form
    assert all(not field.value for field in cleared.fields), [
        (field.name, field.value) for field in cleared.fields
    ]


def test_forms_on_plain_document(sample_pdf: Path, tmp_path: Path) -> None:
    listed = list_fields(FieldsParams(path=str(sample_pdf)), silent_progress())
    assert listed.fields == [] and not listed.is_form
    with pytest.raises(OpError) as raised:
        fill_fields(
            FillParams(path=str(sample_pdf), output=str(tmp_path / "x.pdf"), values={"a": "b"}),
            silent_progress(),
        )
    assert raised.value.data == {"reason": "noForm"}


def test_compare_detects_text_and_visual_changes(sample_pdf: Path, tmp_path: Path) -> None:
    with pymupdf.open(sample_pdf) as document:
        document[1].insert_text((72, 200), "Yeni satır eklendi", fontsize=14)
        document[2].draw_rect(pymupdf.Rect(100, 300, 300, 400), color=(0, 0, 1), fill=(0, 0, 1))
        document.new_page().insert_text((72, 72), "Ek sayfa")
        changed = tmp_path / "changed.pdf"
        document.save(changed)
    result = compare(
        CompareParams(
            path_a=str(sample_pdf), path_b=str(changed), output=str(tmp_path / "diff.pdf")
        ),
        silent_progress(),
    )
    assert result.pages_a == 3 and result.pages_b == 4
    assert result.changed_pages == 3
    assert result.pages[0].added_words == 0 and result.pages[0].changed_area == 0
    assert result.pages[1].added_words == 3 and result.pages[1].snippets
    assert result.pages[2].changed_area > 0.01
    assert result.pages[3].in_a is False and result.pages[3].in_b is True
    with pymupdf.open(result.output) as report:
        assert report.page_count == 4
    identical = compare(
        CompareParams(path_a=str(sample_pdf), path_b=str(sample_pdf)), silent_progress()
    )
    assert identical.changed_pages == 0 and identical.output is None


def test_sign_twice_uses_a_fresh_field(sample_pdf: Path, certificate: Path, tmp_path: Path) -> None:
    first = sign(
        SignParams(
            path=str(sample_pdf),
            output=str(tmp_path / "once.pdf"),
            certificate_path=str(certificate),
            certificate_password="pw-12345",
            visible=True,
        ),
        silent_progress(),
    )
    second = sign(
        SignParams(
            path=first.output,
            output=str(tmp_path / "twice.pdf"),
            certificate_path=str(certificate),
            certificate_password="pw-12345",
            visible=False,
        ),
        silent_progress(),
    )
    verified = verify(VerifyParams(path=second.output), silent_progress())
    names = {item.field_name for item in verified.signatures}
    assert names == {"vivePDF-Signature", "vivePDF-Signature-2"}
    assert (
        count_signatures(SignaturesPresentParams(path=second.output), silent_progress()).count == 2
    )
