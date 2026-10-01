import base64
import binascii
import functools
import http.client
import io
import ipaddress
import re
import socket
import ssl
import tempfile
import time
import urllib.error
import urllib.request
import zlib
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import (
    SplitResult,
    quote,
    unquote_to_bytes,
    urldefrag,
    urljoin,
    urlsplit,
    urlunsplit,
)

import pymupdf
from pydantic import Field

from vivepdf.ops._output import OutputResult, prepare_output
from vivepdf.ops._story import decode_text, known_codec, render_html_to_pdf, text_to_html
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

USER_AGENT = "Mozilla/5.0 (compatible; vivePDF)"
ALLOWED_SCHEMES = ("http", "https")
REQUEST_TIMEOUT = 20.0
PAGE_DEADLINE = 60.0
IMAGE_DEADLINE = 20.0
READ_CHUNK = 64 * 1024
IMAGE_WORKERS = 6
MAX_WEB_IMAGE_PIXELS = 40_000_000
LINK_SCHEMES = ("http", "https", "mailto")
KEPT_JPEG_MODES = ("RGB", "L")
MAX_REDIRECTS = 5
MAX_PAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGES = 60
MIN_READER_CHARACTERS = 400
PATH_SAFE = "/%:@&=+$,;~!*'()"
QUERY_SAFE = "/%:@&=+$,;?~!*'()"
OPAQUE_SCHEME = re.compile(r"^([a-zA-Z][a-zA-Z0-9+\-]*):")
IMAGE_TOKEN = re.compile(r'src="(vivepdf-image-\d+)"')
EMPTY_IMAGE = re.compile(r'<img\b[^>]*src=""[^>]*/?>')

DROPPED_TAGS = frozenset(
    {
        "script",
        "style",
        "noscript",
        "iframe",
        "object",
        "embed",
        "canvas",
        "svg",
        "video",
        "audio",
        "form",
        "button",
        "select",
        "option",
        "textarea",
        "template",
    }
)
SKIPPED_TAGS = frozenset(
    {"input", "link", "meta", "source", "track", "param", "area", "wbr", "basefont"}
)
VOID_TAGS = frozenset({"br", "hr", "img", "col"})
KEPT_TAGS = frozenset(
    {
        "article",
        "main",
        "section",
        "div",
        "p",
        "span",
        "a",
        "b",
        "strong",
        "i",
        "em",
        "u",
        "s",
        "sub",
        "sup",
        "small",
        "mark",
        "code",
        "pre",
        "blockquote",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "dl",
        "dt",
        "dd",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th",
        "caption",
        "figure",
        "figcaption",
        "img",
        "br",
        "hr",
    }
)
KEPT_ATTRIBUTES = {
    "img": ("src", "alt"),
    "a": ("href",),
    "td": ("colspan", "rowspan"),
    "th": ("colspan", "rowspan"),
}
CONTAINER_TAGS = frozenset({"article", "main", "section", "div"})
MAX_LINK_DENSITY = 0.75
PARAGRAPH_WEIGHT = 40.0
KEEP_FRACTION = 0.85


@dataclass(slots=True)
class _Container:
    tag: str
    start: int
    depth: int
    text: int
    links: int
    paragraphs: int


@dataclass(slots=True)
class _Candidate:
    score: float
    depth: int
    start: int
    end: int


class WebPageParams(RpcModel):
    url: str = Field(min_length=1, max_length=2000)
    output: str
    overwrite: bool = False
    paper: str = Field(default="a4", pattern="^(a4|letter)$")
    reader_mode: bool = True
    include_images: bool = True


class WebPageResult(OutputResult):
    title: str | None = None
    source_url: str
    images: int = 0


