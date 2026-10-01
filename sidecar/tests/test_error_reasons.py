import json
import re
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._ranges import PageScope, one_based_to_indices, scope_indices
from vivepdf.ops.analyze import ImposeParams, impose
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

SIDECAR = Path(__file__).resolve().parents[1]
LOCALE = SIDECAR.parent / "apps" / "desktop" / "src" / "locales" / "en" / "common.json"
REASON_LITERALS = (
    re.compile(r'"reason":\s*"([A-Za-z]+)"'),
    re.compile(r'_refusal\(\s*"([A-Za-z]+)"'),
    re.compile(r'_unsafe\(\s*"([A-Za-z]+)"'),
)
UNMAPPED: set[str] = set()


def _raised_reasons() -> set[str]:
    reasons: set[str] = set()
    for path in (SIDECAR / "vivepdf").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for pattern in REASON_LITERALS:
            reasons.update(pattern.findall(text))
    return reasons


def test_every_new_error_reason_has_an_explanation():
    explained = set(json.loads(LOCALE.read_text(encoding="utf-8"))["errors"]["reasons"])
    missing = _raised_reasons() - explained - UNMAPPED
    assert not missing, sorted(missing)


def test_the_unmapped_list_only_holds_reasons_still_raised():
    assert not UNMAPPED - _raised_reasons()


def test_a_page_past_the_end_is_explained():
    with pytest.raises(OpError) as caught:
        one_based_to_indices([4], 3)
    assert caught.value.data == {"reason": "pageOutOfRange", "page": 4, "pageCount": 3}


def test_a_page_choice_that_matches_nothing_is_explained():
    with pytest.raises(OpError) as caught:
        scope_indices(PageScope(kind="every", every=2, start=9), 3)
    assert caught.value.data == {"reason": "noPagesSelected"}


def test_impose_explains_when_nothing_fits(tmp_path: Path):
    document = pymupdf.open()
    document.new_page()
    source = tmp_path / "one.pdf"
    document.save(source)
    document.close()

    with pytest.raises(OpError) as caught:
        impose(
            ImposeParams(
                path=str(source),
                output=str(tmp_path / "sheets.pdf"),
                layout="custom",
                columns=12,
                rows=12,
                margin=70,
                gap=48,
            ),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "noRoom"}
