from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.comments import (
    CommentsDeleteParams,
    CommentsListParams,
    CommentsReplyParams,
    CommentsStateParams,
    delete_comments,
    list_comments,
    reply,
    set_state,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def commented_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    note = page.add_text_annot((300, 300), "Is this figure right?")
    note.set_info(title="Ayşe")
    note.update()
    marked = page.add_highlight_annot(pymupdf.Rect(72, 72, 200, 90))
    marked.set_info(title="Can", subject="Resolved")
    marked.update()
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": pymupdf.Rect(10, 10, 50, 20),
            "uri": "https://example.com",
        }
    )
    path = tmp_path / "commented.pdf"
    document.save(path)
    document.close()
    return path


def _items(path: Path) -> dict:
    items = list_comments(CommentsListParams(path=str(path)), silent_progress()).items
    return {item.content or item.type: item for item in items}


def _reply(path: Path, xref: int, content: str, author: str | None = "Mehmet") -> int:
    params = CommentsReplyParams(path=str(path), xref=xref, content=content, author=author)
    return reply(params, silent_progress()).xref


def _state(path: Path, xref: int, state: str) -> int:
    params = CommentsStateParams(path=str(path), xrefs=[xref], state=state, author="Mehmet")
    return set_state(params, silent_progress()).changed


def test_a_reply_is_listed_under_its_comment_with_author_and_text(commented_pdf: Path):
    parent = _items(commented_pdf)["Is this figure right?"]
    created = _reply(commented_pdf, parent.xref, "  Yes, checked it  ")
    items = _items(commented_pdf)
    answer = items["Yes, checked it"]
    assert answer.xref == created
    assert answer.parent == parent.xref
    assert answer.author == "Mehmet"
    assert answer.page == parent.page
    assert items["Is this figure right?"].parent is None


def test_a_reply_keeps_acrobats_reply_flags_and_the_parents_place(commented_pdf: Path):
    parent = _items(commented_pdf)["Is this figure right?"]
    created = _reply(commented_pdf, parent.xref, "Looks fine", author=None)
    with pymupdf.open(commented_pdf) as document:
        assert document.xref_get_key(created, "IRT")[1] == f"{parent.xref} 0 R"
        assert document.xref_get_key(created, "F")[1] == "28"
        assert document.xref_get_key(created, "Rect") == document.xref_get_key(parent.xref, "Rect")
        assert document.xref_get_key(created, "T")[0] == "null"


def test_replying_to_a_reply_builds_a_thread_and_deleting_the_root_removes_it(commented_pdf: Path):
    parent = _items(commented_pdf)["Is this figure right?"]
    first = _reply(commented_pdf, parent.xref, "First answer")
    _reply(commented_pdf, first, "Answer to the answer")
    assert _items(commented_pdf)["Answer to the answer"].parent == first
    delete_comments(
        CommentsDeleteParams(path=str(commented_pdf), xrefs=[parent.xref]), silent_progress()
    )
    assert set(_items(commented_pdf)) == {"Highlight"}


def test_review_states_are_listed_and_the_latest_wins(commented_pdf: Path):
    parent = _items(commented_pdf)["Is this figure right?"]
    assert parent.state is None
    assert _state(commented_pdf, parent.xref, "Accepted") == 1
    assert _items(commented_pdf)["Is this figure right?"].state == "Accepted"
    assert _state(commented_pdf, parent.xref, "Rejected") == 1
    item = _items(commented_pdf)["Is this figure right?"]
    assert (item.state, item.resolved) == ("Rejected", False)
    assert _state(commented_pdf, parent.xref, "Completed") == 1
    item = _items(commented_pdf)["Is this figure right?"]
    assert (item.state, item.resolved) == ("Completed", True)
    assert _state(commented_pdf, parent.xref, "None") == 1
    assert _items(commented_pdf)["Is this figure right?"].state is None


def test_setting_the_same_state_again_changes_nothing(commented_pdf: Path):
    parent = _items(commented_pdf)["Is this figure right?"]
    _state(commented_pdf, parent.xref, "Cancelled")
    size = commented_pdf.stat().st_size
    assert _state(commented_pdf, parent.xref, "Cancelled") == 1
    assert commented_pdf.stat().st_size == size


def test_an_old_resolved_subject_reads_as_completed_and_clears_on_a_new_state(commented_pdf: Path):
    marked = _items(commented_pdf)["Highlight"]
    assert (marked.state, marked.resolved) == ("Completed", True)
    _state(commented_pdf, marked.xref, "Accepted")
    marked = _items(commented_pdf)["Highlight"]
    assert (marked.state, marked.subject, marked.resolved) == ("Accepted", "", False)


def test_an_empty_reply_is_refused(commented_pdf: Path):
    parent = _items(commented_pdf)["Is this figure right?"]
    with pytest.raises(OpError) as caught:
        _reply(commented_pdf, parent.xref, "   ")
    assert caught.value.data == {"reason": "emptyReply"}
    with pytest.raises(ValidationError):
        CommentsReplyParams(path=str(commented_pdf), xref=parent.xref, content="")


def test_a_reply_to_something_that_is_not_a_comment_is_refused(commented_pdf: Path):
    parent = _items(commented_pdf)["Is this figure right?"]
    _state(commented_pdf, parent.xref, "Accepted")
    with pymupdf.open(commented_pdf) as document:
        state_xref = next(
            xref
            for xref, _kind, _name in document[0].annot_xrefs()
            if document.xref_get_key(xref, "StateModel")[0] == "string"
        )
        link_xref = next(
            xref
            for xref, kind, _name in document[0].annot_xrefs()
            if kind == pymupdf.PDF_ANNOT_LINK
        )
    with pytest.raises(OpError) as caught:
        _reply(commented_pdf, state_xref, "Hello")
    assert caught.value.data == {"reason": "notAComment"}
    for missing in (link_xref, 99999):
        with pytest.raises(OpError) as caught:
            _reply(commented_pdf, missing, "Hello")
        assert caught.value.data["reason"] == "commentNotFound"


def test_an_unknown_state_is_refused_by_the_parameters(commented_pdf: Path):
    with pytest.raises(ValidationError):
        CommentsStateParams(path=str(commented_pdf), xrefs=[1], state="Maybe")
