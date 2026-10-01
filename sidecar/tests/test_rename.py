from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._naming import sanitize_file_name
from vivepdf.ops.rename import (
    RenameApplyItem,
    RenameApplyParams,
    RenamePreviewParams,
    RenameReplacement,
    RenameUndoItem,
    RenameUndoParams,
    apply,
    change_case,
    find_amount,
    find_date,
    find_invoice,
    preview,
    undo,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _invoice_pdf(path: Path, number: str, day: str, total: str) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 80), "ACME Enerji A.S.", fontsize=22)
    page.insert_text((72, 120), f"Fatura No: {number}", fontsize=11)
    page.insert_text((72, 140), f"Tarih: {day}", fontsize=11)
    page.insert_text((72, 160), f"Genel Toplam: {total} TL", fontsize=11)
    document.save(path)
    document.close()
    return path


@pytest.fixture
def invoices(tmp_path: Path) -> list[Path]:
    return [
        _invoice_pdf(tmp_path / "scan001.pdf", "FTR-2026-000123", "05.09.2026", "1.250,00"),
        _invoice_pdf(tmp_path / "scan002.pdf", "FTR-2026-000124", "6 Eylül 2026", "980,50"),
    ]


def test_field_extractors() -> None:
    assert find_date("Tarih: 05.09.2026").isoformat() == "2026-09-05"
    assert find_date("Date: 2026-09-05").isoformat() == "2026-09-05"
    assert find_date("6 Eylül 2026").isoformat() == "2026-09-06"
    assert find_date("September 6, 2026").isoformat() == "2026-09-06"
    assert find_date("31.02.2026 then 01.03.2026").isoformat() == "2026-03-01"
    assert find_date("no date here") is None
    assert find_invoice("Fatura No: FTR-2026-000123") == "FTR-2026-000123"
    assert find_invoice("Invoice #INV0099") == "INV0099"
    assert find_amount("Ara toplam 200,00 TL Genel Toplam: 1.250,00 TL") == "1250.00"
    assert find_amount("Total $1,250.75") == "1250.75"
    assert find_amount("nothing") == ""


def test_preview_builds_names_and_flags_conflicts(invoices: list[Path]) -> None:
    result = preview(
        RenamePreviewParams(
            paths=[str(path) for path in invoices],
            pattern="{date} {title} {invoice} {amount}",
            custom_patterns={"firm": r"([A-Z]+) Enerji"},
        ),
        silent_progress(),
    )
    first, second = result.items
    assert first.new_name == "2026-09-05 ACME Enerji A.S. FTR-2026-000123 1250.00"
    assert second.new_name == "2026-09-06 ACME Enerji A.S. FTR-2026-000124 980.50"
    assert first.fields["firm"] == "ACME"
    assert not first.conflict and not second.conflict
    same = preview(
        RenamePreviewParams(paths=[str(path) for path in invoices], pattern="{title}"),
        silent_progress(),
    )
    assert [item.conflict for item in same.items] == [False, True]


def test_preview_reports_unreadable_files(tmp_path: Path, invoices: list[Path]) -> None:
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"nope")
    result = preview(
        RenamePreviewParams(paths=[str(invoices[0]), str(broken)], pattern="{invoice}"),
        silent_progress(),
    )
    assert result.items[0].error is None
    assert result.items[1].error == ErrorCode.INVALID_PDF


def test_apply_renames_and_disambiguates(invoices: list[Path], tmp_path: Path) -> None:
    result = apply(
        RenameApplyParams(
            items=[RenameApplyItem(path=str(path), new_name="Fatura") for path in invoices],
        ),
        silent_progress(),
    )
    assert result.renamed == 2
    names = sorted(entry.name for entry in tmp_path.iterdir())
    assert names == ["Fatura-2.pdf", "Fatura.pdf"]
    assert not invoices[0].exists()


def test_apply_copies_into_folder(invoices: list[Path], tmp_path: Path) -> None:
    target = tmp_path / "out"
    result = apply(
        RenameApplyParams(
            items=[RenameApplyItem(path=str(invoices[0]), new_name="kopya")],
            mode="copy",
            output_dir=str(target),
        ),
        silent_progress(),
    )
    assert result.renamed == 1
    assert (target / "kopya.pdf").exists()
    assert invoices[0].exists()


