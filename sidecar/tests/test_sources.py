import io
import json
import urllib.error
from email.message import Message
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import sources
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

NATURE_CSL = {
    "type": "article-journal",
    "DOI": "10.1038/nature12373",
    "title": "Nanometre-scale thermometry in a living cell",
    "container-title": "Nature",
    "issued": {"date-parts": [[2013, 7, 31]]},
    "author": [{"family": "Kucsko", "given": "G."}],
}

WAKEFIELD_WORK = {
    "status": "ok",
    "message": {
        "DOI": "10.1016/s0140-6736(97)11096-0",
        "updated-by": [
            {
                "DOI": "10.1016/s0140-6736(04)15715-2",
                "type": "correction",
                "source": "retraction-watch",
                "updated": {"date-parts": [[2004, 3, 6]]},
            },
            {
                "DOI": "10.1016/s0140-6736(10)60175-4",
                "type": "retraction",
                "source": "retraction-watch",
                "updated": {"date-parts": [[2010, 2, 6]]},
            },
        ],
    },
}

PREPRINT_WORK = {
    "status": "ok",
    "message": {
        "DOI": "10.1101/2020.01.01.000001",
        "relation": {"is-preprint-of": [{"id": "10.1000/published.1", "id-type": "doi"}]},
    },
}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def http_error(url: str, code: int, headers: dict[str, str] | None = None):
    message = Message()
    for key, value in (headers or {}).items():
        message[key] = value
    return urllib.error.HTTPError(url, code, "error", message, None)


class FakeOpener:
    def __init__(self, routes):
        self.routes = routes
        self.requests: list[tuple[str, str]] = []

    def open(self, request, timeout):
        url = request.full_url
        self.requests.append((url, request.get_header("Accept")))
        answer = self.routes.get(url)
        if answer is None:
            raise http_error(url, 404)
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, bytes):
            return FakeResponse(answer)
        return FakeResponse(json.dumps(answer).encode())


@pytest.fixture
def opener(monkeypatch):
    fake = FakeOpener({})
    monkeypatch.setattr(sources, "_OPENER", fake)
    monkeypatch.setattr(sources, "REQUEST_INTERVAL", 0)
    return fake


def test_lookup_resolves_a_doi_link_to_csl_json(opener):
    opener.routes["https://doi.org/10.1038/nature12373"] = NATURE_CSL

    result = sources.lookup_doi(
        sources.LookupDoiParams(doi=" https://doi.org/10.1038/nature12373. "), silent_progress()
    )

    assert result.doi == "10.1038/nature12373"
    assert json.loads(result.csl)["container-title"] == "Nature"
    assert opener.requests == [
        ("https://doi.org/10.1038/nature12373", "application/vnd.citationstyles.csl+json")
    ]


def test_lookup_keeps_parentheses_that_belong_to_the_doi(opener):
    opener.routes["https://doi.org/10.1016/S0140-6736(97)11096-0"] = {
        "type": "article",
        "title": "x",
    }

    result = sources.lookup_doi(
        sources.LookupDoiParams(doi="doi:10.1016/S0140-6736(97)11096-0)"), silent_progress()
    )

    assert result.doi == "10.1016/S0140-6736(97)11096-0"


def test_lookup_refuses_text_that_is_not_a_doi(opener):
    with pytest.raises(OpError) as caught:
        sources.lookup_doi(sources.LookupDoiParams(doi="nature article"), silent_progress())

    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "badDoi"}
    assert opener.requests == []


def test_lookup_reports_an_unknown_doi(opener):
    with pytest.raises(OpError) as caught:
        sources.lookup_doi(sources.LookupDoiParams(doi="10.9999/missing"), silent_progress())

    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data["reason"] == "doiNotFound"


def test_lookup_refuses_an_oversized_answer(opener, monkeypatch):
    monkeypatch.setattr(sources, "MAX_RESPONSE_BYTES", 10)
    opener.routes["https://doi.org/10.1038/nature12373"] = NATURE_CSL

    with pytest.raises(OpError) as caught:
        sources.lookup_doi(sources.LookupDoiParams(doi="10.1038/nature12373"), silent_progress())

    assert caught.value.data["reason"] == "doiTooLarge"


def test_lookup_maps_an_unreachable_service_to_offline(opener):
    opener.routes["https://doi.org/10.1038/nature12373"] = urllib.error.URLError("no route")

    with pytest.raises(OpError) as caught:
        sources.lookup_doi(sources.LookupDoiParams(doi="10.1038/nature12373"), silent_progress())

    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data["reason"] == "doiOffline"


