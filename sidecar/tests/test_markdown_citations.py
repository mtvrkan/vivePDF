import html
import json
import re

from vivepdf.ops._markdown_citations import BIBLIOGRAPHY_BLOCK, split_front_matter, with_citations
from vivepdf.ops._story import markdown_to_html

CITATION = re.compile(r'<span data-citation="([^"]*)"></span>')


def _cited(markdown: str) -> tuple[str, list[list[dict[str, str]]], bool, str]:
    body, cited, title = with_citations(markdown_to_html(markdown))
    found = [json.loads(html.unescape(payload)) for payload in CITATION.findall(body)]
    return body, found, cited, title


def test_pandoc_citation_groups_become_citation_nodes_with_pages():
    markdown = (
        "Heat rises [@smith2020] and more [@smith2020, p. 33].\n\n"
        "See [see @lee:2019, pp. 1-2; @{Brown & Co 2018}] and [-@yılmaz2020, chap. 3]."
    )

    body, found, cited, _ = _cited(markdown)

    assert cited
    assert found == [
        [{"key": "smith2020", "locator": ""}],
        [{"key": "smith2020", "locator": "33"}],
        [{"key": "lee:2019", "locator": "1-2"}, {"key": "Brown & Co 2018", "locator": ""}],
        [{"key": "yılmaz2020", "locator": "chap. 3"}],
    ]
    assert "[@" not in body


def test_links_emails_and_code_keep_their_brackets():
    markdown = (
        "A [link](https://x.org) and [@ref](https://x.org) and [write me@x.com].\n\n"
        "`[@inline]`\n\n```\n[@block]\n```\n"
    )

    body, found, cited, _ = _cited(markdown)

    assert found == []
    assert not cited
    assert "[write me@x.com]" in body
    assert "[@inline]" in body
    assert "[@block]" in body
    assert BIBLIOGRAPHY_BLOCK not in body


def test_the_reference_list_replaces_a_trailing_references_heading_or_follows_the_text():
    with_heading, _, _, title = _cited("Text [@a].\n\n# Kaynakça\n")
    with_section, _, _, kept = _cited("Text [@a].\n\n# Conclusion\n")
    with_div, _, _, _ = _cited('Text [@a].\n\n<div id="refs"></div>\n\nAppendix.\n')

    assert title == "Kaynakça"
    assert with_heading.endswith(BIBLIOGRAPHY_BLOCK)
    assert "<h1>Kaynakça</h1>" not in with_heading
    assert kept == ""
    assert with_section.endswith("<h1>Conclusion</h1>\n" + BIBLIOGRAPHY_BLOCK)
    assert with_div.index(BIBLIOGRAPHY_BLOCK) < with_div.index("Appendix.")


def test_front_matter_gives_title_authors_date_and_bibliography_files():
    text = (
        "---\n"
        'title: "İstanbul Isı Adaları"\n'
        "author:\n  - name: Ayşe Yılmaz\n    affiliation: X\n  - Mehmet Doğan\n"
        "date: 2026-10-09\n"
        "bibliography: [refs.bib, extra.bib]\n"
        "abstract: |\n  Long text\n  over lines\n"
        "---\n# Body\n"
    )

    meta, rest = split_front_matter(text)

    assert meta.first("title", 300) == "İstanbul Isı Adaları"
    assert meta.joined("author", 300) == "Ayşe Yılmaz, Mehmet Doğan"
    assert meta.first("date", 80) == "2026-10-09"
    assert meta.values["bibliography"] == ["refs.bib", "extra.bib"]
    assert rest == "# Body\n"


def test_a_leading_rule_that_is_not_front_matter_stays_in_the_text():
    text = "---\nJust a paragraph between rules.\n---\nMore\n"

    meta, rest = split_front_matter(text)

    assert meta.values == {}
    assert rest == text
