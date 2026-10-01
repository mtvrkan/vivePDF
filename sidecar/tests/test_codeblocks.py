from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.codeblocks import CodeBlocksParams, code_blocks, guess_language
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

CODE_LINES = [
    "def greet(name):",
    "    if name:",
    "        print(name)",
    "    return name",
]


@pytest.fixture
def code_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 80), "Listing 1 shows a small function.", fontsize=11, fontname="helv")
    y = 120
    for line in CODE_LINES:
        page.insert_text((72, y), line, fontsize=10, fontname="cour")
        y += 13
    page.insert_text(
        (72, 240), "Body text continues after the listing.", fontsize=11, fontname="helv"
    )
    path = tmp_path / "code.pdf"
    document.save(path)
    document.close()
    return path


def test_code_blocks_keep_indentation(code_pdf: Path) -> None:
    result = code_blocks(CodeBlocksParams(path=str(code_pdf), page=0), silent_progress())
    assert len(result.blocks) == 1
    block = result.blocks[0]
    assert block.lines == CODE_LINES
    assert block.language == "python"
    assert block.bbox[1] < block.bbox[3]


def test_code_blocks_rect_filter(code_pdf: Path) -> None:
    result = code_blocks(
        CodeBlocksParams(path=str(code_pdf), page=0, rect=[0, 0, 600, 60]), silent_progress()
    )
    assert result.blocks == []


def test_code_blocks_page_out_of_range(code_pdf: Path) -> None:
    with pytest.raises(OpError) as error:
        code_blocks(CodeBlocksParams(path=str(code_pdf), page=5), silent_progress())
    assert error.value.code == ErrorCode.INVALID_PARAMS


def test_guess_language_needs_two_hits() -> None:
    assert guess_language(["SELECT id FROM users", "WHERE id = 1"]) == "sql"
    assert guess_language(["hello world"]) is None
