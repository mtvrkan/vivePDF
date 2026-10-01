import json
from pathlib import Path

import pymupdf
import pytest

from vivepdf import cli


def test_info_prints_page_count(sample_pdf: Path, capsys: pytest.CaptureFixture[str]) -> None:
    cli.main(["info", str(sample_pdf)])

    output = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert output["pageCount"] == 3


def test_merge_sums_page_count(
    sample_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    output_path = tmp_path / "merged.pdf"

    cli.main(["merge", str(sample_pdf), str(sample_pdf), "-o", str(output_path)])

    capsys.readouterr()
    with pymupdf.open(output_path) as document:
        assert document.page_count == 6


def test_unknown_subcommand_exits_nonzero() -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["nope"])

    assert excinfo.value.code != 0


def test_selftest_reports_every_engine_library(capsys: pytest.CaptureFixture[str]) -> None:
    cli.main(["selftest"])

    output = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert output["ok"] is True
    assert set(output["versions"]) == {"pymupdf", "pikepdf", "onnxruntime", "pyhanko"}
    assert output["failures"] == {}


def test_selftest_pikepdf_check_includes_qpdf_version() -> None:
    assert "qpdf" in cli.SELFTEST_CHECKS["pikepdf"]()


def test_selftest_exits_nonzero_when_a_library_fails(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def broken() -> str:
        raise ImportError("missing native library")

    monkeypatch.setitem(cli.SELFTEST_CHECKS, "pikepdf", broken)

    with pytest.raises(SystemExit) as excinfo:
        cli.main(["selftest"])

    output = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert excinfo.value.code == 1
    assert output["ok"] is False
    assert output["failures"]["pikepdf"] == "ImportError: missing native library"


def _last_json(capsys: pytest.CaptureFixture[str]) -> dict:
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_rotate_turns_only_the_listed_pages(
    sample_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    output_path = tmp_path / "rotated.pdf"
    cli.main(["rotate", str(sample_pdf), "-o", str(output_path), "--degrees", "90", "--pages", "2"])
    assert _last_json(capsys)["pageCount"] == 3
    with pymupdf.open(output_path) as document:
        assert [page.rotation for page in document] == [0, 90, 0]


def test_delete_and_extract_take_a_page_list(
    sample_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    kept = tmp_path / "kept.pdf"
    cli.main(["delete", str(sample_pdf), "-o", str(kept), "--pages", "1,3"])
    capsys.readouterr()
    with pymupdf.open(kept) as document:
        assert document.page_count == 1
        assert "Page 2" in document[0].get_text()
    pulled = tmp_path / "pulled.pdf"
    cli.main(["extract", str(sample_pdf), "-o", str(pulled), "--pages", "2-3"])
    assert _last_json(capsys)["pageCount"] == 2


def test_extract_opens_an_encrypted_input_with_its_password(
    encrypted_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    pulled = tmp_path / "şifreli çıktı.pdf"
    cli.main(
        ["extract", str(encrypted_pdf), "-o", str(pulled), "--pages", "1", "--password", "secret"]
    )
    assert _last_json(capsys)["pageCount"] == 1


def test_reverse_and_insert_blank(
    sample_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    reversed_path = tmp_path / "reversed.pdf"
    cli.main(["reverse", str(sample_pdf), "-o", str(reversed_path)])
    capsys.readouterr()
    with pymupdf.open(reversed_path) as document:
        assert "Page 3" in document[0].get_text()
    padded = tmp_path / "padded.pdf"
    cli.main(["insert-blank", str(sample_pdf), "-o", str(padded), "--at", "2", "--count", "2"])
    assert _last_json(capsys)["pageCount"] == 5
    with pymupdf.open(padded) as document:
        assert document[1].get_text().strip() == ""
        assert "Page 2" in document[3].get_text()


def test_sign_count_reports_zero_for_an_unsigned_document(
    sample_pdf: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cli.main(["sign-count", str(sample_pdf)])
    assert _last_json(capsys) == {"count": 0}


def test_text_reads_a_scan_without_writing_a_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = pymupdf.open()
    page = source.new_page()
    page.insert_text((72, 120), "Scanned sample", fontsize=28)
    scanned = pymupdf.open()
    scanned_page = scanned.new_page(width=page.rect.width, height=page.rect.height)
    scanned_page.insert_image(scanned_page.rect, pixmap=page.get_pixmap(dpi=150))
    path = tmp_path / "scan.pdf"
    scanned.save(path)
    scanned.close()
    source.close()
    cli.main(["text", str(path), "--lang", "eng", "--dpi", "150"])
    output = _last_json(capsys)
    assert output["pageCount"] == 1
    assert "Scanned" in output["text"]
    assert sorted(item.name for item in tmp_path.iterdir()) == ["scan.pdf"]


@pytest.mark.parametrize("spec", ["3-1", "a", "0", ",", "2-x"])
def test_a_malformed_page_list_is_a_usage_error(
    sample_pdf: Path, tmp_path: Path, spec: str
) -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["delete", str(sample_pdf), "-o", str(tmp_path / "x.pdf"), "--pages", spec])
    assert excinfo.value.code == 2


def test_page_numbers_expands_ranges_once() -> None:
    assert cli.page_numbers("1, 3-4,3") == [1, 3, 4]


def test_invalid_parameters_exit_with_the_error_json(
    sample_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["insert-blank", str(sample_pdf), "-o", str(tmp_path / "x.pdf"), "--at", "0"])
    assert excinfo.value.code == 1
    assert _last_json(capsys)["code"] == "INVALID_PARAMS"
    assert not (tmp_path / "x.pdf").exists()


def test_an_out_of_range_page_is_reported_by_the_operation(
    sample_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["extract", str(sample_pdf), "-o", str(tmp_path / "x.pdf"), "--pages", "9"])
    assert excinfo.value.code == 1
    assert _last_json(capsys)["code"] == "INVALID_PARAMS"


@pytest.mark.parametrize("target", ["md", "html", "txt"])
def test_convert_writes_every_text_format(
    target: str, sample_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    output_path = tmp_path / f"out.{target}"
    cli.main(["convert", str(sample_pdf), "-o", str(output_path), "--to", target])
    assert _last_json(capsys)["ocrPages"] == []
    assert "Page 1" in output_path.read_text(encoding="utf-8")
