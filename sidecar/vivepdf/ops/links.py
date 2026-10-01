import re
from typing import Literal
from urllib.parse import quote, urlsplit, urlunsplit

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._inplace import check_output, finish
from vivepdf.ops._output import OutputResult
from vivepdf.ops._placement import insertion_matrix, unrotated_insertion_matrix
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

LinkKind = Literal["uri", "page", "other"]


class LinkItem(RpcModel):
    page: int
    xref: int
    kind: LinkKind
    uri: str | None = None
    target_page: int | None = None
    rect: list[float]


class LinksListParams(RpcModel):
    path: str
    password: str | None = None
    page: int | None = Field(default=None, ge=1)


class LinksListResult(RpcModel):
    items: list[LinkItem]
    count: int


def _visible(rect: pymupdf.Rect) -> list[float]:
    shown = pymupdf.Rect(rect)
    shown.normalize()
    return [round(shown.x0, 2), round(shown.y0, 2), round(shown.x1, 2), round(shown.y1, 2)]


def _items(document: pymupdf.Document, only_page: int | None) -> list[LinkItem]:
    items: list[LinkItem] = []
    indices = [only_page - 1] if only_page else range(document.page_count)
    for index in indices:
        if index >= document.page_count:
            continue
        page = document[index]
        for link in page.get_links():
            kind = link.get("kind")
            if kind == pymupdf.LINK_URI:
                items.append(
                    LinkItem(
                        page=index + 1,
                        xref=int(link.get("xref") or 0),
                        kind="uri",
                        uri=link.get("uri"),
                        rect=_visible(pymupdf.Rect(link["from"])),
                    )
                )
            elif kind == pymupdf.LINK_GOTO:
                items.append(
                    LinkItem(
                        page=index + 1,
                        xref=int(link.get("xref") or 0),
                        kind="page",
                        target_page=int(link.get("page", 0)) + 1,
                        rect=_visible(pymupdf.Rect(link["from"])),
                    )
                )
            else:
                items.append(
                    LinkItem(
                        page=index + 1,
                        xref=int(link.get("xref") or 0),
                        kind="other",
                        rect=_visible(pymupdf.Rect(link["from"])),
                    )
                )
    return items


@op("links.list", LinksListParams)
def list_links(params: LinksListParams, _progress: Progress) -> LinksListResult:
    with open_document(params.path, params.password) as document:
        items = _items(document, params.page)
        return LinksListResult(items=items, count=len(items))


class NewLink(RpcModel):
    page: int = Field(ge=1)
    x0: float
    y0: float
    x1: float
    y1: float
    uri: str | None = None
    target_page: int | None = Field(default=None, ge=1)


class LinksAddParams(RpcModel):
    path: str
    password: str | None = None
    output: str | None = None
    in_place: bool = True
    overwrite: bool = False
    links: list[NewLink] = Field(min_length=1)


class LinksChangedResult(OutputResult):
    changed: int


@op("links.add", LinksAddParams)
def add_links(params: LinksAddParams, progress: Progress) -> LinksChangedResult:
    check_output(params.path, params.output, params.in_place, params.overwrite)
    document = open_document(params.path, params.password)
    try:
        for item in params.links:
            progress.check_cancelled()
            if item.page > document.page_count:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"page {item.page} is outside 1..{document.page_count}",
                    {
                        "reason": "pageOutOfRange",
                        "page": item.page,
                        "pageCount": document.page_count,
                    },
                )
            if not item.uri and not item.target_page:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    "a link needs a uri or a target page",
                    {"reason": "emptyLink"},
                )
            page = document[item.page - 1]
            rect = pymupdf.Rect(item.x0, item.y0, item.x1, item.y1)
            rect.normalize()
            rect = rect * insertion_matrix(page)
            if item.uri:
                page.insert_link({"kind": pymupdf.LINK_URI, "from": rect, "uri": item.uri})
            else:
                target = min(document.page_count, int(item.target_page or 1)) - 1
                page.insert_link(
                    {
                        "kind": pymupdf.LINK_GOTO,
                        "from": rect,
                        "page": target,
                        "to": pymupdf.Point(0, 0),
                    }
                )
        progress.report(0.9, "progress.saving")
        saved = finish(document, params.path, params.output, params.in_place, params.overwrite)
        return LinksChangedResult(**saved.model_dump(), changed=len(params.links))
    finally:
        if not document.is_closed:
            document.close()


