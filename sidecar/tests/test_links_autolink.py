from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.links import AutoLinkParams, autolink, link_targets
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _document(tmp_path: Path, lines: list[str], rotation: int = 0) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, line in enumerate(lines):
        page.insert_text((72, 100 + index * 30), line, fontsize=12)
    page.set_rotation(rotation)
    path = tmp_path / "links.pdf"
    document.save(path)
    document.close()
    return path


def _uris(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [link.get("uri") for page in document for link in page.get_links()]


def test_web_and_mail_addresses_become_links_over_their_own_text(tmp_path: Path):
    source = _document(
        tmp_path,
        ["Visit https://example.com/docs, or www.vivepdf.org.", "Write to info@example.com."],
    )
    target = tmp_path / "linked.pdf"
    result = autolink(AutoLinkParams(path=str(source), output=str(target)), silent_progress())
    assert result.added == 3
    assert result.pages_changed == 1
    assert _uris(target) == [
        "https://example.com/docs",
        "https://www.vivepdf.org",
        "mailto:info@example.com",
    ]
    with pymupdf.open(target) as document:
        page = document[0]
        first = pymupdf.Rect(page.get_links()[0]["from"])
        assert page.get_textbox(first + (0, 0, 0, 0)).strip() == "https://example.com/docs"


def test_existing_links_are_kept_and_the_choice_limits_the_kinds(tmp_path: Path):
    source = _document(tmp_path, ["https://example.com and a@b.org"], rotation=90)
    first = tmp_path / "first.pdf"
    autolink(AutoLinkParams(path=str(source), output=str(first), emails=False), silent_progress())
    assert _uris(first) == ["https://example.com"]
    second = tmp_path / "second.pdf"
    result = autolink(AutoLinkParams(path=str(first), output=str(second)), silent_progress())
    assert result.added == 1
    assert sorted(_uris(second)) == ["https://example.com", "mailto:a@b.org"]


def test_a_document_without_addresses_is_refused(tmp_path: Path):
    source = _document(tmp_path, ["No addresses here, only file.pdf and http:// alone."])
    with pytest.raises(OpError) as caught:
        autolink(
            AutoLinkParams(path=str(source), output=str(tmp_path / "x.pdf")), silent_progress()
        )
    assert caught.value.data == {"reason": "nothingToLink"}
    with pytest.raises(OpError):
        autolink(
            AutoLinkParams(
                path=str(source), output=str(tmp_path / "y.pdf"), urls=False, emails=False
            ),
            silent_progress(),
        )


def test_trailing_punctuation_and_unbalanced_brackets_are_left_out():
    assert link_targets("(https://example.com/a_(b)).", True, True) == [
        ("https://example.com/a_(b)", "https://example.com/a_(b)")
    ]
    assert link_targets("https://localhost", True, True) == []
