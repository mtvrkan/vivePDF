import http.client
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Literal

from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.paths import ReadPath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

DOI_RESOLVER = "https://doi.org/"
CROSSREF_WORKS = "https://api.crossref.org/works/"
CSL_ACCEPT = "application/vnd.citationstyles.csl+json"
JSON_ACCEPT = "application/json"
USER_AGENT = "vivePDF (https://github.com/mtvrkan/vivePDF)"
ALLOWED_HOSTS = frozenset(
    {
        "doi.org",
        "api.crossref.org",
        "data.crossref.org",
        "api.datacite.org",
        "data.datacite.org",
        "data.crosscite.org",
        "data.medra.org",
        "data.jalc.org",
    }
)
REQUEST_TIMEOUT = 10.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_DOIS = 500
REQUEST_INTERVAL = 0.2
MAX_RETRY_WAIT = 5.0
DETECT_PAGES = 2
DOI_SAFE = "/()._-;:<>[]+"
DOI_SHAPE = re.compile(r"^10\.\d{4,9}/\S{1,300}$")
DOI_IN_TEXT = re.compile(r"\b10\.\d{4,9}/[^\s\"'<>]{1,300}")
DOI_PREFIX = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)
TRAILING_PUNCTUATION = ".,;:'\""
RETRACTED = frozenset({"retraction", "partial_retraction", "removal"})
WITHDRAWN = frozenset({"withdrawal"})
CONCERN = frozenset({"expression_of_concern"})
CORRECTED = frozenset({"correction", "erratum", "corrigendum", "addendum", "clarification"})

SourceStatus = Literal[
    "ok", "retracted", "withdrawn", "expressionOfConcern", "corrected", "notFound", "failed"
]


class LookupDoiParams(RpcModel):
    doi: str = Field(min_length=1, max_length=400)


class LookupDoiResult(RpcModel):
    doi: str
    csl: str


class DetectDoiParams(RpcModel):
    path: ReadPath
    password: str | None = None


class DetectDoiResult(RpcModel):
    doi: str | None = None
    title: str | None = None


class CheckSourcesParams(RpcModel):
    dois: list[str] = Field(min_length=1, max_length=MAX_DOIS)


class SourceNotice(RpcModel):
    type: str
    doi: str | None = None
    date: str | None = None
    source: str | None = None


class SourceCheck(RpcModel):
    doi: str
    status: SourceStatus
    notices: list[SourceNotice] = []
    published_version: str | None = None


class CheckSourcesResult(RpcModel):
    items: list[SourceCheck]


def _network(reason: str, **data: Any) -> OpError:
    return OpError(ErrorCode.NETWORK, f"source lookup failed: {reason}", {"reason": reason, **data})