class LinkRef(RpcModel):
    page: int = Field(ge=1)
    xref: int


class LinksRemoveParams(RpcModel):
    path: str
    password: str | None = None
    output: str | None = None
    in_place: bool = True
    overwrite: bool = False
    items: list[LinkRef] = Field(min_length=1)


@op("links.remove", LinksRemoveParams)
def remove_links(params: LinksRemoveParams, progress: Progress) -> LinksChangedResult:
    check_output(params.path, params.output, params.in_place, params.overwrite)
    document = open_document(params.path, params.password)
    try:
        removed = 0
        wanted = {(item.page, item.xref) for item in params.items}
        for page_number, xref in sorted(wanted):
            if page_number > document.page_count:
                continue
            page = document[page_number - 1]
            for link in page.get_links():
                if int(link.get("xref") or 0) == xref:
                    page.delete_link(link)
                    removed += 1
                    break
        progress.report(0.9, "progress.saving")
        saved = finish(document, params.path, params.output, params.in_place, params.overwrite)
        return LinksChangedResult(**saved.model_dump(), changed=removed)
    finally:
        if not document.is_closed:
            document.close()


URL_PATTERN = re.compile(
    r"(?:https?://|www\.)[^\s<>\"'{}|\^`“”‘’«»‹›「」『』【】〈〉《》（）、。，；：！？]+",
    re.IGNORECASE,
)
EMAIL_PATTERN = re.compile(r"(?<![\w.%+-])[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[^\W\d_]{2,}")
TRAILING_PUNCTUATION = ".,;:!?'\"»”’"
CLOSING_PAIRS = {")": "(", "]": "[", "}": "{"}
OVERLAP_LIMIT = 0.3
CONTINUED_ENDINGS = "/-_=&?#%"
CONTINUATION = re.compile(r"[\w/%\-.~?&=#+:@()]+")
URL_LIKE_PART = re.compile(r"[/?=&%#_]|\w\.\w")
URI_SAFE = "/:@!$&'()*+,;=%~?#[]-._"
MAILBOX_SAFE = "!#$&'*+-.=?^_`{|}~%"
LINE_GAP = 2.0
WordBox = tuple[float, float, float, float, str, int, int, int]


class AutoLinkParams(RpcModel):
    path: str
    password: str | None = None
    output: str | None = None
    in_place: bool = False
    overwrite: bool = False
    urls: bool = True
    emails: bool = True
    pages: str | None = None


class AutoLinkResult(OutputResult):
    added: int
    pages_changed: int


def _trimmed(candidate: str) -> str:
    while candidate:
        last = candidate[-1]
        if (
            last in TRAILING_PUNCTUATION
            or last in CLOSING_PAIRS
            and candidate.count(last) > candidate.count(CLOSING_PAIRS[last])
        ):
            candidate = candidate[:-1]
        else:
            break
    return candidate


def _ascii_host(host: str) -> str | None:
    if host.isascii():
        return host or None
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        return None


def web_uri(text: str) -> str | None:
    try:
        parts = urlsplit(text if "://" in text else f"https://{text}")
    except ValueError:
        return None
    userinfo, at, hostport = parts.netloc.rpartition("@")
    host, colon, port = hostport.partition(":")
    ascii_host = _ascii_host(host)
    if ascii_host is None:
        return None
    netloc = f"{quote(userinfo, safe=URI_SAFE)}{at}{ascii_host}{colon}{port}"
    path, query, fragment = (
        quote(part, safe=URI_SAFE) for part in (parts.path, parts.query, parts.fragment)
    )
    return urlunsplit((parts.scheme, netloc, path, query, fragment))


def mail_uri(text: str) -> str | None:
    mailbox, _at, domain = text.rpartition("@")
    ascii_domain = _ascii_host(domain)
    if not mailbox or ascii_domain is None:
        return None
    return f"mailto:{quote(mailbox, safe=MAILBOX_SAFE)}@{ascii_domain}"


def link_targets(word: str, urls: bool, emails: bool) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if urls:
        for match in URL_PATTERN.finditer(word):
            text = _trimmed(match.group(0))
            if len(text) <= len("www.") or text.lower().rstrip("/") in ("http:", "https:"):
                continue
            host = text.split("://", 1)[-1]
            if "." not in host.split("/", 1)[0]:
                continue
            uri = web_uri(text)
            if uri:
                found.append((text, uri))
    if emails and not found:
        for match in EMAIL_PATTERN.finditer(word):
            text = _trimmed(match.group(0))
            uri = mail_uri(text)
            if uri:
                found.append((text, uri))
    return found


