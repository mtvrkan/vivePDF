import http.server
import io
import socket
import ssl
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import ClassVar

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops import web
from vivepdf.ops.web import (
    PageParser,
    WebPageParams,
    apply_images,
    from_url,
    host_is_internal,
    normalize_url,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

PAGE = """
<html><head><title>Deneme sayfası</title><script>alert(1)</script>
<style>body{color:red}</style></head>
<body>
  <nav><a href="/gizle">menu</a></nav>
  <article>
    <h1>Başlık</h1>
    <p>Gövde metni burada ve yeterince uzun olmalı ki okuma kipi devreye girsin.</p>
    <p>İkinci paragraf da epeyce uzun, çünkü eşik dört yüz karakter olarak ayarlandı ve
       kısa bir makale tam sayfayı kullanmaya değmez. Bu yüzden buraya bolca dolgu metni
       yazıyoruz, böylece okuma kipi seçimi gerçekten sınanmış oluyor ve testin anlamı kalıyor.</p>
    <p>Üçüncü paragraf eşiği rahatça aşmak için var. Okuma kipi yalnızca makale gövdesi
       gerçekten bir yazıya benziyorsa devreye girsin istiyoruz; aksi hâlde sayfanın tamamını
       basmak daha doğru olur. Bu paragraf da o yüzden burada duruyor ve yeterince uzun.</p>
    <img src="resim.png" alt="resim">
    <iframe src="https://reklam.example/x"></iframe>
  </article>
  <footer>alt bilgi</footer>
</body></html>
"""


def png_bytes(width: int = 40, height: int = 30) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (10, 120, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_normalize_url_adds_https_and_drops_the_fragment() -> None:
    assert normalize_url("example.com/a#top") == "https://example.com/a"
    assert normalize_url(" http://example.com ") == "http://example.com"


def test_normalize_url_percent_encodes_non_ascii_paths() -> None:
    assert (
        normalize_url("https://tr.wikipedia.org/wiki/Taşınabilir_Belge")
        == "https://tr.wikipedia.org/wiki/Ta%C5%9F%C4%B1nabilir_Belge"
    )
    assert normalize_url("https://örnek.com/a") == "https://xn--rnek-4qa.com/a"
    assert normalize_url("https://example.com:8080/a%20b?q=ç") == (
        "https://example.com:8080/a%20b?q=%C3%A7"
    )


@pytest.mark.parametrize("value", ["file:///C:/secret.txt", "javascript:alert(1)", "https://"])
def test_normalize_url_rejects_anything_but_http(value: str) -> None:
    with pytest.raises(OpError) as caught:
        normalize_url(value)
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_parser_drops_scripts_keeps_article_and_absolutizes() -> None:
    parser = PageParser("https://example.com/yazi/")
    parser.feed(PAGE)
    parser.close()
    assert parser.title == "Deneme sayfası"
    assert parser.image_urls == ["https://example.com/yazi/resim.png"]
    reader = parser.body(True)
    full = parser.body(False)
    assert "alert(1)" not in full
    assert "color:red" not in full
    assert "reklam.example" not in full
    assert "Başlık" in reader
    assert "alt bilgi" not in reader
    assert "alt bilgi" in full


def test_parser_falls_back_to_the_whole_page_when_the_article_is_thin() -> None:
    parser = PageParser("https://example.com/")
    parser.feed("<html><body><article><p>kısa</p></article><p>gövde</p></body></html>")
    parser.close()
    assert "gövde" in parser.body(True)


def test_parser_ignores_images_with_an_unsupported_scheme() -> None:
    parser = PageParser("https://example.com/")
    parser.feed('<html><body><p><img src="javascript:x"><img src="/a.png"></p></body></html>')
    parser.close()
    assert parser.image_urls == ["https://example.com/a.png"]


def test_apply_images_maps_downloads_and_removes_the_rest() -> None:
    body = '<p><img src="vivepdf-image-0" alt="a"/><img src="vivepdf-image-1"/></p>'
    assert (
        apply_images(body, {"vivepdf-image-0": "image0.png"})
        == '<p><img src="image0.png" alt="a"/></p>'
    )


def test_from_url_renders_the_page_with_its_images(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_fetch(
        url: str, limit: int, allow_internal: bool = False, **_options: object
    ) -> tuple[bytes, str, str]:
        if url.endswith(".png"):
            return png_bytes(), "image/png", url
        return PAGE.encode("utf-8"), "text/html; charset=utf-8", "https://example.com/yazi/"

    monkeypatch.setattr(web, "fetch", fake_fetch)
    target = tmp_path / "sayfa.pdf"
    result = from_url(WebPageParams(url="example.com/yazi/", output=str(target)), silent_progress())
    assert result.title == "Deneme sayfası"
    assert result.source_url == "https://example.com/yazi/"
    assert result.images == 1
    assert result.page_count >= 1
    assert Path(result.output).is_file()
    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
    assert "Başlık" in text
    assert "alt bilgi" not in text


def test_from_url_keeps_going_when_an_image_cannot_be_fetched(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_fetch(
        url: str, limit: int, allow_internal: bool = False, **_options: object
    ) -> tuple[bytes, str, str]:
        if url.endswith(".png"):
            raise OpError(ErrorCode.NETWORK, "nope")
        return PAGE.encode("utf-8"), "text/html", "https://example.com/yazi/"

    monkeypatch.setattr(web, "fetch", fake_fetch)
    result = from_url(
        WebPageParams(url="https://example.com/yazi/", output=str(tmp_path / "a.pdf")),
        silent_progress(),
    )
    assert result.images == 0
    assert result.page_count >= 1


def test_from_url_rejects_a_non_html_address(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        web,
        "fetch",
        lambda url, limit, allow_internal=False, **_options: (
            b"%PDF-1.7",
            "application/pdf",
            "https://example.com/a.pdf",
        ),
    )
    with pytest.raises(OpError) as caught:
        from_url(
            WebPageParams(url="https://example.com/a.pdf", output=str(tmp_path / "a.pdf")),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "contentType", "contentType": "application/pdf"}


@pytest.mark.parametrize(
    ("status", "reason"),
    [
        (404, "pageNotFound"),
        (403, "pageForbidden"),
        (503, "siteUnavailable"),
        (418, "pageUnavailable"),
    ],
)
def test_http_status_maps_to_a_specific_reason(status: int, reason: str) -> None:
    assert web._status_reason(status) == reason


@pytest.mark.parametrize(
    "host",
    ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.4", "169.254.1.1", "::1", "nas.local"],
)
def test_addresses_on_this_machine_or_network_are_recognised(host: str) -> None:
    assert host_is_internal(host) is True


def test_a_public_address_is_not_treated_as_internal() -> None:
    assert host_is_internal("93.184.216.34") is False


def test_fetch_refuses_an_internal_address_it_was_not_asked_for() -> None:
    with pytest.raises(OpError) as caught:
        web.fetch("http://127.0.0.1:9/secret", 1024)
    assert caught.value.data["reason"] == "privateAddress"


def test_fetch_allows_an_internal_address_the_user_typed() -> None:
    with pytest.raises(OpError) as caught:
        web.fetch("http://127.0.0.1:9/secret", 1024, allow_internal=True)
    assert (caught.value.data or {}).get("reason") != "privateAddress"


def test_a_public_page_cannot_pull_pictures_from_the_local_network(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = PAGE.replace('src="resim.png"', 'src="http://192.168.1.9/panel.png"')

    def fake_fetch(
        url: str, limit: int, allow_internal: bool = False, **_options: object
    ) -> tuple[bytes, str, str]:
        if url.endswith(".png"):
            if not allow_internal:
                raise AssertionError("the guard should have stopped this fetch")
            return png_bytes(), "image/png", url
        return page.encode("utf-8"), "text/html", "https://example.com/yazi/"

    monkeypatch.setattr(web, "fetch", fake_fetch)
    result = from_url(
        WebPageParams(url="https://example.com/yazi/", output=str(tmp_path / "a.pdf")),
        silent_progress(),
    )
    assert result.images == 0
    assert result.page_count >= 1


class _RecordingHandler(http.server.BaseHTTPRequestHandler):
    hosts: ClassVar[list[str]] = []

    def do_GET(self) -> None:
        type(self).hosts.append(self.headers.get("Host") or "")
        if self.path == "/away":
            self.send_response(302)
            self.send_header("Location", "http://rebind.example/secret")
            self.end_headers()
            return
        body = b"<html><body>pinned</body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


@pytest.fixture
def local_server() -> Iterator[int]:
    _RecordingHandler.hosts = []
    server = http.server.HTTPServer(("127.0.0.1", 0), _RecordingHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()


def _rebinding_dns(monkeypatch: pytest.MonkeyPatch, answers: dict[str, list[str]]) -> list[str]:
    asked: list[str] = []
    real_getaddrinfo = socket.getaddrinfo

    def fake_getaddrinfo(name: str, *args: object, **kwargs: object) -> list[tuple]:
        if name not in answers:
            return real_getaddrinfo(name, *args, **kwargs)
        asked.append(name)
        queue = answers[name]
        value = queue.pop(0) if len(queue) > 1 else queue[0]
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (value, 0))]

    monkeypatch.setattr(web.socket, "getaddrinfo", fake_getaddrinfo)
    return asked


def test_fetch_connects_to_the_address_it_vetted_not_a_second_lookup(
    monkeypatch: pytest.MonkeyPatch, local_server: int
) -> None:
    asked = _rebinding_dns(monkeypatch, {"rebind.example": ["93.184.216.34", "127.0.0.1"]})
    dialled: list[str] = []

    def fake_open_socket(address: str, port: int, timeout: object, source: object) -> socket.socket:
        dialled.append(address)
        return socket.create_connection(("127.0.0.1", local_server), 5)

    monkeypatch.setattr(web, "open_socket", fake_open_socket)
    payload, _, _ = web.fetch(f"http://rebind.example:{local_server}/page", 1 << 20)
    assert b"pinned" in payload
    assert asked == ["rebind.example"]
    assert dialled == ["93.184.216.34"]
    assert _RecordingHandler.hosts == [f"rebind.example:{local_server}"]


def test_a_redirect_target_is_vetted_again_before_it_is_opened(
    monkeypatch: pytest.MonkeyPatch, local_server: int
) -> None:
    _rebinding_dns(
        monkeypatch,
        {"public.example": ["93.184.216.34"], "rebind.example": ["10.0.0.7"]},
    )
    monkeypatch.setattr(
        web,
        "open_socket",
        lambda address, port, timeout, source: socket.create_connection(
            ("127.0.0.1", local_server), 5
        ),
    )
    with pytest.raises(OpError) as caught:
        web.fetch(f"http://public.example:{local_server}/away", 1 << 20)
    assert caught.value.data["reason"] == "privateAddress"
    assert caught.value.data["host"] == "rebind.example"


def test_fetch_refuses_a_name_whose_answer_includes_a_private_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _rebinding_dns(monkeypatch, {"mixed.example": ["10.1.2.3"]})
    monkeypatch.setattr(
        web,
        "open_socket",
        lambda *args: (_ for _ in ()).throw(AssertionError("no connection expected")),
    )
    with pytest.raises(OpError) as caught:
        web.fetch("http://mixed.example/", 1024)
    assert caught.value.data["reason"] == "privateAddress"


def test_https_keeps_the_name_for_sni_and_certificate_checks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}

    class FakeContext:
        check_hostname = True

        def wrap_socket(self, sock: object, server_hostname: str) -> object:
            seen["server_hostname"] = server_hostname
            return sock

    class FakeSocket:
        def close(self) -> None:
            return None

    def fake_open_socket(address: str, port: int, timeout: object, source: object) -> FakeSocket:
        seen["address"] = address
        seen["port"] = port
        return FakeSocket()

    monkeypatch.setattr(web, "open_socket", fake_open_socket)
    connection = web.PinnedHTTPSConnection(
        "secure.example", 8443, addresses=["93.184.216.34"], context=FakeContext()
    )
    connection.connect()
    assert seen == {"address": "93.184.216.34", "port": 8443, "server_hostname": "secure.example"}
    handler = web._PinnedHTTPSHandler(["93.184.216.34"])
    assert handler._context.check_hostname is True
    assert handler._context.verify_mode == ssl.CERT_REQUIRED


@pytest.mark.parametrize(
    ("host", "internal"),
    [
        ("localhost", True),
        ("nas", True),
        ("printer.local", True),
        ("192.168.1.4", True),
        ("::1", True),
        ("example.com", False),
        ("93.184.216.34", False),
    ],
)
def test_internal_intent_comes_from_what_was_typed(host: str, internal: bool) -> None:
    assert web.host_is_literally_internal(host) is internal


def test_a_public_name_pointing_inside_does_not_unlock_the_local_network(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _rebinding_dns(monkeypatch, {"sneaky.example": ["10.0.0.7"]})
    seen: list[bool] = []

    def fake_fetch(url: str, limit: int, allow_internal: bool = False, **_options: object):
        seen.append(allow_internal)
        return PAGE.encode("utf-8"), "text/html", url

    monkeypatch.setattr(web, "fetch", fake_fetch)
    from_url(
        WebPageParams(url="https://sneaky.example/", output=str(tmp_path / "a.pdf")),
        silent_progress(),
    )
    assert seen and not any(seen)


def test_only_web_and_mail_links_are_kept() -> None:
    parser = PageParser("https://example.com/")
    parser.feed(
        '<p><a href="javascript:alert(1)">a</a><a href="file:///etc/passwd">b</a>'
        '<a href="mailto:x@example.com">c</a><a href="/doc">d</a></p>'
    )
    parser.close()
    body = parser.body(False)
    assert "javascript:" not in body
    assert "file:" not in body
    assert 'href="mailto:x@example.com"' in body
    assert 'href="https://example.com/doc"' in body


def test_a_huge_web_picture_is_skipped_and_a_jpeg_is_kept_as_is(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 10, 10)).save(buffer, format="JPEG")
    jpeg = buffer.getvalue()
    assert web._save_image(jpeg, tmp_path / "photo") == "photo.jpg"
    assert (tmp_path / "photo.jpg").read_bytes() == jpeg
    wide = io.BytesIO()
    Image.new("1", (9000, 5000)).save(wide, format="PNG")
    assert web._save_image(wide.getvalue(), tmp_path / "huge") is None


class _DripHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        try:
            for _ in range(200):
                self.wfile.write(b"<p>x</p>")
                self.wfile.flush()
                threading.Event().wait(0.1)
        except OSError:
            return

    def log_message(self, format: str, *args: object) -> None:
        return


@pytest.fixture
def drip_server() -> Iterator[int]:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _DripHandler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()


def test_a_slowly_dripping_site_is_stopped_at_the_deadline(drip_server: int) -> None:
    with pytest.raises(OpError) as caught:
        web.fetch(f"http://127.0.0.1:{drip_server}/", 1 << 20, allow_internal=True, deadline=1.0)
    assert caught.value.data == {"reason": "siteTimeout"}


def test_a_download_can_be_cancelled_while_it_runs(drip_server: int) -> None:
    checks = {"count": 0}

    def cancel_soon() -> None:
        checks["count"] += 1
        if checks["count"] > 3:
            raise OpError(ErrorCode.CANCELLED, "operation cancelled")

    with pytest.raises(OpError) as caught:
        web.fetch(
            f"http://127.0.0.1:{drip_server}/",
            1 << 20,
            allow_internal=True,
            check_cancelled=cancel_soon,
        )
    assert caught.value.code == ErrorCode.CANCELLED
