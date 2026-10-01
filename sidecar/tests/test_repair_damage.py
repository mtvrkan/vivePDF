from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.repair import RepairParams, repair
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def sound(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for number in range(6):
        page = document.new_page(width=595, height=842)
        page.insert_text(
            (72, 120), f"Sayfa {number + 1}", fontsize=14, fontname="dejavu", fontfile=FONT
        )
    document.set_toc([[1, "Baslik", 1], [1, "Ikinci", 4]])
    path = tmp_path / "sound.pdf"
    document.save(path)
    document.close()
    return path


def _damaged(sound: Path, name: str, share: float) -> Path:
    data = sound.read_bytes()
    path = sound.parent / name
    path.write_bytes(data[: int(len(data) * share)])
    return path


def test_a_sound_file_is_written_out_and_says_so(sound: Path, tmp_path: Path):
    target = tmp_path / "out.pdf"
    result = repair(RepairParams(path=str(sound), output=str(target)), silent_progress())
    assert result.page_count == 6
    assert not result.was_repaired
    assert not result.rebuilt
    assert result.damaged_pages == 0


def test_a_file_that_ends_early_is_salvaged_rather_than_crashing(sound: Path, tmp_path: Path):
    broken = _damaged(sound, "cut.pdf", 0.9)
    target = tmp_path / "out.pdf"
    result = repair(RepairParams(path=str(broken), output=str(target)), silent_progress())
    assert result.rebuilt
    assert result.page_count >= 1
    assert result.was_repaired
    reopened = pymupdf.open(target)
    assert reopened.page_count == result.page_count
    reopened.close()


def test_a_broken_index_is_mended_without_losing_a_page(sound: Path, tmp_path: Path):
    data = sound.read_bytes()
    position = data.rfind(b"startxref")
    broken = sound.parent / "noindex.pdf"
    broken.write_bytes(data[:position] + b"%%EOF\n")
    target = tmp_path / "out.pdf"
    result = repair(RepairParams(path=str(broken), output=str(target)), silent_progress())
    assert result.page_count == 6
    assert result.was_repaired
    assert not result.rebuilt
    reopened = pymupdf.open(target)
    assert sum(len(page.get_text().split()) for page in reopened) > 0
    reopened.close()


def test_what_is_written_back_can_always_be_opened_again(sound: Path, tmp_path: Path):
    for share in (0.99, 0.94, 0.7, 0.3):
        broken = _damaged(sound, f"cut-{int(share * 100)}.pdf", share)
        target = tmp_path / f"out-{int(share * 100)}.pdf"
        result = repair(RepairParams(path=str(broken), output=str(target)), silent_progress())
        reopened = pymupdf.open(target)
        assert reopened.page_count == result.page_count
        for index in range(reopened.page_count):
            reopened.load_page(index)
        reopened.close()


def test_a_file_that_is_not_a_pdf_is_refused_by_name(tmp_path: Path):
    path = tmp_path / "notes.pdf"
    path.write_bytes(b"these are just notes\n" * 50)
    with pytest.raises(OpError):
        repair(RepairParams(path=str(path), output=str(tmp_path / "out.pdf")), silent_progress())


def test_an_empty_file_is_refused(tmp_path: Path):
    path = tmp_path / "nothing.pdf"
    path.write_bytes(b"")
    with pytest.raises(OpError):
        repair(RepairParams(path=str(path), output=str(tmp_path / "out.pdf")), silent_progress())


def test_the_outline_survives_a_repair_that_keeps_every_page(sound: Path, tmp_path: Path):
    data = sound.read_bytes()
    position = data.rfind(b"startxref")
    broken = sound.parent / "noindex2.pdf"
    broken.write_bytes(data[:position] + b"%%EOF\n")
    target = tmp_path / "out.pdf"
    repair(RepairParams(path=str(broken), output=str(target)), silent_progress())
    reopened = pymupdf.open(target)
    assert [title for _level, title, _page in reopened.get_toc()] == ["Baslik", "Ikinci"]
    reopened.close()


def test_a_web_page_saved_as_pdf_is_not_turned_into_one(tmp_path: Path):
    path = tmp_path / "page.pdf"
    path.write_bytes(b"<html><body><p>not a pdf at all</p></body></html>")
    with pytest.raises(OpError) as raised:
        repair(RepairParams(path=str(path), output=str(tmp_path / "out.pdf")), silent_progress())
    assert raised.value.code == "INVALID_PDF"
    assert not (tmp_path / "out.pdf").exists()


def test_a_protected_file_keeps_its_password(sound: Path, tmp_path: Path):
    protected = tmp_path / "şifreli belge.pdf"
    with pymupdf.open(sound) as document:
        document.save(
            protected,
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw="kullanici",
            owner_pw="sahip",
        )
    target = tmp_path / "out.pdf"
    result = repair(
        RepairParams(path=str(protected), password="kullanici", output=str(target)),
        silent_progress(),
    )
    assert result.page_count == 6
    with pymupdf.open(target) as reopened:
        assert reopened.needs_pass
        assert reopened.authenticate("kullanici")
        assert "Sayfa 1" in reopened[0].get_text()


def _miscounted(sound: Path, count: bytes, name: str) -> Path:
    data = sound.read_bytes().replace(b"/Count 6", count, 1)
    assert count in data
    path = sound.parent / name
    path.write_bytes(data)
    return path


@pytest.mark.parametrize("count", [b"/Count 0", b"/Count 2", b"/Count 9"])
def test_a_wrong_page_count_keeps_every_real_page(sound: Path, tmp_path: Path, count: bytes):
    broken = _miscounted(sound, count, "miscounted.pdf")
    target = tmp_path / "out.pdf"
    result = repair(RepairParams(path=str(broken), output=str(target)), silent_progress())
    assert result.page_count == 6
    with pymupdf.open(target) as reopened:
        assert reopened.page_count == 6
        assert "Sayfa 6" in reopened[5].get_text()


def test_a_protected_file_with_a_wrong_page_count_keeps_its_password(sound: Path, tmp_path: Path):
    counted = _miscounted(sound, b"/Count 2", "miscounted.pdf")
    protected = tmp_path / "şifreli.pdf"
    with pymupdf.open(counted) as document:
        document.save(protected, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
    target = tmp_path / "out.pdf"
    repair(RepairParams(path=str(protected), password="u", output=str(target)), silent_progress())
    with pymupdf.open(target) as reopened:
        assert reopened.needs_pass
        assert reopened.authenticate("u")
        assert reopened.page_count >= 2


def test_a_salvaged_file_keeps_its_metadata_and_attachments(sound: Path, tmp_path: Path):
    with pymupdf.open(sound) as document:
        document.set_metadata({"title": "Rapor", "author": "Ayşe"})
        document.embfile_add("ek.txt", b"ek icerik", filename="ek.txt")
        enriched = tmp_path / "enriched.pdf"
        document.save(enriched)
    broken = _miscounted(enriched, b"/Count 3", "miscounted.pdf")
    target = tmp_path / "out.pdf"
    repair(RepairParams(path=str(broken), output=str(target)), silent_progress())
    with pymupdf.open(target) as reopened:
        assert reopened.metadata["title"] == "Rapor"
        assert reopened.metadata["author"] == "Ayşe"
        assert reopened.embfile_get("ek.txt") == b"ek icerik"


def test_a_failed_repair_leaves_an_existing_output_untouched(tmp_path: Path):
    source = tmp_path / "not.pdf"
    source.write_bytes(b"not a pdf at all")
    target = tmp_path / "out.pdf"
    target.write_bytes(b"earlier result")
    with pytest.raises(OpError):
        repair(
            RepairParams(path=str(source), output=str(target), overwrite=True), silent_progress()
        )
    assert target.read_bytes() == b"earlier result"
    assert [path.name for path in tmp_path.iterdir() if path.suffix == ".part"] == []


def test_a_signed_file_is_reported(sound: Path, tmp_path: Path):
    with pymupdf.open(sound) as document:
        widget = pymupdf.Widget()
        widget.field_type = pymupdf.PDF_WIDGET_TYPE_SIGNATURE
        widget.field_name = "imza"
        widget.rect = pymupdf.Rect(72, 700, 272, 760)
        document[0].add_widget(widget)
        document.pdf_catalog()
        catalog = document.pdf_catalog()
        acro = document.xref_get_key(catalog, "AcroForm")
        if acro[0] == "xref":
            document.xref_set_key(int(acro[1].split()[0]), "SigFlags", "3")
        else:
            document.xref_set_key(catalog, "AcroForm/SigFlags", "3")
        signed = tmp_path / "signed.pdf"
        document.save(signed)
    target = tmp_path / "out.pdf"
    result = repair(RepairParams(path=str(signed), output=str(target)), silent_progress())
    assert result.signed
    plain = repair(
        RepairParams(path=str(sound), output=str(tmp_path / "o2.pdf")), silent_progress()
    )
    assert not plain.signed