def _assert_allowed(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in ALLOWED_HOSTS:
        raise _network("doiUntrustedHost", host=host)


class _AllowlistRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        _assert_allowed(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_AllowlistRedirect)


def _retry_after(error: urllib.error.HTTPError) -> float:
    try:
        return min(MAX_RETRY_WAIT, max(0.0, float(error.headers.get("Retry-After", "1"))))
    except (TypeError, ValueError):
        return 1.0


def _get(url: str, accept: str, retried: bool = False) -> bytes | None:
    _assert_allowed(url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    try:
        with _OPENER.open(request, timeout=REQUEST_TIMEOUT) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except OpError:
        raise
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            return None
        if error.code == 429 and not retried:
            time.sleep(_retry_after(error))
            return _get(url, accept, retried=True)
        raise _network("doiHttpStatus", status=error.code) from error
    except TimeoutError as error:
        raise _network("doiTimeout") from error
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise _network("doiTimeout") from error
        raise _network("doiOffline") from error
    except (http.client.HTTPException, OSError) as error:
        raise _network("doiOffline") from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise _network("doiTooLarge")
    return body


def _json_object(body: bytes) -> dict[str, Any]:
    try:
        data = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise _network("doiBadResponse") from error
    if not isinstance(data, dict):
        raise _network("doiBadResponse")
    return data


def _trim(candidate: str) -> str:
    text = candidate.rstrip(TRAILING_PUNCTUATION)
    while text.endswith(")") and text.count(")") > text.count("("):
        text = text[:-1].rstrip(TRAILING_PUNCTUATION)
    while text.endswith("]") and text.count("]") > text.count("["):
        text = text[:-1].rstrip(TRAILING_PUNCTUATION)
    return text


def normalized_doi(value: str) -> str:
    doi = _trim(DOI_PREFIX.sub("", urllib.parse.unquote(value.strip())).strip())
    if not DOI_SHAPE.match(doi):
        raise OpError(ErrorCode.INVALID_PARAMS, "not a DOI", {"reason": "badDoi"})
    return doi


def find_doi(text: str) -> str | None:
    for match in DOI_IN_TEXT.finditer(text):
        doi = _trim(match.group(0))
        if DOI_SHAPE.match(doi):
            return doi
    return None


def _quoted(doi: str) -> str:
    return urllib.parse.quote(doi, safe=DOI_SAFE)


@op("sources.lookup_doi", LookupDoiParams)
def lookup_doi(params: LookupDoiParams, _progress: Progress) -> LookupDoiResult:
    doi = normalized_doi(params.doi)
    body = _get(DOI_RESOLVER + _quoted(doi), CSL_ACCEPT)
    if body is None:
        raise _network("doiNotFound", doi=doi)
    data = _json_object(body)
    if not data.get("title") and not data.get("type"):
        raise _network("doiNoMetadata", doi=doi)
    return LookupDoiResult(doi=doi, csl=json.dumps(data, ensure_ascii=False))


def _clean_title(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    title = " ".join(value.split())
    if len(title) < 4 or title.lower() in {"untitled", "microsoft word"}:
        return None
    return title[:500]


@op("sources.detect_doi", DetectDoiParams)
def detect_doi(params: DetectDoiParams, progress: Progress) -> DetectDoiResult:
    with open_document(params.path, params.password, mutable=False) as document:
        title = _clean_title((document.metadata or {}).get("title"))
        doi = find_doi(document.get_xml_metadata() or "")
        for index in range(min(DETECT_PAGES, document.page_count)):
            if doi:
                break
            progress.check_cancelled()
            page = document[index]
            uris = " ".join(str(link.get("uri") or "") for link in page.get_links())
            doi = find_doi(page.get_text()) or find_doi(uris)
    return DetectDoiResult(doi=doi, title=title)


def _date(updated: object) -> str | None:
    if not isinstance(updated, dict):
        return None
    parts = updated.get("date-parts")
    if not isinstance(parts, list) or not parts or not isinstance(parts[0], list):
        return None
    numbers = [value for value in parts[0][:3] if isinstance(value, int)]
    if not numbers:
        return None
    return "-".join(f"{value:02d}" if index else str(value) for index, value in enumerate(numbers))


def _notices(work: dict[str, Any]) -> list[SourceNotice]:
    found: list[SourceNotice] = []
    seen: set[tuple[str, str | None]] = set()
    for entry in work.get("updated-by") or []:
        if not isinstance(entry, dict) or not isinstance(entry.get("type"), str):
            continue
        notice_doi = entry.get("DOI") if isinstance(entry.get("DOI"), str) else None
        key = (entry["type"], notice_doi)
        if key in seen:
            continue
        seen.add(key)
        found.append(
            SourceNotice(
                type=entry["type"],
                doi=notice_doi,
                date=_date(entry.get("updated")),
                source=entry.get("source") if isinstance(entry.get("source"), str) else None,
            )
        )
    return found


def _status(notices: list[SourceNotice]) -> SourceStatus:
    kinds = {notice.type for notice in notices}
    if kinds & RETRACTED:
        return "retracted"
    if kinds & WITHDRAWN:
        return "withdrawn"
    if kinds & CONCERN:
        return "expressionOfConcern"
    if kinds & CORRECTED:
        return "corrected"
    return "ok"


def _published_version(work: dict[str, Any]) -> str | None:
    relation = work.get("relation")
    if not isinstance(relation, dict):
        return None
    for entry in relation.get("is-preprint-of") or []:
        if isinstance(entry, dict) and entry.get("id-type") == "doi" and entry.get("id"):
            return str(entry["id"])
    return None


def _check_one(raw: str) -> SourceCheck:
    try:
        doi = normalized_doi(raw)
    except OpError:
        return SourceCheck(doi=raw, status="notFound")
    try:
        body = _get(CROSSREF_WORKS + _quoted(doi), JSON_ACCEPT)
    except OpError as error:
        if error.data and error.data.get("reason") in {"doiOffline", "doiUntrustedHost"}:
            raise
        return SourceCheck(doi=doi, status="failed")
    if body is None:
        return SourceCheck(doi=doi, status="notFound")
    try:
        work = _json_object(body).get("message")
    except OpError:
        return SourceCheck(doi=doi, status="failed")
    if not isinstance(work, dict):
        return SourceCheck(doi=doi, status="failed")
    notices = _notices(work)
    return SourceCheck(
        doi=doi,
        status=_status(notices),
        notices=notices,
        published_version=_published_version(work),
    )


@op("sources.check", CheckSourcesParams)
def check_sources(params: CheckSourcesParams, progress: Progress) -> CheckSourcesResult:
    items: list[SourceCheck] = []
    total = len(params.dois)
    for index, raw in enumerate(params.dois):
        progress.check_cancelled()
        progress.report(
            index / total, "progress.checkingSources", {"current": index + 1, "total": total}
        )
        if index:
            time.sleep(REQUEST_INTERVAL)
        items.append(_check_one(raw))
    progress.report(1.0, "progress.checkingSources", {"current": total, "total": total})
    return CheckSourcesResult(items=items)
