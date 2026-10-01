import json
from pathlib import Path

import pytest

from vivepdf.ops.tts import split_sentences

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "desktop"
    / "src"
    / "shared"
    / "lib"
    / "sentences.fixture.json"
)
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda case: case["text"][:24] or "blank")
def test_split_sentences_matches_the_shared_fixture(case: dict):
    assert split_sentences(case["text"], DATA["maxChars"]) == case["sentences"]
