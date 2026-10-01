from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import _protection
from vivepdf.ops import repair as repair_module
from vivepdf.ops.merge_split import MergeInput, MergeParams, SplitParams, merge, split
from vivepdf.ops.page_geometry import CropParams, Insets, ResizeParams, crop_pages, resize_pages
from vivepdf.ops.pages import AssemblePage, AssembleParams, AssembleSource, assemble
from vivepdf.ops.repair import RepairParams, repair
from vivepdf.ops.security import EncryptParams, Permissions, encrypt
from vivepdf.rpc.progress import silent_progress

LIMITED = pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_ACCESSIBILITY


def _document(path: Path, prefix: str, count: int, **encryption: object) -> Path:
    document = pymupdf.open()
    for index in range(count):
        document.new_page(width=595, height=842).insert_text((72, 72), f"{prefix}{index + 1}")
    document.save(path, **encryption)
    document.close()
    return path


def _protected(
    path: Path, method: int, user: str, owner: str, prefix: str = "Sayfa ", count: int = 4
) -> Path:
    return _document(
        path,
        prefix,
        count,
        encryption=method,
        user_pw=user,
        owner_pw=owner,
        permissions=LIMITED,
    )


def _permission_value(document: pymupdf.Document) -> str:
    kind, value = document.xref_get_key(-1, "Encrypt")
    if kind == "xref":
        return document.xref_get_key(int(value.split()[0]), "P")[1]
    return value.split("/P ")[1].split("/")[0].strip()


def _source_permission_value(path: Path) -> str:
    with pymupdf.open(path) as document:
        return _permission_value(document)


def test_split_parts_keep_every_password_method_and_permission(tmp_path: Path):
    source = _protected(tmp_path / "gizli rapor ş.pdf", pymupdf.PDF_ENCRYPT_AES_128, "u1", "o1")
    result = split(
        SplitParams(
            path=str(source),
            password="u1",
            mode="ranges",
            ranges="1-2;4,4",
            output_dir=str(tmp_path / "parts"),
        ),
        silent_progress(),
    )
    assert result.protected
    assert [part.page_count for part in result.outputs] == [2, 2]
    for part in result.outputs:
        with pymupdf.open(part.output) as document:
            assert document.needs_pass
            assert document.authenticate("o1") & 4
        with pymupdf.open(part.output) as document:
            assert document.authenticate("u1") == 2
            assert document.metadata["encryption"] == "Standard V4 R4 128-bit AES"
            assert _permission_value(document) == _source_permission_value(source)
    with pymupdf.open(result.outputs[1].output) as document:
        document.authenticate("u1")
        assert [page.get_text().strip() for page in document] == ["Sayfa 4", "Sayfa 4"]


def test_split_of_an_owner_only_file_keeps_its_owner_password(tmp_path: Path):
    source = _protected(tmp_path / "izinli.pdf", pymupdf.PDF_ENCRYPT_RC4_128, "", "sahip")
    result = split(
        SplitParams(path=str(source), mode="every", every=2, output_dir=str(tmp_path / "parts")),
        silent_progress(),
    )
    assert result.protected
    for part in result.outputs:
        with pymupdf.open(part.output) as document:
            assert not document.needs_pass
            assert document.metadata["encryption"] == "Standard V2 R3 128-bit RC4"
            assert _permission_value(document) == _source_permission_value(source)
            assert document.authenticate("sahip") & 4


def test_split_of_a_plain_file_says_it_is_not_protected(tmp_path: Path):
    source = _document(tmp_path / "plain.pdf", "Sayfa ", 3)
    result = split(
        SplitParams(path=str(source), mode="single", output_dir=str(tmp_path / "parts")),
        silent_progress(),
    )
    assert not result.protected
    with pymupdf.open(result.outputs[0].output) as document:
        assert not document.metadata.get("encryption")


