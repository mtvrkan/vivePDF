import json
import os
from pathlib import Path

import pytest
import robustness_corpus
import robustness_matrix
import robustness_soak

pytestmark = pytest.mark.robustness_full

WORKERS = int(os.environ.get("VIVEPDF_ROBUSTNESS_WORKERS", str(max(2, (os.cpu_count() or 4) // 2))))
SEED = int(os.environ.get("VIVEPDF_ROBUSTNESS_SEED", str(robustness_corpus.DEFAULT_SEED)))
REAL_DIR = os.environ.get("VIVEPDF_ROBUSTNESS_REAL_DIR")
REPORT = os.environ.get("VIVEPDF_ROBUSTNESS_REPORT")
SOAK_SOURCE = os.environ.get("VIVEPDF_ROBUSTNESS_SOAK_PDF")
SOAK_CALLS = int(os.environ.get("VIVEPDF_ROBUSTNESS_SOAK_CALLS", "200"))
REAL_TIMEOUT = float(os.environ.get("VIVEPDF_ROBUSTNESS_REAL_TIMEOUT", "120"))


def _write_report(outcomes: list[robustness_matrix.Outcome], name: str) -> None:
    if not REPORT:
        return
    target = Path(REPORT) / f"{name}.jsonl"
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        for outcome in outcomes:
            handle.write(
                json.dumps(
                    {
                        "case": outcome.case.label,
                        "status": outcome.status,
                        "code": outcome.code,
                        "slow": outcome.slow,
                        "seconds": round(outcome.seconds, 2),
                        "problems": outcome.problems,
                        "message": outcome.message[:300],
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )


def test_every_path_operation_against_the_whole_corpus(tmp_path_factory: pytest.TempPathFactory):
    fixtures = robustness_matrix.prepare_fixtures(tmp_path_factory.mktemp("full"), SEED)
    names = list(fixtures.variants)
    categories = {name: fixtures.variants[name][0].category for name in names}
    cases = robustness_matrix.full_cases(names, categories)
    outcomes = robustness_matrix.run_matrix(cases, fixtures, workers=WORKERS)
    _write_report(outcomes, "full")
    failures = [outcome for outcome in outcomes if outcome.failed]
    assert not failures, robustness_matrix.summarise(outcomes)


@pytest.mark.skipif(not REAL_DIR, reason="set VIVEPDF_ROBUSTNESS_REAL_DIR to a folder of PDFs")
def test_every_path_operation_against_real_documents(tmp_path_factory: pytest.TempPathFactory):
    root = tmp_path_factory.mktemp("real")
    fixtures = robustness_matrix.prepare_fixtures(root, SEED, names=set())
    documents = robustness_matrix.add_real_documents(fixtures, Path(REAL_DIR))
    cases = robustness_matrix.real_cases(documents)
    outcomes = robustness_matrix.run_matrix(cases, fixtures, workers=WORKERS, timeout=REAL_TIMEOUT)
    _write_report(outcomes, "real")
    failures = [outcome for outcome in outcomes if outcome.failed]
    assert not failures, robustness_matrix.summarise(outcomes)


def test_one_server_process_survives_a_long_mixed_session(tmp_path: Path):
    source = Path(SOAK_SOURCE) if SOAK_SOURCE else tmp_path / "soak source.pdf"
    if not SOAK_SOURCE:
        source.write_bytes(robustness_corpus.pages_document(300, b"[0 0 595 842]"))
    report = robustness_soak.run_soak(source, tmp_path / "soak", SOAK_CALLS)
    assert report.calls == SOAK_CALLS, report.errors
    assert not report.errors, report.errors
    assert not report.locked_files, report.locked_files
    assert report.growth() < robustness_soak.MAX_RESIDENT_GROWTH, [
        value // 1_000_000 for value in report.resident
    ]