def test_preview_rejects_bad_custom_pattern(invoices: list[Path]) -> None:
    with pytest.raises(OpError) as error:
        preview(
            RenamePreviewParams(paths=[str(invoices[0])], custom_patterns={"x": "("}),
            silent_progress(),
        )
    assert error.value.code == ErrorCode.INVALID_PARAMS


def test_preview_keeps_original_name_when_pattern_yields_nothing(sample_pdf: Path) -> None:
    result = preview(
        RenamePreviewParams(paths=[str(sample_pdf)], pattern="{invoice}"), silent_progress()
    )
    assert result.items[0].new_name == sample_pdf.stem


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("../../evil", "evil"),
        ("..\..\evil", "evil"),
        ("C:\Windows\system32", "C-Windows-system32"),
        ("..", "output"),
        ("", "output"),
        ("con", "con-file"),
        ("NUL.txt", "NUL-file.txt"),
        ("com9", "com9-file"),
        ("console", "console"),
        ("Ayşe Raporu", "Ayşe Raporu"),
    ],
)
def test_a_generated_name_is_always_a_plain_file_name(given: str, expected: str) -> None:
    cleaned = sanitize_file_name(given)
    assert cleaned == expected
    assert "/" not in cleaned and "\\" not in cleaned


def _names(result: object) -> list[str]:
    return [item.new_name for item in result.items]


def _paths(invoices: list[Path]) -> list[str]:
    return [str(path) for path in invoices]


def test_preview_counter_case_and_replacements(invoices: list[Path]) -> None:
    result = preview(
        RenamePreviewParams(
            paths=_paths(invoices),
            pattern="{n} {title}",
            counter_start=9,
            counter_step=5,
            case="lower",
            replacements=[
                RenameReplacement(find="A.S.", replace="AS"),
                RenameReplacement(find=r"^(\d+) ", replace=r"\1_", regex=True),
            ],
        ),
        silent_progress(),
    )
    assert _names(result) == ["09_acme enerji as", "14_acme enerji as"]


def test_preview_turkish_case_and_title_case(invoices: list[Path]) -> None:
    assert change_case("istanbul ılık", "upper", turkish=True) == "İSTANBUL ILIK"
    assert change_case("İZMİR IRMAK", "lower", turkish=True) == "izmir ırmak"
    assert change_case("izmir ırmak", "title", turkish=True) == "İzmir Irmak"
    assert change_case("izmir", "upper") == "IZMIR"
    with pytest.raises(OpError) as caught:
        preview(
            RenamePreviewParams(
                paths=_paths(invoices),
                pattern="{title}",
                replacements=[RenameReplacement(find="(", replace="", regex=True)],
            ),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "replacement"}


def test_preview_reads_ambiguous_dates_in_the_chosen_order(tmp_path: Path) -> None:
    path = _invoice_pdf(tmp_path / "us.pdf", "FTR-1000", "03/04/2026", "10,00")
    day_first = preview(RenamePreviewParams(paths=[str(path)], pattern="{date}"), silent_progress())
    month_first = preview(
        RenamePreviewParams(paths=[str(path)], pattern="{date}", date_order="mdy"),
        silent_progress(),
    )
    assert _names(day_first) == ["2026-04-03"]
    assert _names(month_first) == ["2026-03-04"]


def test_preview_builds_folders_and_honours_overrides(invoices: list[Path]) -> None:
    result = preview(
        RenamePreviewParams(
            paths=_paths(invoices),
            pattern="{year}/{subject}/../{invoice}",
            overrides={str(invoices[1]): "  Kept/by hand?  "},
        ),
        silent_progress(),
    )
    assert _names(result) == ["2026/FTR-2026-000123", "Kept/by hand"]
    assert result.items[0].bytes > 0 and result.items[0].modified > 0


def test_preview_opens_locked_files_with_their_own_password(
    encrypted_pdf: Path, invoices: list[Path]
) -> None:
    locked = preview(
        RenamePreviewParams(paths=[str(encrypted_pdf), str(invoices[0])], pattern="{pages}"),
        silent_progress(),
    )
    assert locked.items[0].error == ErrorCode.NEEDS_PASSWORD
    assert locked.items[1].error is None
    opened = preview(
        RenamePreviewParams(
            paths=[str(encrypted_pdf)], pattern="{pages}", passwords={str(encrypted_pdf): "secret"}
        ),
        silent_progress(),
    )
    assert opened.items[0].error is None


