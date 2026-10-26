from vivepdf.ops._studio_document_models import StudioDocumentPreviewParams
from vivepdf.ops.studio_document import preview_document
from vivepdf.rpc.progress import silent_progress

WORDS = [f"w{number}" for number in range(1400)]


def _preview(html: str, **settings):
    params = StudioDocumentPreviewParams.model_validate({"html": html, "settings": settings})
    return preview_document(params, silent_progress())


def _long_body() -> str:
    paragraphs = [" ".join(WORDS[start : start + 200]) for start in range(0, len(WORDS), 200)]
    return '<h1 id="h-1">Title</h1>' + "".join(
        f'<p id="b-{index + 1}">{text}</p>' for index, text in enumerate(paragraphs)
    )


def test_each_page_starts_with_the_words_that_follow_the_last_page():
    preview = _preview(_long_body())

    pages = {start.page: start.words for start in preview.page_starts}

    assert preview.page_count >= 3
    assert sorted(pages) == list(range(2, preview.page_count + 1))
    first = WORDS.index(pages[2][0])
    assert pages[2] == WORDS[first : first + len(pages[2])]
    assert len(pages[2]) == 8
    assert {block.id for block in preview.block_starts} == {"h-1", *(f"b-{n}" for n in range(1, 8))}
    assert next(block for block in preview.block_starts if block.id == "h-1").page == 1


def test_pages_are_numbered_after_the_cover():
    preview = _preview(_long_body(), cover=True)

    first_block = next(block for block in preview.block_starts if block.id == "h-1")

    assert first_block.page == 2
    assert preview.page_starts[0].page == 3


def test_a_one_page_document_has_no_page_starts_and_ignores_other_ids():
    preview = _preview('<p id="b-0">Short</p><p id="note">Other</p><div class="page-break"></div>')

    assert [block.id for block in preview.block_starts] == ["b-0"]
    assert preview.page_starts == []