def normalize_url(url: str) -> str:
    candidate = url.strip()
    if not candidate:
        raise OpError(ErrorCode.INVALID_PARAMS, "no address given", {"reason": "url"})
    if "://" not in candidate:
        opaque = OPAQUE_SCHEME.match(candidate)
        if opaque:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"unsupported address scheme: {opaque.group(1)}",
                {"reason": "scheme", "scheme": opaque.group(1)},
            )
        candidate = f"https://{candidate}"
    parts = urlsplit(candidate)
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported address scheme: {parts.scheme}",
            {"reason": "scheme", "scheme": parts.scheme},
        )
    if not parts.hostname:
        raise OpError(ErrorCode.INVALID_PARAMS, "address has no host", {"reason": "url"})
    return urldefrag(_to_ascii(parts)).url


def _to_ascii(parts: SplitResult) -> str:
    try:
        host = parts.hostname.encode("idna").decode("ascii") if parts.hostname else ""
    except UnicodeError:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "the host name is not valid", {"reason": "url"}
        ) from None
    netloc = host
    if parts.username:
        credentials = parts.username + (f":{parts.password}" if parts.password else "")
        netloc = f"{quote(credentials, safe=':')}@{netloc}"
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    return urlunsplit(
        (
            parts.scheme.lower(),
            netloc,
            quote(parts.path, safe=PATH_SAFE),
            quote(parts.query, safe=QUERY_SAFE),
            "",
        )
    )


def _too_large(limit: int) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        "the page is too large to convert",
        {"reason": "pageTooLarge", "limit": limit},
    )


def _decompress(payload: bytes, encoding: str, limit: int) -> bytes:
    if encoding == "gzip":
        window = 16 + zlib.MAX_WBITS
    elif encoding == "deflate":
        window = -zlib.MAX_WBITS
    else:
        return payload
    try:
        inflater = zlib.decompressobj(window)
        expanded = inflater.decompress(payload, limit + 1)
    except zlib.error:
        return payload
    if len(expanded) > limit or inflater.unconsumed_tail:
        raise _too_large(limit)
    return expanded


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201, ARG002
        return None


INTERNAL_SUFFIXES = (".local", ".internal", ".localdomain", ".home.arpa")


def _bare_host(host: str | None) -> str:
    return (host or "").strip("[]").rstrip(".").lower()


def _address_is_internal(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def _resolve(name: str) -> list[str]:
    addresses: list[str] = []
    for entry in socket.getaddrinfo(name, None, proto=socket.IPPROTO_TCP):
        value = str(entry[4][0])
        if value not in addresses:
            addresses.append(value)
    return addresses


def host_is_internal(host: str | None) -> bool:
    name = _bare_host(host)
    if not name:
        return True
    if name == "localhost" or name.endswith(INTERNAL_SUFFIXES):
        return True
    try:
        resolved = _resolve(name)
    except OSError:
        return False
    return any(_address_is_internal(value) for value in resolved)


def host_is_literally_internal(host: str | None) -> bool:
    name = _bare_host(host)
    if not name or name == "localhost" or name.endswith(INTERNAL_SUFFIXES):
        return True
    if "." not in name and ":" not in name:
        return True
    return _address_is_internal(name)


def _refuse_private(host: str | None) -> OpError:
    return OpError(
        ErrorCode.NETWORK,
        f"refusing to follow an address on this machine or network: {host}",
        {"reason": "privateAddress", "host": host},
    )


def vetted_addresses(url: str, allow_internal: bool) -> list[str]:
    host = urlsplit(url).hostname
    name = _bare_host(host)
    if not allow_internal and (not name or name == "localhost" or name.endswith(INTERNAL_SUFFIXES)):
        raise _refuse_private(host)
    try:
        addresses = _resolve(name)
    except OSError as error:
        raise OpError(ErrorCode.NETWORK, "the address could not be reached") from error
    if not addresses:
        raise OpError(ErrorCode.NETWORK, "the address could not be reached")
    if not allow_internal and any(_address_is_internal(value) for value in addresses):
        raise _refuse_private(host)
    return addresses


def open_socket(
    address: str, port: int, timeout: float | None, source: tuple[str, int] | None
) -> socket.socket:
    return socket.create_connection((address, port), timeout, source)


def _connect_pinned(connection: http.client.HTTPConnection, addresses: list[str]) -> socket.socket:
    failure: OSError | None = None
    for address in addresses:
        try:
            return open_socket(
                address, connection.port, connection.timeout, connection.source_address
            )
        except OSError as error:
            failure = error
    raise failure or OSError("no address to connect to")


class PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, *args: object, addresses: list[str], **kwargs: object) -> None:
        super().__init__(host, *args, **kwargs)
        self.pinned_addresses = list(addresses)

    def connect(self) -> None:
        self.sock = _connect_pinned(self, self.pinned_addresses)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, *args: object, addresses: list[str], **kwargs: object) -> None:
        super().__init__(host, *args, **kwargs)
        self.pinned_addresses = list(addresses)

    def connect(self) -> None:
        raw = _connect_pinned(self, self.pinned_addresses)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


