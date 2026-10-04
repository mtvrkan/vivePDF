import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from vivepdf.ops import studio_draft
from vivepdf.ops.studio_draft import (
    StudioDraftLoadParams,
    StudioDraftSaveParams,
    draft_path,
    load_draft,
    save_draft,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

DESIGN = {
    "version": 1,
    "kind": "design",
    "name": "Şehir afişi",
    "palette": [],
    "pages": [{"id": "p1", "width": 595, "height": 842, "elements": []}],
}


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "data"
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(folder))
    return folder


def _save(design: dict, file_path: str | None = None):
    params = StudioDraftSaveParams.model_validate({"design": design, "filePath": file_path})
    return save_draft(params, silent_progress())


def _load():
    return load_draft(StudioDraftLoadParams(), silent_progress())


def test_a_saved_draft_loads_back_with_its_project_path(data_dir: Path):
    saved = _save(DESIGN, "C:/designs/afiş.vivedesign")

    loaded = _load()

    assert loaded.found is True
    assert loaded.design == DESIGN
    assert loaded.file_path == "C:/designs/afiş.vivedesign"
    assert loaded.saved_at == saved.saved_at
    assert draft_path().parent.parent == data_dir
    assert draft_path().stat().st_size == saved.bytes
    assert not [path for path in draft_path().parent.iterdir() if path.suffix == ".part"]


def test_a_new_draft_replaces_the_previous_one():
    _save(DESIGN, "C:/old.vivedesign")
    renamed = {**DESIGN, "name": "Second"}

    _save(renamed)

    loaded = _load()
    assert loaded.design["name"] == "Second"
    assert loaded.file_path is None


def test_no_draft_and_broken_drafts_read_as_not_found():
    assert _load().found is False
    draft_path().write_text("{not json", encoding="utf-8")
    assert _load().found is False
    draft_path().write_text(json.dumps({"format": "other", "design": DESIGN}), encoding="utf-8")
    assert _load().found is False
    newer = {"format": "vivedraft", "version": 99, "design": DESIGN}
    draft_path().write_text(json.dumps(newer), encoding="utf-8")
    assert _load().found is False


def test_an_oversized_draft_is_refused_and_keeps_the_last_one(monkeypatch: pytest.MonkeyPatch):
    _save(DESIGN)
    monkeypatch.setattr(studio_draft, "MAX_DRAFT_BYTES", 400)
    big = {**DESIGN, "name": "x" * 1000}

    with pytest.raises(OpError) as caught:
        _save(big)

    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "draftTooLarge", "limit": 400}
    assert _load().design == DESIGN


def test_something_that_is_not_a_design_is_refused():
    with pytest.raises(OpError) as caught:
        _save({"kind": "document", "pages": []})
    assert caught.value.data == {"reason": "notDesign"}
    with pytest.raises(ValidationError):
        StudioDraftSaveParams.model_validate({"design": DESIGN, "filePath": "x" * 5000})
    with pytest.raises(ValidationError):
        StudioDraftSaveParams.model_validate({"design": DESIGN, "unknown": 1})