def test_merge_takes_the_protection_of_the_first_protected_input(tmp_path: Path):
    plain = _document(tmp_path / "açık.pdf", "A", 2)
    first = _protected(tmp_path / "birinci şifreli.pdf", pymupdf.PDF_ENCRYPT_AES_256, "u1", "o1")
    second = _protected(tmp_path / "ikinci.pdf", pymupdf.PDF_ENCRYPT_RC4_128, "u2", "o2")
    target = tmp_path / "merged.pdf"
    result = merge(
        MergeParams(
            inputs=[
                MergeInput(path=str(plain)),
                MergeInput(path=str(first), password="u1"),
                MergeInput(path=str(second), password="u2"),
            ],
            output=str(target),
        ),
        silent_progress(),
    )
    assert result.protected_from == "birinci şifreli.pdf"
    assert result.page_count == 10
    with pymupdf.open(target) as document:
        assert document.needs_pass
        assert not document.authenticate("u2")
    with pymupdf.open(target) as document:
        assert document.authenticate("u1")
        assert document.metadata["encryption"] == "Standard V5 R6 256-bit AES"
        assert _permission_value(document) == _source_permission_value(first)
        assert document[0].get_text().strip() == "A1"
        assert document[2].get_text().strip() == "Sayfa 1"
        assert document[6].get_text().strip() == "Sayfa 1"


def test_merge_with_the_owner_password_keeps_it_as_owner(tmp_path: Path):
    protected = _protected(tmp_path / "p.pdf", pymupdf.PDF_ENCRYPT_AES_256, "u1", "o1")
    target = tmp_path / "merged.pdf"
    merge(
        MergeParams(inputs=[MergeInput(path=str(protected), password="o1")], output=str(target)),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert document.needs_pass
        assert document.authenticate("o1") & 4


def test_merge_of_an_owner_only_input_keeps_its_permissions(tmp_path: Path):
    plain = _document(tmp_path / "a.pdf", "A", 1)
    restricted = _protected(tmp_path / "b.pdf", pymupdf.PDF_ENCRYPT_AES_128, "", "sahip")
    target = tmp_path / "merged.pdf"
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(plain)), MergeInput(path=str(restricted))],
            output=str(target),
        ),
        silent_progress(),
    )
    assert result.protected_from == "b.pdf"
    with pymupdf.open(target) as document:
        assert not document.needs_pass
        assert document.metadata["encryption"] == "Standard V4 R4 128-bit AES"
        assert _permission_value(document) == _source_permission_value(restricted)
        assert not document.authenticate("") & 4


def test_merge_with_the_known_owner_password_of_an_owner_only_input(tmp_path: Path):
    restricted = _protected(tmp_path / "b.pdf", pymupdf.PDF_ENCRYPT_AES_256, "", "sahip")
    target = tmp_path / "merged.pdf"
    merge(
        MergeParams(
            inputs=[MergeInput(path=str(restricted), password="sahip")], output=str(target)
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert not document.needs_pass
        assert document.authenticate("sahip") & 4


def test_merge_can_drop_the_protection_when_asked(tmp_path: Path):
    protected = _protected(tmp_path / "p.pdf", pymupdf.PDF_ENCRYPT_AES_256, "u1", "o1")
    target = tmp_path / "merged.pdf"
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(protected), password="u1")],
            output=str(target),
            keep_protection=False,
        ),
        silent_progress(),
    )
    assert result.protected_from is None
    with pymupdf.open(target) as document:
        assert not document.needs_pass
        assert not document.metadata.get("encryption")


def test_merge_of_plain_inputs_stays_plain(tmp_path: Path):
    first = _document(tmp_path / "a.pdf", "A", 1)
    second = _document(tmp_path / "b.pdf", "B", 1)
    target = tmp_path / "merged.pdf"
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(first)), MergeInput(path=str(second))], output=str(target)
        ),
        silent_progress(),
    )
    assert result.protected_from is None
    with pymupdf.open(target) as document:
        assert not document.metadata.get("encryption")


def test_a_page_named_twice_is_cropped_once(tmp_path: Path):
    source = _document(tmp_path / "c.pdf", "C", 2)
    target = tmp_path / "out.pdf"
    result = crop_pages(
        CropParams(
            path=str(source), output=str(target), pages="1,1", insets=Insets(left=10, right=10)
        ),
        silent_progress(),
    )
    assert result.cropped == 1
    with pymupdf.open(target) as document:
        assert document[0].cropbox.width == pytest.approx(575)


