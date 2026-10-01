import ast
import hashlib
import importlib.util
from importlib.metadata import version
from pathlib import Path

import pytest

PINNED = {"pdf2docx": "0.5.13", "python-docx": "1.2.0", "pyhanko": "0.37.0"}

PATCHED_SOURCES = {
    ("pdf2docx.table.TableBlock", "TableBlock.make_docx"): "71af5561fbb330c4",
    ("pdf2docx.shape.Shapes", "Shapes.text_style_shapes"): "36da1335f67208fd",
    ("pdf2docx.common.algorithm", "inner_contours"): "74d84bb3661d0d31",
    ("pdf2docx.image.ImagesExtractor", "ImagesExtractor.detect_svg_contours"): "08b3435057261603",
    ("pdf2docx.font.Fonts", "Fonts.extract"): "02ff44f6286d4cd0",
    ("docx.table", "Table._cells"): "dd6744ab40e85bb1",
    ("docx.table", "_Cell.merge"): "309ba540a34fadc7",
    (
        "pyhanko.pdf_utils.incremental_writer",
        "IncrementalPdfFileWriter.__init__",
    ): "3072255e5d2483c5",
    (
        "pyhanko.pdf_utils.incremental_writer",
        "IncrementalPdfFileWriter.encrypt",
    ): "fcd63f09b99ed324",
    ("pyhanko.pdf_utils.writer", "BasePdfFileWriter._write_objects"): "687a73f4cab92436",
    ("pyhanko.pdf_utils.writer", "BasePdfFileWriter._populate_trailer"): "d84ac3c554ecf2bd",
    ("pyhanko.pdf_utils.font.opentype", "GlyphAccumulator._get_cid_and_width"): "e577276c4f078ab6",
    ("pyhanko.pdf_utils.font.opentype", "_build_type0_font_from_cidfont"): "1e0c87c9d33e189b",
}


def _definition(tree: ast.Module, qualified: str) -> ast.AST:
    scope: list[ast.stmt] = tree.body
    found: ast.AST | None = None
    for name in qualified.split("."):
        found = next(
            node
            for node in scope
            if isinstance(node, ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef)
            and node.name == name
        )
        scope = found.body
    assert found is not None
    return found


def upstream_digest(module: str, qualified: str) -> str:
    spec = importlib.util.find_spec(module)
    assert spec is not None and spec.origin is not None
    text = Path(spec.origin).read_text(encoding="utf-8").replace("\r\n", "\n")
    segment = ast.get_source_segment(text, _definition(ast.parse(text), qualified))
    assert segment is not None
    return hashlib.sha256(segment.encode("utf-8")).hexdigest()[:16]


@pytest.mark.parametrize(("distribution", "expected"), sorted(PINNED.items()))
def test_patched_libraries_are_the_pinned_versions(distribution: str, expected: str) -> None:
    assert version(distribution) == expected, (
        f"{distribution} changed; re-check the in-process patches that PATCHED_SOURCES points at "
        "and update PINNED and PATCHED_SOURCES in this file"
    )


@pytest.mark.parametrize(("module", "qualified"), sorted(PATCHED_SOURCES))
def test_patched_upstream_code_is_unchanged(module: str, qualified: str) -> None:
    assert upstream_digest(module, qualified) == PATCHED_SOURCES[(module, qualified)], (
        f"{module}.{qualified} changed upstream; the vivePDF patch that relies on it must be "
        "re-checked before PATCHED_SOURCES is updated"
    )