def test_preview_reads_scanned_files_with_ocr(tmp_path: Path) -> None:
    source = pymupdf.open()
    page = source.new_page()
    page.insert_text((72, 120), "Fatura No: FTR-2026-000555", fontsize=26)
    pixmap = page.get_pixmap(dpi=150)
    scanned = pymupdf.open()
    scanned.new_page(width=page.rect.width, height=page.rect.height).insert_image(
        page.rect, pixmap=pixmap
    )
    path = tmp_path / "scan.pdf"
    scanned.save(path)
    without = preview(
        RenamePreviewParams(paths=[str(path)], pattern="{invoice}"), silent_progress()
    )
    assert _names(without) == ["scan"] and not without.items[0].recognised
    recognised = preview(
        RenamePreviewParams(
            paths=[str(path)], pattern="{invoice}", ocr=True, ocr_languages=["eng"]
        ),
        silent_progress(),
    )
    assert _names(recognised) == ["FTR-2026-000555"] and recognised.items[0].recognised
    with pytest.raises(OpError) as caught:
        preview(
            RenamePreviewParams(
                paths=[str(path)], pattern="{invoice}", ocr=True, ocr_languages=["xxx"]
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.TESSDATA_MISSING


def test_apply_into_folders_and_undo(invoices: list[Path], tmp_path: Path) -> None:
    result = apply(
        RenameApplyParams(
            items=[
                RenameApplyItem(path=str(invoices[0]), new_name="2026/Acme/one"),
                RenameApplyItem(path=str(invoices[1]), new_name="2026/Acme/two"),
            ],
        ),
        silent_progress(),
    )
    assert result.renamed == 2
    assert (tmp_path / "2026" / "Acme" / "one.pdf").is_file()
    assert sorted(Path(path).name for path in result.created_dirs) == ["2026", "Acme"]
    restored = undo(
        RenameUndoParams(
            items=[
                RenameUndoItem(path=outcome.output, original=outcome.path)
                for outcome in result.results
            ],
            remove_dirs=result.created_dirs,
        ),
        silent_progress(),
    )
    assert restored.restored == 2
    assert all(path.is_file() for path in invoices)
    assert not (tmp_path / "2026").exists()


def test_undo_reverses_a_swap_and_refuses_to_clobber(invoices: list[Path]) -> None:
    first, second = invoices
    first_bytes, second_bytes = first.read_bytes(), second.read_bytes()
    swap = apply(
        RenameApplyParams(
            items=[
                RenameApplyItem(path=str(first), new_name=second.stem),
                RenameApplyItem(path=str(second), new_name=first.stem),
            ],
            auto_unique=False,
        ),
        silent_progress(),
    )
    assert swap.renamed == 2 and first.read_bytes() == second_bytes
    back = undo(
        RenameUndoParams(
            items=[RenameUndoItem(path=entry.output, original=entry.path) for entry in swap.results]
        ),
        silent_progress(),
    )
    assert back.restored == 2
    assert first.read_bytes() == first_bytes and second.read_bytes() == second_bytes
    moved = first.with_name("moved.pdf")
    first.rename(moved)
    blocked = undo(
        RenameUndoParams(items=[RenameUndoItem(path=str(moved), original=str(second))]),
        silent_progress(),
    )
    assert blocked.restored == 0 and blocked.results[0].error == "EXISTS"
    assert moved.read_bytes() == first_bytes and second.read_bytes() == second_bytes


def test_apply_never_lets_two_files_of_the_batch_overwrite_each_other(
    invoices: list[Path], tmp_path: Path
) -> None:
    (tmp_path / "Same.pdf").write_bytes(b"old")
    result = apply(
        RenameApplyParams(
            items=[RenameApplyItem(path=str(path), new_name="Same") for path in invoices],
            auto_unique=False,
            overwrite=True,
        ),
        silent_progress(),
    )
    assert [entry.ok for entry in result.results] == [True, False]
    assert result.results[0].replaced
    assert result.results[1].error == "EXISTS"
    assert invoices[1].is_file()


def test_apply_skips_taken_names_when_asked(invoices: list[Path], tmp_path: Path) -> None:
    (tmp_path / "Taken.pdf").write_bytes(b"old")
    result = apply(
        RenameApplyParams(
            items=[RenameApplyItem(path=str(invoices[0]), new_name="Taken")], auto_unique=False
        ),
        silent_progress(),
    )
    assert result.results[0].error == "EXISTS"
    assert (tmp_path / "Taken.pdf").read_bytes() == b"old" and invoices[0].is_file()
