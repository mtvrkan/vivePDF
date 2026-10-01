import re
from pathlib import Path

import pymupdf

OPS = Path(__file__).resolve().parent.parent / "vivepdf" / "ops"
FONT = str(OPS.parent / "assets" / "fonts" / "DejaVuSans.ttf")


def test_no_op_uses_the_fonttools_subsetter() -> None:
    offenders = [
        f"{path.name}:{number}"
        for path in sorted(OPS.glob("*.py"))
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if re.search(r"subset_fonts\([^)]*fallback\s*=\s*True", line)
    ]
    assert offenders == []


def test_native_subsetting_keeps_every_word_of_a_shared_font(tmp_path: Path) -> None:
    document = pymupdf.open()
    lines = ["Şişli ağaç ılık İzmir", "çöğüş Ünye ıspanak", "Iğdır Çorum Muğla"]
    for text in lines:
        page = document.new_page()
        page.insert_text((72, 72), text, fontsize=14, fontname="dv", fontfile=FONT)
    document.subset_fonts(fallback=False)
    path = tmp_path / "shared.pdf"
    document.save(path, garbage=3, deflate=True)
    document.close()
    with pymupdf.open(path) as reopened:
        assert [page.get_text().strip() for page in reopened] == lines