class _PinnedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, addresses: list[str]) -> None:
        super().__init__()
        self.addresses = addresses

    def http_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self.do_open(functools.partial(PinnedHTTPConnection, addresses=self.addresses), req)


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, addresses: list[str]) -> None:
        super().__init__(context=ssl.create_default_context())
        self.addresses = addresses

    def https_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self.do_open(
            functools.partial(PinnedHTTPSConnection, addresses=self.addresses),
            req,
            context=self._context,
        )


def _uses_proxy(url: str) -> bool:
    parts = urlsplit(url)
    if parts.scheme not in urllib.request.getproxies():
        return False
    return not urllib.request.proxy_bypass(parts.hostname or "")


def _opener_for(url: str, allow_internal: bool) -> urllib.request.OpenerDirector:
    addresses = vetted_addresses(url, allow_internal)
    if _uses_proxy(url):
        return urllib.request.build_opener(_NoRedirect)
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _NoRedirect,
        _PinnedHTTPHandler(addresses),
        _PinnedHTTPSHandler(addresses),
    )


def _site_timeout() -> OpError:
    return OpError(ErrorCode.NETWORK, "the site took too long to answer", {"reason": "siteTimeout"})


def _read_limited(
    response: http.client.HTTPResponse,
    limit: int,
    ends: float,
    check_cancelled: Callable[[], None] | None,
) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while True:
        if check_cancelled is not None:
            check_cancelled()
        if time.monotonic() > ends:
            raise _site_timeout()
        chunk = response.read1(READ_CHUNK)
        if not chunk:
            return b"".join(chunks)
        size += len(chunk)
        if size > limit:
            raise _too_large(limit)
        chunks.append(chunk)


def _timed_out(error: BaseException) -> bool:
    return isinstance(error, TimeoutError) or isinstance(
        getattr(error, "reason", None), TimeoutError
    )


def fetch(
    url: str,
    limit: int,
    allow_internal: bool = False,
    *,
    check_cancelled: Callable[[], None] | None = None,
    deadline: float = PAGE_DEADLINE,
) -> tuple[bytes, str, str]:
    current = url
    ends = time.monotonic() + deadline
    for _ in range(MAX_REDIRECTS + 1):
        if check_cancelled is not None:
            check_cancelled()
        remaining = ends - time.monotonic()
        if remaining <= 0:
            raise _site_timeout()
        opener = _opener_for(current, allow_internal)
        request = urllib.request.Request(
            current,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5",
                "Accept-Encoding": "gzip, deflate",
            },
        )
        try:
            with opener.open(request, timeout=min(REQUEST_TIMEOUT, remaining)) as response:
                payload = _read_limited(response, limit, ends, check_cancelled)
                encoding = (response.headers.get("Content-Encoding") or "").lower()
                content_type = (response.headers.get("Content-Type") or "").lower()
                return _decompress(payload, encoding, limit), content_type, response.geturl()
        except urllib.error.HTTPError as error:
            location = error.headers.get("Location") if error.headers else None
            status = error.code
            error.close()
            if status in (301, 302, 303, 307, 308) and location:
                current = normalize_url(urljoin(current, location))
                continue
            raise OpError(
                ErrorCode.NETWORK,
                f"the site answered {status}",
                {"status": status, "reason": _status_reason(status)},
            ) from None
        except OpError:
            raise
        except Exception as error:  # noqa: BLE001
            if _timed_out(error):
                raise _site_timeout() from error
            raise OpError(ErrorCode.NETWORK, "the address could not be reached") from error
    raise OpError(ErrorCode.NETWORK, "too many redirects", {"reason": "redirects"})