def test_a_page_named_twice_is_resized_once(tmp_path: Path):
    source = _document(tmp_path / "r.pdf", "R", 2)
    with pymupdf.open(source) as document:
        streams = len(document[0].get_contents())
    target = tmp_path / "out.pdf"
    resize_pages(
        ResizeParams(path=str(source), output=str(target), pages="1,1", preset="a5", margin=20),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert len(document[0].get_contents()) <= streams + 2
        assert document[0].rect.width == pytest.approx(420)


def test_assemble_carries_page_labels_to_the_new_order(tmp_path: Path):
    labelled = tmp_path / "labelled.pdf"
    document = pymupdf.open()
    for index in range(4):
        document.new_page().insert_text((72, 72), f"L{index + 1}")
    document.set_page_labels(
        [
            {"startpage": 0, "style": "r", "prefix": "", "firstpagenum": 1},
            {"startpage": 2, "style": "D", "prefix": "", "firstpagenum": 1},
        ]
    )
    document.save(labelled)
    document.close()
    other = _document(tmp_path / "other.pdf", "O", 2)
    target = tmp_path / "out.pdf"
    assemble(
        AssembleParams(
            sources=[
                AssembleSource(id="main", path=str(labelled)),
                AssembleSource(id="other", path=str(other)),
            ],
            pages=[
                AssemblePage(source="main", index=3),
                AssemblePage(source="main", index=1),
                AssemblePage(source="main", index=2),
                AssemblePage(kind="blank"),
                AssemblePage(source="other", index=1),
                AssemblePage(source="main", index=4),
            ],
            output=str(target),
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as result:
        assert [page.get_label() for page in result] == ["1", "i", "ii", "4", "5", "2"]


def test_assemble_without_labelled_sources_writes_no_labels(tmp_path: Path):
    source = _document(tmp_path / "plain.pdf", "P", 2)
    target = tmp_path / "out.pdf"
    assemble(
        AssembleParams(
            sources=[AssembleSource(id="main", path=str(source))],
            pages=[AssemblePage(source="main", index=2), AssemblePage(source="main", index=1)],
            output=str(target),
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as result:
        assert not result.get_page_labels()


def test_a_salvaged_protected_file_keeps_its_password(tmp_path: Path, monkeypatch):
    source = _protected(tmp_path / "kurtarılacak.pdf", pymupdf.PDF_ENCRYPT_AES_256, "u1", "o1")
    original = repair_module._write

    def refuse_in_place(document, target, *args, **kwargs):
        if document.name:
            return False
        return original(document, target, *args, **kwargs)

    monkeypatch.setattr(repair_module, "_write", refuse_in_place)
    target = tmp_path / "out.pdf"
    result = repair(
        RepairParams(path=str(source), password="u1", output=str(target)), silent_progress()
    )
    assert result.rebuilt
    assert result.page_count == 4
    with pymupdf.open(target) as document:
        assert document.needs_pass
        assert document.authenticate("u1")
        assert document.metadata["encryption"] == "Standard V5 R6 256-bit AES"
        assert document[0].get_text().strip() == "Sayfa 1"


def _image_count(document: pymupdf.Document) -> int:
    return sum(
        1
        for xref in range(1, document.xref_length())
        if document.xref_get_key(xref, "Subtype") == ("name", "/Image")
    )


def test_protected_split_parts_carry_only_their_own_pages_resources(tmp_path: Path):
    source = tmp_path / "resimli.pdf"
    document = pymupdf.open()
    for index in range(6):
        page = document.new_page(width=300, height=300)
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), 0)
        pixmap.set_rect(pixmap.irect, (index * 40, 255 - index * 40, 90))
        page.insert_image(pymupdf.Rect(20, 20, 280, 280), pixmap=pixmap)
        page.insert_text((30, 290), f"Sayfa {index + 1}")
    document.save(source, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u1", owner_pw="o1")
    document.close()
    result = split(
        SplitParams(
            path=str(source),
            password="u1",
            mode="ranges",
            ranges="2;4-5;6,6",
            output_dir=str(tmp_path / "p"),
        ),
        silent_progress(),
    )
    assert [part.page_count for part in result.outputs] == [1, 2, 2]
    for part, expected in zip(result.outputs, [1, 2, 1], strict=True):
        with pymupdf.open(part.output) as opened:
            assert opened.authenticate("u1")
            assert _image_count(opened) == expected
    with pymupdf.open(result.outputs[1].output) as opened:
        opened.authenticate("u1")
        assert [page.get_text().strip() for page in opened] == ["Sayfa 4", "Sayfa 5"]


def test_a_non_ascii_password_survives_a_protected_split(tmp_path: Path):
    source = _protected(tmp_path / "ş.pdf", pymupdf.PDF_ENCRYPT_AES_256, "şifreğ", "sahipİ")
    result = split(
        SplitParams(
            path=str(source), password="şifreğ", mode="single", output_dir=str(tmp_path / "p")
        ),
        silent_progress(),
    )
    with pymupdf.open(result.outputs[2].output) as opened:
        assert opened.authenticate("şifreğ") == 2
        assert opened[0].get_text().strip() == "Sayfa 3"
    with pymupdf.open(result.outputs[2].output) as opened:
        assert opened.authenticate("sahipİ") & 4


def _encrypt_dictionary(document: pymupdf.Document) -> str:
    kind, value = document.xref_get_key(-1, "Encrypt")
    if kind == "xref":
        return document.xref_object(int(value.split()[0]), compressed=True)
    return value


def _unencrypted_metadata_source(path: Path) -> Path:
    import pikepdf

    plain = _document(path.with_name("plain-source.pdf"), "Sayfa ", 2)
    with pikepdf.open(plain) as pdf:
        pdf.save(path, encryption=pikepdf.Encryption(user="u1", owner="o1", R=6, metadata=False))
    return path


def test_merge_keeps_unencrypted_metadata_of_the_protected_input(tmp_path: Path):
    source = _unencrypted_metadata_source(tmp_path / "meta.pdf")
    other = _document(tmp_path / "other.pdf", "B", 1)
    target = tmp_path / "merged.pdf"
    merge(
        MergeParams(
            inputs=[MergeInput(path=str(other)), MergeInput(path=str(source), password="u1")],
            output=str(target),
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as opened:
        assert _encrypt_dictionary(opened).replace(" ", "").count("/EncryptMetadatafalse") == 1
        assert opened.authenticate("u1")
        assert opened.page_count == 3
        assert opened[1].get_text().strip() == "Sayfa 1"
    with pymupdf.open(target) as opened:
        assert opened.authenticate("o1") & 4


def test_a_password_over_forty_characters_survives_the_fallback_split(tmp_path: Path, monkeypatch):
    plain = _document(tmp_path / "duz.pdf", "Sayfa ", 3)
    user = "kullanici-parolasi-" * 3
    owner = "sahip-parolasi-" * 4
    source = tmp_path / "uzun.pdf"
    encrypt(
        EncryptParams(
            path=str(plain),
            output=str(source),
            user_password=user,
            owner_password=owner,
            permissions=Permissions(copy_text=False, modify=False),
        ),
        silent_progress(),
    )
    monkeypatch.setattr(_protection, "open_seal", lambda *_args: None)
    result = split(
        SplitParams(path=str(source), password=user, mode="single", output_dir=str(tmp_path / "p")),
        silent_progress(),
    )
    assert result.protected
    assert len(result.outputs) == 3
    for index, part in enumerate(result.outputs):
        with pymupdf.open(part.output) as document:
            assert document.needs_pass
            assert document.authenticate(user) == 2
            assert document.metadata["encryption"] == "Standard V5 R6 256-bit AES"
            assert _permission_value(document) == _source_permission_value(source)
            assert document[0].get_text().strip() == f"Sayfa {index + 1}"


@pytest.mark.parametrize(
    ("method", "description", "meaningful"),
    [
        (pymupdf.PDF_ENCRYPT_AES_128, "Standard V4 R4 128-bit AES", -1),
        (pymupdf.PDF_ENCRYPT_RC4_128, "Standard V4 R4 128-bit RC4", -1),
        (pymupdf.PDF_ENCRYPT_RC4_40, "Standard V1 R2 40-bit RC4", 0b111100),
    ],
)
def test_a_long_legacy_password_is_written_through_pyhanko(
    tmp_path: Path, method: int, description: str, meaningful: int
):
    user = "u" * 45
    owner = "o" * 45
    protection = _protection.Protection(
        method=method,
        user_password=user,
        owner_password=owner,
        permissions=LIMITED | -3904,
        owner_password_known=True,
    )
    assert not protection.fits_mupdf()
    target = tmp_path / "eski.pdf"
    with pymupdf.open(_document(tmp_path / "duz.pdf", "Sayfa ", 2)) as document:
        saved = _protection.save_protected(document, target, None, protection)
    assert saved.page_count == 2
    with pymupdf.open(target) as document:
        assert document.needs_pass
        assert document.authenticate(user[:32]) == 2
        assert document.metadata["encryption"] == description
        assert int(_permission_value(document)) & meaningful == (LIMITED | -3904) & meaningful
        assert document[1].get_text().strip() == "Sayfa 2"
