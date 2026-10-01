from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.editor_flowchart import FlowchartSpec, flowchart_pdf, flowchart_preview
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

NODES = [
    ("start", "terminal", "Başla"),
    ("read", "io", "Sayıyı oku"),
    ("check", "decision", "n > 0 mı?"),
    ("yes", "process", "Pozitif yaz"),
    ("no", "process", "Negatif yaz"),
    ("end", "terminal", "Bitir"),
]
EDGES = [
    ("start", "read", ""),
    ("read", "check", ""),
    ("check", "yes", "Evet"),
    ("check", "no", "Hayır"),
    ("yes", "end", ""),
    ("no", "end", ""),
]


def _spec(nodes=NODES, edges=EDGES, **extra) -> FlowchartSpec:
    return FlowchartSpec.model_validate(
        {
            "nodes": [{"id": key, "shape": shape, "text": text} for key, shape, text in nodes],
            "edges": [
                {"source": source, "target": target, "label": label}
                for source, target, label in edges
            ],
            **extra,
        }
    )


def _words(spec: FlowchartSpec) -> dict[str, pymupdf.Rect]:
    document, _ = flowchart_pdf(spec)
    try:
        return {word[4]: pymupdf.Rect(word[:4]) for word in document[0].get_text("words")}
    finally:
        document.close()


def test_steps_follow_each_other_downwards_and_branches_sit_side_by_side():
    words = _words(_spec())
    assert words["Başla"].y1 < words["Sayıyı"].y0 < words["n"].y0
    assert words["Pozitif"].y0 == pytest.approx(words["Negatif"].y0, abs=1)
    assert words["Pozitif"].x1 < words["Negatif"].x0
    assert words["Bitir"].y0 > words["Pozitif"].y1


def test_left_to_right_puts_steps_in_columns():
    words = _words(_spec(direction="right"))
    assert words["Başla"].x1 < words["Sayıyı"].x0 < words["n"].x0 < words["Bitir"].x0
    assert words["Pozitif"].x0 == pytest.approx(words["Negatif"].x0, abs=40)


def test_branch_labels_are_written_as_text_beside_their_arrow():
    words = _words(_spec())
    assert "Evet" in words and "Hayır" in words
    for label in ("Evet", "Hayır"):
        assert not words[label].intersects(words["n"])


def test_a_loop_back_is_routed_outside_the_steps():
    edges = [*EDGES, ("end", "read", "Tekrar")]
    document, _ = flowchart_pdf(_spec(edges=edges))
    try:
        page = document[0]
        words = {word[4]: pymupdf.Rect(word[:4]) for word in page.get_text("words")}
        rightmost_step = max(rect.x1 for text, rect in words.items() if text != "Tekrar")
        lines = [item["rect"] for item in page.get_drawings() if not item.get("fill")]
        assert max(rect.x1 for rect in lines) > rightmost_step
    finally:
        document.close()


def test_every_shape_draws_and_the_arrows_have_heads():
    nodes = [
        ("a", "terminal", "A"),
        ("b", "process", "B"),
        ("c", "decision", "C"),
        ("d", "io", "D"),
        ("e", "connector", "E"),
    ]
    edges = [("a", "b", ""), ("b", "c", ""), ("c", "d", ""), ("d", "e", "")]
    document, _ = flowchart_pdf(_spec(nodes, edges))
    try:
        drawings = document[0].get_drawings()
        filled_heads = [item for item in drawings if item.get("fill") == item.get("color")]
        assert len(filled_heads) == 4
        assert (
            len(
                [
                    item
                    for item in drawings
                    if item.get("fill") and item["fill"] != item.get("color")
                ]
            )
            == 5
        )
    finally:
        document.close()


def test_the_flowchart_is_placed_on_a_page_as_searchable_text(tmp_path: Path):
    source = tmp_path / "akis.pdf"
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    document.save(source)
    document.close()
    target = tmp_path / "out.pdf"
    spec = _spec().model_dump(by_alias=True)
    apply(
        EditorApplyParams(
            path=str(source),
            output=str(target),
            objects=[
                {"kind": "flowchart", "page": 1, "x0": 50, "y0": 50, "x1": 400, "y1": 500, **spec}
            ],
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as saved:
        text = saved[0].get_text()
        for word in ("Başla", "Sayıyı", "Evet", "Hayır", "Bitir"):
            assert word in text


def test_the_preview_is_an_svg_of_the_chart_size():
    result = flowchart_preview(_spec(), silent_progress())
    assert result.svg.startswith("<svg") and result.width > 50 and result.height > 100


@pytest.mark.parametrize(
    "nodes,edges",
    [
        ([("a", "process", "x"), ("a", "process", "y")], []),
        ([("a", "process", "x")], [("a", "b", "")]),
        ([("a", "process", "x")], [("a", "a", "")]),
    ],
)
def test_broken_charts_are_refused(nodes, edges):
    with pytest.raises(ValidationError):
        _spec(nodes, edges)


def test_a_chart_without_text_is_refused():
    with pytest.raises(OpError) as error:
        flowchart_pdf(_spec([("a", "process", " ")], []))
    assert error.value.data == {"reason": "flowchartEmpty"}
