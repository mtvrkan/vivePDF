from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._sign_params import SignParams
from vivepdf.ops.forms import (
    FieldsParams,
    FillParams,
    ResetParams,
    fill_fields,
    list_fields,
    reset_fields,
)
from vivepdf.ops.forms_data import (
    FormDataExportParams,
    FormDataImportParams,
    export_data,
    import_data,
)
from vivepdf.ops.sign import sign as sign_document
from vivepdf.ops.sign_certificate import CreateCertificateParams, create_certificate
from vivepdf.ops.sign_verify import VerifyParams, verify
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

RADIO_XREF = 5


def _radio_kid(xref: int, state: str, x: float, on: bool) -> str:
    current = state if on else "Off"
    return (
        f"{xref} 0 obj << /Type /Annot /Subtype /Widget /Parent {RADIO_XREF} 0 R "
        f"/Rect [{x} 700 {x + 14} 714] /F 4 /P 3 0 R /MK << /CA (l) >> /AS /{current} "
        f"/AP << /N << /{state} 20 0 R /Off 21 0 R >> >> >> endobj\n"
    )


def _form(path: Path, xfa: bool = False) -> Path:
    extra = " /XFA 40 0 R" if xfa else ""
    objects = [
        "1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 9 0 R 10 0 R 11 0 R] "
        f"/DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 30 0 R >> >>{extra} >> >> endobj\n",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Annots [6 0 R 7 0 R 8 0 R 9 0 R 10 0 R 11 0 R] >> endobj\n",
        "5 0 obj << /FT /Btn /Ff 49152 /T (size) /V /M /DV /S "
        "/Opt [(Small) (Medium) (Large)] /Kids [6 0 R 7 0 R 8 0 R] >> endobj\n",
        _radio_kid(6, "S", 72, False),
        _radio_kid(7, "M", 100, True),
        _radio_kid(8, "L", 128, False),
        "9 0 obj << /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (country) "
        "/Rect [72 650 250 670] /P 3 0 R /F 4 /Opt [[(tr) (Turkiye)] [(de) (Almanya)]] "
        "/V (tr) /DV (de) /DA (/Helv 10 Tf 0 g) >> endobj\n",
        "10 0 obj << /Type /Annot /Subtype /Widget /FT /Tx /Ff 16777216 /MaxLen 5 /T (code) "
        "/Rect [72 600 250 620] /P 3 0 R /F 4 /V (AB) /DV (ZZ) /DA (/Helv 10 Tf 0 g) >> endobj\n",
        "11 0 obj << /Type /Annot /Subtype /Widget /FT /Tx /T (note) "
        "/Rect [72 550 250 570] /P 3 0 R /F 4 /V (old) /DA (/Helv 10 Tf 0 g) >> endobj\n",
        "20 0 obj << /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 0 >> stream\n\n"
        "endstream endobj\n",
        "21 0 obj << /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 0 >> stream\n\n"
        "endstream endobj\n",
        "30 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
        "40 0 obj << /Length 7 >> stream\n<xdp/>\nendstream endobj\n",
    ]
    raw = "%PDF-1.7\n" + "".join(objects) + "trailer << /Root 1 0 R /Size 41 >>\n%%EOF\n"
    document = pymupdf.open("pdf", raw.encode("latin-1"))
    document.save(path)
    document.close()
    return path


@pytest.fixture
def form(tmp_path: Path) -> Path:
    return _form(tmp_path / "form.pdf")


def _fields(path: str | Path) -> dict:
    listed = list_fields(FieldsParams(path=str(path)), silent_progress())
    return {field.name: field for field in listed.fields}


def _fill(source: Path, target: Path, values: dict, **extra):
    return fill_fields(
        FillParams(path=str(source), output=str(target), values=values, **extra),
        silent_progress(),
    )


def _radio_keys(path: str) -> tuple[tuple[str, str], list[str]]:
    with pymupdf.open(path) as document:
        page = document[0]
        kids = [widget.xref for widget in page.widgets() if widget.field_name == "size"]
        states = [document.xref_get_key(xref, "AS")[1] for xref in kids]
        parent = int(document.xref_get_key(kids[0], "Parent")[1].split()[0])
        return document.xref_get_key(parent, "V"), states


def _widget_xref(document: pymupdf.Document, name: str) -> int:
    return next(widget.xref for widget in document[0].widgets() if widget.field_name == name)


def test_a_radio_group_is_listed_once_with_its_states_labels_and_choice(form: Path):
    fields = _fields(form)

    size = fields["size"]
    assert size.kind == "radio"
    assert size.options == ["S", "M", "L"]
    assert size.option_labels == ["Small", "Medium", "Large"]
    assert size.value == "M"
    assert [name for name in fields if name == "size"] == ["size"]


