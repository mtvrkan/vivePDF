from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.comments import (
    CommentsDeleteParams,
    CommentsExportParams,
    CommentsListParams,
    CommentsUpdateParams,
    delete_comments,
    export_comments,
    list_comments,
    set_resolved,
)
from vivepdf.ops.comments_xfdf import CommentsImportParams, import_comments
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def discussed_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    note = page.add_text_annot((300, 300), "Rakamlar doğru mu?")
    note.set_info(title="Ayşe", subject="Soru")
    note.update()
    box = page.add_rect_annot(pymupdf.Rect(100, 100, 200, 200))
    box.set_info(title="Can", content="Kutu")
    box.update()
    reply = page.add_text_annot((320, 320), "Evet, kontrol ettim")
    reply.set_info(title="Mehmet")
    reply.update()
    document.xref_set_key(reply.xref, "IRT", f"{note.xref} 0 R")
    path = tmp_path / "discussed.pdf"
    document.save(path)
    document.close()
    return path


def _items(path: Path):
    return list_comments(CommentsListParams(path=str(path)), silent_progress()).items


def _resolve(path: Path, xref: int, resolved: bool, author: str | None = None) -> int:
    params = CommentsUpdateParams(path=str(path), xrefs=[xref], resolved=resolved, author=author)
    return set_resolved(params, silent_progress()).changed


def _state_replies(path: Path) -> list[dict]:
    document = pymupdf.open(path)
    found = []
    for page in document:
        for xref, _kind, _name in page.annot_xrefs():
            if document.xref_get_key(xref, "StateModel")[0] == "string":
                found.append(
                    {
                        "parent": int(document.xref_get_key(xref, "IRT")[1].split()[0]),
                        "state": document.xref_get_key(xref, "State")[1],
                        "author": document.xref_get_key(xref, "T")[1],
                        "flags": int(document.xref_get_key(xref, "F")[1]),
                    }
                )
    document.close()
    return found


def test_resolving_adds_a_hidden_review_state_and_keeps_the_subject(discussed_pdf: Path) -> None:
    note = _items(discussed_pdf)[0]
    assert _resolve(discussed_pdf, note.xref, True, "  Deniz  ") == 1
    items = _items(discussed_pdf)
    assert [item.content for item in items] == ["Rakamlar doğru mu?", "Kutu", "Evet, kontrol ettim"]
    assert items[0].resolved is True and items[0].subject == "Soru"
    assert not items[1].resolved
    [state] = _state_replies(discussed_pdf)
    assert state == {"parent": note.xref, "state": "Completed", "author": "Deniz", "flags": 30}


def test_reopening_records_a_new_state_and_clears_an_old_resolved_subject(
    discussed_pdf: Path,
) -> None:
    note, box, _reply = _items(discussed_pdf)
    _resolve(discussed_pdf, note.xref, True)
    _resolve(discussed_pdf, note.xref, False)
    assert not _items(discussed_pdf)[0].resolved
    assert [state["state"] for state in _state_replies(discussed_pdf)] == ["Completed", "None"]
    document = pymupdf.open(discussed_pdf)
    document.xref_set_key(box.xref, "Subj", pymupdf.get_pdf_str("Resolved"))
    document.saveIncr()
    document.close()
    assert _items(discussed_pdf)[1].resolved is True
    _resolve(discussed_pdf, box.xref, False)
    reopened = _items(discussed_pdf)[1]
    assert not reopened.resolved and reopened.subject == ""


def test_states_written_by_other_viewers_are_read_and_not_listed(discussed_pdf: Path) -> None:
    document = pymupdf.open(discussed_pdf)
    page = document[0]
    note = next(annot for annot in page.annots() if annot.info["title"] == "Ayşe")
    state = page.add_text_annot((300, 300), "")
    document.xref_set_key(state.xref, "IRT", f"{note.xref} 0 R")
    document.xref_set_key(state.xref, "State", pymupdf.get_pdf_str("Completed"))
    document.xref_set_key(state.xref, "StateModel", pymupdf.get_pdf_str("Review"))
    document.saveIncr()
    document.close()
    items = _items(discussed_pdf)
    assert len(items) == 3
    assert items[0].resolved is True


def test_resolving_an_already_resolved_comment_adds_nothing(discussed_pdf: Path) -> None:
    note = _items(discussed_pdf)[0]
    _resolve(discussed_pdf, note.xref, True)
    _resolve(discussed_pdf, note.xref, True)
    assert len(_state_replies(discussed_pdf)) == 1


def test_deleting_a_comment_also_removes_its_replies_and_states(discussed_pdf: Path) -> None:
    note, box, reply = _items(discussed_pdf)
    _resolve(discussed_pdf, note.xref, True)
    document = pymupdf.open(discussed_pdf)
    answer = document[0].add_text_annot((340, 340), "Teşekkürler")
    document.xref_set_key(answer.xref, "IRT", f"{reply.xref} 0 R")
    document.saveIncr()
    document.close()
    changed = delete_comments(
        CommentsDeleteParams(path=str(discussed_pdf), xrefs=[note.xref]), silent_progress()
    ).changed
    assert changed == 1
    assert [item.xref for item in _items(discussed_pdf)] == [box.xref]
    assert _state_replies(discussed_pdf) == []


def test_resolved_state_travels_through_xfdf(discussed_pdf: Path, tmp_path: Path) -> None:
    note = _items(discussed_pdf)[0]
    _resolve(discussed_pdf, note.xref, True, "Deniz")
    exported = export_comments(
        CommentsExportParams(
            path=str(discussed_pdf), output=str(tmp_path / "notes.xfdf"), format="xfdf"
        ),
        silent_progress(),
    )
    assert exported.count == 3
    text = Path(exported.output).read_text(encoding="utf-8")
    assert 'state="Completed"' in text and 'statemodel="Review"' in text
    blank = pymupdf.open()
    blank.new_page(width=595, height=842)
    clean = tmp_path / "clean.pdf"
    blank.save(clean)
    blank.close()
    imported = import_comments(
        CommentsImportParams(
            path=str(clean), source=exported.output, output=str(tmp_path / "imported.pdf")
        ),
        silent_progress(),
    )
    assert imported.imported == 4
    items = _items(Path(imported.output))
    assert [item.resolved for item in items] == [True, False, False]
    assert [state["state"] for state in _state_replies(Path(imported.output))] == ["Completed"]