def test_redirects_leave_only_for_metadata_hosts():
    handler = sources._AllowlistRedirect()

    with pytest.raises(OpError) as caught:
        handler.redirect_request(None, None, 302, "Found", {}, "https://example.com/steal")

    assert caught.value.data["reason"] == "doiUntrustedHost"
    with pytest.raises(OpError):
        handler.redirect_request(None, None, 302, "Found", {}, "http://api.crossref.org/works/x")


def test_check_flags_a_retracted_source_and_lists_its_notices(opener):
    opener.routes["https://api.crossref.org/works/10.1016/S0140-6736(97)11096-0"] = WAKEFIELD_WORK
    opener.routes["https://api.crossref.org/works/10.1038/nature12373"] = {
        "status": "ok",
        "message": {"DOI": "10.1038/nature12373"},
    }

    result = sources.check_sources(
        sources.CheckSourcesParams(
            dois=["10.1016/S0140-6736(97)11096-0", "10.1038/nature12373", "10.9999/missing"]
        ),
        silent_progress(),
    )

    retracted, clean, missing = result.items
    assert retracted.status == "retracted"
    assert [(notice.type, notice.date) for notice in retracted.notices] == [
        ("correction", "2004-03-06"),
        ("retraction", "2010-02-06"),
    ]
    assert retracted.notices[1].doi == "10.1016/s0140-6736(10)60175-4"
    assert clean.status == "ok"
    assert missing.status == "notFound"


def test_check_points_a_preprint_to_its_published_version(opener):
    opener.routes["https://api.crossref.org/works/10.1101/2020.01.01.000001"] = PREPRINT_WORK

    result = sources.check_sources(
        sources.CheckSourcesParams(dois=["10.1101/2020.01.01.000001"]), silent_progress()
    )

    assert result.items[0].status == "ok"
    assert result.items[0].published_version == "10.1000/published.1"


def test_check_marks_one_failing_answer_and_carries_on(opener):
    opener.routes["https://api.crossref.org/works/10.1000/a"] = http_error("x", 500)
    opener.routes["https://api.crossref.org/works/10.1000/b"] = {"message": {"DOI": "10.1000/b"}}

    result = sources.check_sources(
        sources.CheckSourcesParams(dois=["10.1000/a", "10.1000/b", "not a doi"]),
        silent_progress(),
    )

    assert [item.status for item in result.items] == ["failed", "ok", "notFound"]


def test_check_stops_when_the_network_is_gone(opener):
    opener.routes["https://api.crossref.org/works/10.1000/a"] = urllib.error.URLError("no route")

    with pytest.raises(OpError) as caught:
        sources.check_sources(sources.CheckSourcesParams(dois=["10.1000/a"]), silent_progress())

    assert caught.value.data["reason"] == "doiOffline"


def test_check_waits_once_when_crossref_asks_to_slow_down(opener, monkeypatch):
    waits: list[float] = []
    monkeypatch.setattr(sources.time, "sleep", waits.append)
    calls = {"count": 0}

    class Limited(FakeOpener):
        def open(self, request, timeout):
            calls["count"] += 1
            if calls["count"] == 1:
                raise http_error(request.full_url, 429, {"Retry-After": "2"})
            return FakeResponse(json.dumps({"message": {"DOI": "10.1000/a"}}).encode())

    monkeypatch.setattr(sources, "_OPENER", Limited({}))

    result = sources.check_sources(
        sources.CheckSourcesParams(dois=["10.1000/a"]), silent_progress()
    )

    assert result.items[0].status == "ok"
    assert waits == [2.0]


def test_detect_finds_the_doi_printed_on_the_first_page(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text(
        (50, 60), "Journal of Tests, https://doi.org/10.5555/test.2024.017.", fontsize=9
    )
    document.set_metadata({"title": "Measuring things carefully"})
    path = tmp_path / "paper.pdf"
    document.save(path)
    document.close()

    result = sources.detect_doi(sources.DetectDoiParams(path=str(path)), silent_progress())

    assert result.doi == "10.5555/test.2024.017"
    assert result.title == "Measuring things carefully"


def test_detect_returns_nothing_for_a_pdf_without_a_doi(tmp_path: Path):
    document = pymupdf.open()
    document.new_page().insert_text((50, 60), "Just a letter.")
    path = tmp_path / "letter.pdf"
    document.save(path)
    document.close()

    result = sources.detect_doi(sources.DetectDoiParams(path=str(path)), silent_progress())

    assert result.doi is None
    assert result.title is None


def test_detect_reports_a_missing_file(tmp_path: Path):
    with pytest.raises(OpError) as caught:
        sources.detect_doi(
            sources.DetectDoiParams(path=str(tmp_path / "nope.pdf")), silent_progress()
        )

    assert caught.value.code == ErrorCode.FILE_NOT_FOUND