def _status_reason(status: int) -> str:
    if status in (404, 410):
        return "pageNotFound"
    if status in (401, 403):
        return "pageForbidden"
    if status >= 500:
        return "siteUnavailable"
    return "pageUnavailable"


def _charset_of(content_type: str, payload: bytes) -> str | None:
    match = re.search(r"charset=([\w.:-]+)", content_type)
    if match and known_codec(match.group(1)):
        return known_codec(match.group(1))
    head = payload[:4096].decode("ascii", errors="ignore")
    meta = re.search(r"charset=[\"']?([\w.:-]+)", head, re.IGNORECASE)
    return known_codec(meta.group(1)) if meta else None


def _is_plain_text(content_type: str) -> bool:
    return content_type.split(";", 1)[0].strip() == "text/plain"


def _escape_text(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _escape_attribute(value: str) -> str:
    return _escape_text(value).replace('"', "&quot;")


class PageParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.title: str | None = None
        self.image_urls: list[str] = []
        self._parts: list[str] = []
        self._open: list[_Container] = []
        self._candidates: list[_Candidate] = []
        self._text_total = 0
        self._link_total = 0
        self._paragraph_total = 0
        self._link_depth = 0
        self._drop_depth = 0
        self._dropped_tag: str | None = None
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in SKIPPED_TAGS:
            return
        if self._drop_depth > 0:
            if tag == self._dropped_tag:
                self._drop_depth += 1
            return
        if tag == "base":
            for name, value in attrs:
                if name == "href" and value:
                    self.base_url = urljoin(self.base_url, value)
            return
        if tag == "title":
            self._in_title = True
            return
        if tag in DROPPED_TAGS:
            self._drop_depth = 1
            self._dropped_tag = tag
            return
        if tag not in KEPT_TAGS:
            return
        if tag == "p":
            self._paragraph_total += 1
        elif tag == "a":
            self._link_depth += 1
        rendered = self._render_start(tag, dict(attrs))
        if rendered:
            self._parts.append(rendered)
        if tag in CONTAINER_TAGS:
            self._open.append(
                _Container(
                    tag=tag,
                    start=len(self._parts) - (1 if rendered else 0),
                    depth=len(self._open),
                    text=self._text_total,
                    links=self._link_total,
                    paragraphs=self._paragraph_total,
                )
            )

    def _render_start(self, tag: str, attrs: dict[str, str | None]) -> str:
        kept: list[str] = []
        for name in KEPT_ATTRIBUTES.get(tag, ()):
            value = attrs.get(name)
            if not value:
                continue
            if name == "src" and tag == "img":
                resolved = self._resolve_image(value)
                if resolved is None:
                    return ""
                value = resolved
            elif name == "href":
                value = urljoin(self.base_url, value)
                if urlsplit(value).scheme.lower() not in LINK_SCHEMES:
                    continue
            kept.append(f'{name}="{_escape_attribute(value)}"')
        attribute_text = (" " + " ".join(kept)) if kept else ""
        closer = "/" if tag in VOID_TAGS else ""
        return f"<{tag}{attribute_text}{closer}>"

    def _resolve_image(self, value: str) -> str | None:
        source = value.strip()
        if len(self.image_urls) >= MAX_IMAGES:
            return None
        if not source.startswith("data:"):
            source = urljoin(self.base_url, source)
            if urlsplit(source).scheme.lower() not in ALLOWED_SCHEMES:
                return None
        index = len(self.image_urls)
        self.image_urls.append(source)
        return f"vivepdf-image-{index}"

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if self._drop_depth > 0:
            if tag in ("body", "html"):
                self._drop_depth = 0
                self._dropped_tag = None
                return
            if tag == self._dropped_tag:
                self._drop_depth -= 1
                if self._drop_depth == 0:
                    self._dropped_tag = None
            return
        if tag == "title":
            self._in_title = False
            return
        if tag not in KEPT_TAGS or tag in VOID_TAGS:
            return
        if tag == "a" and self._link_depth > 0:
            self._link_depth -= 1
        self._parts.append(f"</{tag}>")
        if tag in CONTAINER_TAGS:
            self._close_container(tag)

    def _close_container(self, tag: str) -> None:
        for position in range(len(self._open) - 1, -1, -1):
            if self._open[position].tag != tag:
                continue
            container = self._open[position]
            del self._open[position:]
            self._record(container)
            return

    def _record(self, container: "_Container") -> None:
        text = self._text_total - container.text
        if text < MIN_READER_CHARACTERS:
            return
        links = self._link_total - container.links
        paragraphs = self._paragraph_total - container.paragraphs
        density = links / text
        if density > MAX_LINK_DENSITY:
            return
        score = text * (1.0 - density) ** 2 + PARAGRAPH_WEIGHT * paragraphs
        self._candidates.append(
            _Candidate(
                score=score, depth=container.depth, start=container.start, end=len(self._parts)
            )
        )

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title = ((self.title or "") + data).strip() or None
            return
        if self._drop_depth > 0:
            return
        self._parts.append(_escape_text(data))
        length = len(data.strip())
        self._text_total += length
        if self._link_depth > 0:
            self._link_total += length

    def close(self) -> None:
        super().close()
        while self._open:
            self._record(self._open.pop())

    def main_content(self) -> tuple[int, int] | None:
        if not self._candidates:
            return None
        best = max(candidate.score for candidate in self._candidates)
        tight = [
            candidate for candidate in self._candidates if candidate.score >= best * KEEP_FRACTION
        ]
        chosen = max(tight, key=lambda candidate: candidate.depth)
        return chosen.start, chosen.end

    def body(self, reader: bool) -> str:
        if reader:
            chosen = self.main_content()
            if chosen is not None:
                return "".join(self._parts[chosen[0] : chosen[1]])
        return "".join(self._parts)


def _save_image(payload: bytes, stem: Path) -> str | None:
    from PIL import Image

    try:
        with Image.open(io.BytesIO(payload)) as image:
            if image.width < 8 or image.height < 8:
                return None
            if image.width * image.height > MAX_WEB_IMAGE_PIXELS:
                return None
            if image.format == "JPEG" and image.mode in KEPT_JPEG_MODES:
                kept = stem.with_suffix(".jpg")
                kept.write_bytes(payload)
                return kept.name
            image.load()
            if image.mode in ("RGBA", "LA", "P"):
                flattened = Image.new("RGB", image.size, (255, 255, 255))
                converted = image.convert("RGBA")
                flattened.paste(converted, mask=converted.split()[-1])
            else:
                flattened = image.convert("RGB")
            target = stem.with_suffix(".png")
            flattened.save(target, format="PNG")
    except Exception:  # noqa: BLE001
        return None
    return target.name


def _decode_data_uri(source: str) -> bytes | None:
    header, _, encoded = source.partition(",")
    if not encoded:
        return None
    try:
        if header.endswith(";base64"):
            return base64.b64decode(encoded)
        return unquote_to_bytes(encoded)
    except (binascii.Error, ValueError):
        return None


def _download_image(
    source: str, stem: Path, allow_internal: bool, check_cancelled: Callable[[], None]
) -> str | None:
    if source.startswith("data:"):
        payload = _decode_data_uri(source)
    elif not allow_internal and host_is_internal(urlsplit(source).hostname):
        payload = None
    else:
        try:
            payload, _, _ = fetch(
                source,
                MAX_IMAGE_BYTES,
                allow_internal,
                check_cancelled=check_cancelled,
                deadline=IMAGE_DEADLINE,
            )
        except OpError as error:
            if error.code == ErrorCode.CANCELLED:
                raise
            payload = None
    return _save_image(payload, stem) if payload else None


def _collect_images(
    sources: list[str], directory: Path, progress: Progress, allow_internal: bool = False
) -> dict[str, str]:
    mapping: dict[str, str] = {}
    progress.check_cancelled()
    with ThreadPoolExecutor(max_workers=IMAGE_WORKERS) as pool:
        pending = {
            pool.submit(
                _download_image,
                source,
                directory / f"image{index}",
                allow_internal,
                progress.check_cancelled,
            ): index
            for index, source in enumerate(sources)
        }
        try:
            for finished, future in enumerate(as_completed(pending), start=1):
                saved = future.result()
                if saved:
                    mapping[f"vivepdf-image-{pending[future]}"] = saved
                progress.report(
                    0.2 + 0.5 * finished / len(sources),
                    "progress.downloading",
                    {"current": finished, "total": len(sources)},
                )
        except BaseException:
            pool.shutdown(wait=True, cancel_futures=True)
            raise
    return mapping


def apply_images(body: str, mapping: dict[str, str]) -> str:
    replaced = IMAGE_TOKEN.sub(
        lambda match: f'src="{mapping[match.group(1)]}"' if match.group(1) in mapping else 'src=""',
        body,
    )
    return EMPTY_IMAGE.sub("", replaced)


def _render_plain_text(
    payload: bytes, content_type: str, final_url: str, target: Path, paper: str, progress: Progress
) -> WebPageResult:
    text = decode_text(payload, _charset_of(content_type, b""))
    if not text.strip():
        raise OpError(
            ErrorCode.INVALID_PARAMS, "the page has no readable content", {"reason": "pageEmpty"}
        )
    progress.report(0.8, "progress.rendering")
    source = f"<p><small>{_escape_text(final_url)}</small></p>"
    render_html_to_pdf(
        f"<html><body>{text_to_html(text)}{source}</body></html>",
        target,
        paper,
        check_cancelled=progress.check_cancelled,
    )
    with pymupdf.open(target) as produced:
        page_count = produced.page_count
    return WebPageResult(
        output=str(target),
        page_count=page_count,
        bytes=target.stat().st_size,
        title=None,
        source_url=final_url,
        images=0,
    )


@op("convert.from_url", WebPageParams)
def from_url(params: WebPageParams, progress: Progress) -> WebPageResult:
    url = normalize_url(params.url)
    target = prepare_output(params.output, [], params.overwrite)
    progress.report(0.05, "progress.fetching")
    allow_internal = host_is_literally_internal(urlsplit(url).hostname)
    payload, content_type, final_url = fetch(
        url, MAX_PAGE_BYTES, allow_internal, check_cancelled=progress.check_cancelled
    )
    if _is_plain_text(content_type):
        return _render_plain_text(payload, content_type, final_url, target, params.paper, progress)
    if content_type and "html" not in content_type and "xml" not in content_type:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the address is not a web page",
            {"reason": "contentType", "contentType": content_type},
        )
    parser = PageParser(final_url)
    parser.feed(decode_text(payload, _charset_of(content_type, payload)))
    parser.close()
    body = parser.body(params.reader_mode)
    if not body.strip():
        raise OpError(
            ErrorCode.INVALID_PARAMS, "the page has no readable content", {"reason": "pageEmpty"}
        )
    with tempfile.TemporaryDirectory(prefix="vivepdf-web-") as temp_dir:
        directory = Path(temp_dir)
        mapping = (
            _collect_images(parser.image_urls, directory, progress, allow_internal)
            if params.include_images and parser.image_urls
            else {}
        )
        body = apply_images(body, mapping)
        heading = (
            f"<h1>{_escape_text(parser.title)}</h1>" if parser.title and "<h1" not in body else ""
        )
        source = f"<p><small>{_escape_text(final_url)}</small></p>"
        progress.report(0.8, "progress.rendering")
        render_html_to_pdf(
            f"<html><body>{heading}{body}{source}</body></html>",
            target,
            params.paper,
            base_dir=directory,
            check_cancelled=progress.check_cancelled,
        )
    with pymupdf.open(target) as produced:
        page_count = produced.page_count
    return WebPageResult(
        output=str(target),
        page_count=page_count,
        bytes=target.stat().st_size,
        title=parser.title,
        source_url=final_url,
        images=len(mapping),
    )