def test_choosing_a_radio_state_turns_the_others_off_and_stores_a_name(form: Path, tmp_path: Path):
    result = _fill(form, tmp_path / "out.pdf", {"size": "L"})

    assert result.filled == 1
    assert _radio_keys(result.output) == (("name", "/L"), ["/Off", "/Off", "/L"])
    assert _fields(result.output)["size"].value == "L"


def test_a_radio_can_be_chosen_by_its_label(form: Path, tmp_path: Path):
    result = _fill(form, tmp_path / "out.pdf", {"size": "small"})

    assert _fields(result.output)["size"].value == "S"


def test_clearing_a_radio_writes_the_off_name_not_a_string(form: Path, tmp_path: Path):
    result = _fill(form, tmp_path / "out.pdf", {"size": ""})

    assert _radio_keys(result.output) == (("name", "/Off"), ["/Off", "/Off", "/Off"])
    assert _fields(result.output)["size"].value is None


def test_an_unknown_radio_state_is_refused_with_a_reason(form: Path, tmp_path: Path):
    with pytest.raises(OpError) as caught:
        _fill(form, tmp_path / "out.pdf", {"size": "XL"})

    assert caught.value.data == {"reason": "notAnOption", "field": "size", "value": "XL"}


def test_option_pairs_list_exports_with_labels_and_accept_either(form: Path, tmp_path: Path):
    country = _fields(form)["country"]
    assert country.options == ["tr", "de"]
    assert country.option_labels == ["Turkiye", "Almanya"]

    result = _fill(form, tmp_path / "out.pdf", {"country": "Almanya"}, flatten=True)

    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
    assert "Almanya" in text
    assert "de" not in text.split()


def test_text_longer_than_the_field_allows_is_cut_and_reported(form: Path, tmp_path: Path):
    result = _fill(form, tmp_path / "out.pdf", {"code": "ABCDEFG"})

    assert result.truncated == ["code"]
    assert _fields(result.output)["code"].value == "ABCDE"
    assert _fields(form)["code"].max_length == 5


def test_an_empty_text_value_clears_the_field(form: Path, tmp_path: Path):
    result = _fill(form, tmp_path / "out.pdf", {"note": ""})

    assert result.filled == 1
    assert _fields(result.output)["note"].value in ("", None)


def test_comb_fields_place_each_character_in_its_own_cell(form: Path, tmp_path: Path):
    result = _fill(form, tmp_path / "out.pdf", {"code": "ÇŞ"})

    with pymupdf.open(result.output) as document:
        widget_xref = _widget_xref(document, "code")
        stream_xref = int(document.xref_get_key(widget_xref, "AP/N")[1].split()[0])
        stream = document.xref_stream(stream_xref).decode("latin-1")
    positions = [line.split()[4] for line in stream.splitlines() if line.endswith("Tj")]
    assert len(positions) == 2
    assert float(positions[1]) - float(positions[0]) == pytest.approx(178 / 5, abs=2)


def test_characters_the_font_cannot_draw_are_reported(form: Path, tmp_path: Path):
    result = _fill(form, tmp_path / "out.pdf", {"note": "Ali 漢字"})

    assert result.missing_glyphs == ["字", "漢"]


def test_reset_restores_each_field_default(form: Path, tmp_path: Path):
    filled = _fill(form, tmp_path / "filled.pdf", {"country": "tr", "code": "QQ", "size": "L"})

    reset = reset_fields(
        ResetParams(path=filled.output, output=str(tmp_path / "reset.pdf")), silent_progress()
    )

    fields = _fields(reset.output)
    assert fields["country"].value == "de"
    assert fields["code"].value == "ZZ"
    assert fields["size"].value == "S"
    assert fields["note"].value in ("", None)


def test_filling_drops_the_xfa_copy_so_viewers_show_the_new_values(tmp_path: Path):
    source = _form(tmp_path / "xfa.pdf", xfa=True)
    assert list_fields(FieldsParams(path=str(source)), silent_progress()).xfa

    result = _fill(source, tmp_path / "out.pdf", {"note": "new"})

    assert result.xfa_removed
    assert not list_fields(FieldsParams(path=result.output), silent_progress()).xfa


def test_imported_radio_values_select_the_state(form: Path, tmp_path: Path):
    data = tmp_path / "data.xfdf"
    data.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<xfdf xmlns="http://ns.adobe.com/xfdf/"><fields>'
        '<field name="size"><value>L</value></field>'
        "</fields></xfdf>",
        encoding="utf-8",
    )

    result = import_data(
        FormDataImportParams(path=str(form), data_path=str(data), output=str(tmp_path / "o.pdf")),
        silent_progress(),
    )

    assert result.filled == 1
    assert _radio_keys(result.output) == (("name", "/L"), ["/Off", "/Off", "/L"])


