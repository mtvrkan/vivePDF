import sys
import textwrap
import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.external import verapdf
from vivepdf.ops import pdfa_validate
from vivepdf.ops.pdfa_validate import (
    PdfaValidateParams,
    PdfaValidatorParams,
    validate,
    validator,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

FAILING_REPORT = """<?xml version="1.0" encoding="utf-8"?>
<report>
  <buildInformation><releaseDetails id="core" version="1.26.1"/></buildInformation>
  <jobs><job><item size="1000"><name>input.pdf</name></item>
    <validationReport jobEndStatus="normal" profileName="PDF/A-2B validation profile"
        statement="PDF file is not compliant" isCompliant="false">
      <details passedRules="140" failedRules="2" passedChecks="900" failedChecks="5">
        <rule specification="ISO 19005-2:2011" clause="6.2.4.3" testNumber="2"
            status="failed" failedChecks="4">
          <description>DeviceRGB shall only be used with an RGB output intent</description>
          <check status="failed"><context>root/document[0]/pages[0]</context></check>
        </rule>
        <rule specification="ISO 19005-2:2011" clause="6.6.2.1" testNumber="1"
            status="failed" failedChecks="1">
          <description>The catalog shall contain a Metadata key</description>
        </rule>
        <rule specification="ISO 19005-2:2011" clause="6.1.2" testNumber="1"
            status="passed" passedChecks="1">
          <description>Header</description>
        </rule>
      </details>
    </validationReport>
  </job></jobs>
</report>
"""
PASSING_REPORT = """<report><jobs><job>
<validationReport profileName="PDF/A-1B validation profile" isCompliant="true">
<details passedRules="120" failedRules="0" passedChecks="400" failedChecks="0"/>
</validationReport></job></jobs></report>"""


@pytest.fixture
def pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Validate me", fontname="helv")
    path = tmp_path / "source file.pdf"
    document.save(path)
    document.close()
    return path


def _fake_launcher(tmp_path: Path, monkeypatch, body: str) -> Path:
    script = tmp_path / "fake_verapdf.py"
    script.write_text(
        "import sys, time\nfrom pathlib import Path\n" + textwrap.dedent(body), "utf-8"
    )
    monkeypatch.setattr(verapdf, "launch_command", lambda _launcher: [sys.executable, str(script)])
    return script


def test_the_report_lists_failed_rules_only():
    report = verapdf.parse_report("WARNING: stray line\n" + FAILING_REPORT)
    assert not report.compliant
    assert report.failed_rules == 2
    assert report.failed_checks == 5
    assert [(rule.clause, rule.test_number) for rule in report.rules] == [
        ("6.2.4.3", "2"),
        ("6.6.2.1", "1"),
    ]
    assert report.rules[0].failed_checks == 4
    assert report.rules[0].description.startswith("DeviceRGB")


def test_a_compliant_report_has_no_rules():
    report = verapdf.parse_report(PASSING_REPORT)
    assert report.compliant
    assert report.rules == []


def test_a_report_without_a_validation_result_is_an_error():
    with pytest.raises(OpError) as raised:
        verapdf.parse_report(
            "<report><jobs><job><taskException><exceptionMessage>Broken file"
            "</exceptionMessage></taskException></job></jobs></report>"
        )
    assert raised.value.code == ErrorCode.EXTERNAL_TOOL_FAILED
    assert raised.value.data["reason"] == "noReport"
    with pytest.raises(OpError):
        verapdf.parse_report("no xml at all")


def test_validation_runs_on_a_safe_copy(pdf: Path, tmp_path: Path, monkeypatch):
    seen = tmp_path / "seen.txt"
    _fake_launcher(
        tmp_path,
        monkeypatch,
        f"""
        Path({str(seen)!r}).write_text(" ".join(sys.argv[1:]) + "|" + str(Path.cwd()))
        assert Path("input.pdf").read_bytes().startswith(b"%PDF")
        sys.stdout.write({FAILING_REPORT!r})
        sys.exit(1)
        """,
    )
    report = verapdf.validate(Path("verapdf"), pdf, "2b", lambda: None)
    assert not report.compliant
    arguments, folder = seen.read_text().split("|")
    assert arguments == "--format mrr --flavour 2b input.pdf"
    assert "vivepdf-verapdf-" in folder
    assert not Path(folder).exists()


def test_an_unknown_level_is_refused(pdf: Path, tmp_path: Path, monkeypatch):
    _fake_launcher(tmp_path, monkeypatch, "sys.stdout.write('<report/>')")
    with pytest.raises(OpError) as raised:
        verapdf.validate(Path("verapdf"), pdf, "2b & calc", lambda: None)
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_an_empty_answer_reports_the_error_output(pdf: Path, tmp_path: Path, monkeypatch):
    _fake_launcher(tmp_path, monkeypatch, "sys.stderr.write('java missing')\nsys.exit(3)")
    with pytest.raises(OpError) as raised:
        verapdf.validate(Path("verapdf"), pdf, "2b", lambda: None)
    assert raised.value.data["exitCode"] == 3
    assert "java missing" in raised.value.data["detail"]


def test_cancelling_stops_the_validator(pdf: Path, tmp_path: Path, monkeypatch):
    _fake_launcher(tmp_path, monkeypatch, "time.sleep(30)")
    stop = threading.Event()
    progress = Progress(lambda _value, _message, _detail: None, stop)
    threading.Timer(0.5, stop.set).start()
    with pytest.raises(OpError) as raised:
        verapdf.validate(Path("verapdf"), pdf, "2b", progress.check_cancelled)
    assert raised.value.code == ErrorCode.CANCELLED


def test_a_slow_validator_times_out(pdf: Path, tmp_path: Path, monkeypatch):
    _fake_launcher(tmp_path, monkeypatch, "time.sleep(30)")
    with pytest.raises(OpError) as raised:
        verapdf.validate(Path("verapdf"), pdf, "2b", lambda: None, timeout=0.5)
    assert raised.value.data["reason"] == "timeout"


@pytest.mark.skipif(sys.platform != "win32", reason="batch launchers exist only on Windows")
def test_a_batch_launcher_in_an_unsafe_folder_is_refused():
    with pytest.raises(OpError) as raised:
        verapdf.launch_command(Path(r"C:\Program Files (x86)\veraPDF\verapdf.bat"))
    assert raised.value.data["reason"] == "veraPdfPath"
    assert verapdf.launch_command(Path(r"C:\Users\Mehmet Türkan\verapdf\verapdf.bat")) == [
        r"C:\Users\Mehmet Türkan\verapdf\verapdf.bat"
    ]


@pytest.mark.skipif(sys.platform != "win32", reason="batch launchers exist only on Windows")
def test_a_real_batch_launcher_in_a_folder_with_spaces_runs(pdf: Path, tmp_path: Path):
    folder = tmp_path / "vera pdf"
    folder.mkdir()
    report = folder / "report.xml"
    report.write_text(PASSING_REPORT, encoding="utf-8")
    launcher = folder / "verapdf.bat"
    launcher.write_text(f'@echo off\r\ntype "{report}"\r\n', encoding="utf-8")
    result = verapdf.validate(launcher, pdf, "1b", lambda: None)
    assert result.compliant


def test_the_validator_op_reports_a_missing_install(monkeypatch):
    monkeypatch.setattr(verapdf, "find_verapdf", lambda: None)
    result = validator(PdfaValidatorParams(), silent_progress())
    assert not result.available
    assert result.version is None


def test_the_validator_op_reads_the_version(tmp_path: Path, monkeypatch):
    launcher = tmp_path / "verapdf"
    launcher.write_text("", encoding="utf-8")
    monkeypatch.setattr(verapdf, "find_verapdf", lambda: launcher)
    _fake_launcher(tmp_path, monkeypatch, "print('veraPDF 1.26.2\\nBuilt: 2025')")
    result = validator(PdfaValidatorParams(), silent_progress())
    assert result.available
    assert result.version == "1.26.2"


def test_validate_needs_verapdf(pdf: Path, monkeypatch):
    monkeypatch.setattr(verapdf, "find_verapdf", lambda: None)
    with pytest.raises(OpError) as raised:
        validate(PdfaValidateParams(path=str(pdf)), silent_progress())
    assert raised.value.code == ErrorCode.UNSUPPORTED
    assert raised.value.data["reason"] == "veraPdfMissing"


def test_validate_returns_the_failed_rules(pdf: Path, tmp_path: Path, monkeypatch):
    launcher = tmp_path / "verapdf"
    launcher.write_text("", encoding="utf-8")
    monkeypatch.setattr(verapdf, "find_verapdf", lambda: launcher)
    monkeypatch.setattr(pdfa_validate, "_versions", {})
    monkeypatch.setattr(verapdf, "MAX_RULES", 1)
    _fake_launcher(tmp_path, monkeypatch, f"sys.stdout.write({FAILING_REPORT!r})")
    result = validate(PdfaValidateParams(path=str(pdf), level="2b"), silent_progress())
    assert not result.compliant
    assert result.failed_rules == 2
    assert [rule.clause for rule in result.rules] == ["6.2.4.3"]
    assert result.truncated


def test_validate_refuses_a_missing_file(tmp_path: Path):
    with pytest.raises(OpError) as raised:
        validate(PdfaValidateParams(path=str(tmp_path / "gone.pdf")), silent_progress())
    assert raised.value.code == ErrorCode.FILE_NOT_FOUND