def continuation(word: WordBox, text: str, next_line: list[WordBox] | None) -> str | None:
    if not next_line or not word[4].endswith(text) or text[-1] not in CONTINUED_ENDINGS:
        return None
    box = pymupdf.Rect(word[:4])
    below = pymupdf.Rect(next_line[0][:4])
    if below.y0 < box.y0 or below.y0 - box.y1 > (box.height or 1.0) * LINE_GAP:
        return None
    tail = _trimmed(next_line[0][4])
    if (
        not tail
        or not CONTINUATION.fullmatch(tail)
        or not URL_LIKE_PART.search(tail)
        or "://" in tail
        or tail.lower().startswith("www.")
    ):
        return None
    return tail


def _covered(rect: pymupdf.Rect, taken: list[pymupdf.Rect]) -> bool:
    area = rect.get_area() or 1.0
    return any((rect & other).get_area() / area > OVERLAP_LIMIT for other in taken)


def _text_rect(page: pymupdf.Page, text: str, word: WordBox) -> pymupdf.Rect:
    box = pymupdf.Rect(word[:4])
    hits = page.search_for(text, clip=box + (-1, -1, 1, 1))
    return hits[0] if hits else box


def _page_lines(page: pymupdf.Page) -> list[list[WordBox]]:
    lines: dict[tuple[int, int], list[WordBox]] = {}
    for word in page.get_text("words"):
        lines.setdefault((word[5], word[6]), []).append(word)
    return list(lines.values())


def _link_page(page: pymupdf.Page, urls: bool, emails: bool) -> int:
    taken = [
        (pymupdf.Rect(link["from"]) * page.derotation_matrix).normalize()
        for link in page.get_links()
    ]
    added = 0
    lines = _page_lines(page)
    continued = False
    for position, line in enumerate(lines):
        next_line = lines[position + 1] if position + 1 < len(lines) else None
        starts_continued = continued
        continued = False
        for index, word in enumerate(line):
            if index == 0 and starts_continued:
                continue
            targets = link_targets(word[4], urls, emails)
            for number, (text, uri) in enumerate(targets):
                rects = [_text_rect(page, text, word)]
                last = index == len(line) - 1 and number == len(targets) - 1
                tail = (
                    continuation(word, text, next_line)
                    if last and not uri.startswith("mailto:")
                    else None
                )
                joined = web_uri(text + tail) if tail else None
                if tail and joined and next_line:
                    uri = joined
                    rects.append(_text_rect(page, tail, next_line[0]))
                    continued = True
                rects = [rect for rect in rects if not rect.is_empty and not _covered(rect, taken)]
                if not rects:
                    continue
                for rect in rects:
                    page.insert_link(
                        {
                            "kind": pymupdf.LINK_URI,
                            "from": rect * unrotated_insertion_matrix(page),
                            "uri": uri,
                        }
                    )
                    taken.append(rect)
                added += 1
    return added


@op("links.autolink", AutoLinkParams)
def autolink(params: AutoLinkParams, progress: Progress) -> AutoLinkResult:
    if not params.urls and not params.emails:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "choose web addresses, e-mail addresses or both",
            {"reason": "noLinkKinds"},
        )
    check_output(params.path, params.output, params.in_place, params.overwrite)
    document = open_document(params.path, params.password)
    try:
        indices = parse_page_ranges(params.pages, document.page_count)
        added = 0
        changed = 0
        for position, index in enumerate(indices):
            progress.check_cancelled()
            progress.report(
                position / len(indices) * 0.9,
                "progress.inspecting",
                {"current": position + 1, "total": len(indices)},
            )
            count = _link_page(document[index], params.urls, params.emails)
            added += count
            changed += 1 if count else 0
        if not added:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "no web or e-mail addresses without a link were found",
                {"reason": "nothingToLink"},
            )
        progress.report(0.9, "progress.saving")
        saved = finish(document, params.path, params.output, params.in_place, params.overwrite)
        return AutoLinkResult(**saved.model_dump(), added=added, pages_changed=changed)
    finally:
        if not document.is_closed:
            document.close()