def test_exporting_an_unchosen_radio_writes_off(form: Path, tmp_path: Path):
    target = tmp_path / "data.xfdf"
    export_data(
        FormDataExportParams(path=str(form), output=str(target), values={"size": ""}),
        silent_progress(),
    )

    text = target.read_text(encoding="utf-8")
    assert '<field name="size"><value>Off</value></field>' in text


@pytest.fixture(scope="module")
def certificate(tmp_path_factory: pytest.TempPathFactory) -> Path:
    folder = tmp_path_factory.mktemp("cert")
    result = create_certificate(
        CreateCertificateParams(
            output=str(folder / "signer.p12"),
            password="pw-12345",
            common_name="Form Signer",
            key_type="ec",
        ),
        silent_progress(),
    )
    return Path(result.output)


@pytest.fixture
def signed_form(tmp_path: Path, certificate: Path) -> Path:
    source = _form(tmp_path / "unsigned.pdf")
    result = sign_document(
        SignParams(
            path=str(source),
            output=str(tmp_path / "signed.pdf"),
            certificate_path=str(certificate),
            certificate_password="pw-12345",
        ),
        silent_progress(),
    )
    return Path(result.output)


def test_filling_a_signed_form_appends_to_it_and_keeps_signatures_intact(
    signed_form: Path, tmp_path: Path
):
    assert list_fields(FieldsParams(path=str(signed_form)), silent_progress()).signed

    result = _fill(signed_form, tmp_path / "out.pdf", {"note": "after signing"})

    assert result.signatures_kept
    original = signed_form.read_bytes()
    assert Path(result.output).read_bytes().startswith(original)
    signature = verify(VerifyParams(path=result.output), silent_progress()).signatures[0]
    assert signature.intact
    assert _fields(result.output)["note"].value == "after signing"
    assert not list(Path(tmp_path).glob(".vivepdf-*.part"))


def test_a_signed_form_is_not_flattened(signed_form: Path, tmp_path: Path):
    with pytest.raises(OpError) as caught:
        _fill(signed_form, tmp_path / "out.pdf", {"note": "x"}, flatten=True)

    assert caught.value.data == {"reason": "signedFlatten"}
    assert not list(Path(tmp_path).glob(".vivepdf-*.part"))


def _fill_in_place(source: Path, values: dict, **extra):
    return fill_fields(
        FillParams(path=str(source), in_place=True, values=values, **extra),
        silent_progress(),
    )


def test_filling_in_place_writes_the_values_into_the_same_file(form: Path):
    result = _fill_in_place(form, {"note": "typed in the viewer"})

    assert Path(result.output) == form.resolve()
    assert _fields(form)["note"].value == "typed in the viewer"
    assert not list(form.parent.glob(".vivepdf-*.part"))


def test_filling_a_signed_form_in_place_keeps_its_signature(signed_form: Path):
    original = signed_form.read_bytes()

    result = _fill_in_place(signed_form, {"note": "after signing"})

    assert result.signatures_kept
    assert signed_form.read_bytes().startswith(original)
    assert verify(VerifyParams(path=str(signed_form)), silent_progress()).signatures[0].intact
    assert _fields(signed_form)["note"].value == "after signing"
    assert not list(signed_form.parent.glob(".vivepdf-*.part"))


def test_a_failed_in_place_fill_leaves_the_input_untouched(form: Path):
    original = form.read_bytes()

    with pytest.raises(OpError):
        _fill_in_place(form, {"size": "Huge"})

    assert form.read_bytes() == original
    assert not list(form.parent.glob(".vivepdf-*.part"))


def test_fill_needs_an_output_or_in_place(form: Path):
    with pytest.raises(OpError) as caught:
        fill_fields(FillParams(path=str(form), values={"note": "x"}), silent_progress())

    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "outputRequired"}


def test_fill_refuses_both_an_output_and_in_place(form: Path, tmp_path: Path):
    with pytest.raises(OpError) as caught:
        _fill_in_place(form, {"note": "x"}, output=str(tmp_path / "out.pdf"))

    assert caught.value.data == {"reason": "outputAndInPlace"}


def test_each_radio_widget_carries_its_state(form: Path):
    widgets = _fields(form)["size"].widgets

    assert [widget.state for widget in widgets] == ["S", "M", "L"]
    assert all(widget.page == 1 for widget in widgets)
