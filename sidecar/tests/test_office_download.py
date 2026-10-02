import threading
import urllib.request
from email.message import Message
from urllib.error import HTTPError, URLError

import pytest

from vivepdf.external import office_download
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

PAYLOAD = bytes(range(256)) * 64
DEB = office_download.PACKAGES[("linux", "x86_64")]


class Response:
    def __init__(
        self,
        body: bytes,
        status: int = 200,
        headers: dict[str, str] | None = None,
        fail_after: int | None = None,
    ):
        self.body = body
        self.status = status
        self.headers = headers or {"Content-Length": str(len(body))}
        self.fail_after = fail_after
        self.position = 0

    def read(self, size: int = -1) -> bytes:
        if self.fail_after is not None and self.position >= self.fail_after:
            raise TimeoutError("read timed out")
        end = len(self.body) if size < 0 else self.position + size
        if self.fail_after is not None:
            end = min(end, self.fail_after)
        chunk = self.body[self.position : end]
        self.position += len(chunk)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class Server:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        reply = self.responses.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    def ranges(self) -> list[str | None]:
        return [request.get_header("Range") for request in self.requests]


@pytest.fixture(autouse=True)
def small_chunks(monkeypatch):
    monkeypatch.setattr(office_download, "CHUNK_SIZE", 1024)


def test_download_resumes_where_a_dropped_connection_stopped(monkeypatch, tmp_path):
    server = Server(
        Response(PAYLOAD, fail_after=5000),
        Response(
            PAYLOAD[5000:],
            status=206,
            headers={"Content-Range": f"bytes 5000-{len(PAYLOAD) - 1}/{len(PAYLOAD)}"},
        ),
    )
    monkeypatch.setattr(office_download, "_open", server)
    target = tmp_path / "installer.msi"

    received = office_download.download(
        "https://mirror.example/x.msi", target, silent_progress(), len(PAYLOAD)
    )

    assert received == len(PAYLOAD)
    assert target.read_bytes() == PAYLOAD
    assert server.ranges() == [None, "bytes=5000-"]


def test_download_starts_over_when_the_server_ignores_the_range(monkeypatch, tmp_path):
    server = Server(Response(PAYLOAD, fail_after=3000), Response(PAYLOAD))
    monkeypatch.setattr(office_download, "_open", server)
    target = tmp_path / "installer.msi"

    office_download.download(
        "https://mirror.example/x.msi", target, silent_progress(), len(PAYLOAD)
    )

    assert target.read_bytes() == PAYLOAD


def test_download_rejects_a_resume_at_the_wrong_offset(monkeypatch, tmp_path):
    server = Server(
        Response(PAYLOAD, fail_after=4000),
        Response(
            PAYLOAD[10:],
            status=206,
            headers={"Content-Range": f"bytes 10-{len(PAYLOAD) - 1}/{len(PAYLOAD)}"},
        ),
    )
    monkeypatch.setattr(office_download, "_open", server)

    with pytest.raises(OpError) as caught:
        office_download.download(
            "https://mirror.example/x.msi", tmp_path / "x.msi", silent_progress(), len(PAYLOAD)
        )

    assert caught.value.data == {"reason": "officeDownload", "phase": "download"}


def test_download_gives_up_after_the_allowed_resumes(monkeypatch, tmp_path):
    drops = [Response(PAYLOAD, fail_after=1000)] + [
        Response(
            PAYLOAD[1000:],
            status=206,
            headers={"Content-Range": f"bytes 1000-{len(PAYLOAD) - 1}/{len(PAYLOAD)}"},
            fail_after=0,
        )
        for _ in range(office_download.RESUME_ATTEMPTS)
    ]
    server = Server(*drops)
    monkeypatch.setattr(office_download, "_open", server)

    with pytest.raises(OpError) as caught:
        office_download.download(
            "https://mirror.example/x.msi", tmp_path / "x.msi", silent_progress(), len(PAYLOAD)
        )

    assert caught.value.code == ErrorCode.NETWORK
    assert len(server.requests) == office_download.RESUME_ATTEMPTS + 1


def test_download_stops_when_cancelled(monkeypatch, tmp_path):
    cancel = threading.Event()
    progress = Progress(lambda *_args: cancel.set(), cancel)
    monkeypatch.setattr(office_download, "_open", Server(Response(PAYLOAD)))

    with pytest.raises(OpError) as caught:
        office_download.download(
            "https://mirror.example/x.msi", tmp_path / "x.msi", progress, len(PAYLOAD)
        )

    assert caught.value.code == ErrorCode.CANCELLED


def headers(length: int) -> Message:
    message = Message()
    message["Content-Length"] = str(length)
    return message


def test_probe_tells_a_missing_file_from_a_silent_server(monkeypatch):
    big = office_download.MIN_INSTALLER_BYTES
    monkeypatch.setattr(
        office_download, "_open", Server(Response(b"", headers={"Content-Length": str(big)}))
    )
    assert office_download.probe("https://a.example/x") == office_download.Probe(True, big)

    monkeypatch.setattr(
        office_download,
        "_open",
        Server(HTTPError("https://a.example/x", 404, "Not Found", headers(0), None)),
    )
    assert office_download.probe("https://a.example/x") == office_download.Probe(True, None)

    monkeypatch.setattr(office_download, "_open", Server(URLError(TimeoutError("timed out"))))
    assert office_download.probe("https://a.example/x") == office_download.Probe(False, None)

    monkeypatch.setattr(
        office_download, "_open", Server(Response(b"", headers={"Content-Length": "512"}))
    )
    assert office_download.probe("https://a.example/x") == office_download.Probe(True, None)


def test_sources_skip_empty_folders_and_stop_asking_silent_mirrors(monkeypatch):
    first, second, third = "https://one.example/", "https://two.example/", "https://three.example/"
    monkeypatch.setattr(office_download, "MIRRORS", (first, second, third))
    asked: list[str] = []
    replies = {
        f"{first}26.8.1/": office_download.Probe(False, None),
        f"{second}26.8.1/": office_download.Probe(True, None),
        f"{third}26.8.1/": office_download.Probe(True, None),
        f"{second}26.2.6/": office_download.Probe(True, 4242),
        f"{third}26.2.6/": office_download.Probe(True, 4242),
    }

    def probe(url):
        asked.append(url)
        return next(reply for prefix, reply in replies.items() if url.startswith(prefix))

    monkeypatch.setattr(office_download, "probe", probe)

    found = list(office_download.sources(DEB, ["26.8.1", "26.2.6"]))

    assert [source.url for source in found] == [
        f"{second}{DEB.path('26.2.6')}",
        f"{third}{DEB.path('26.2.6')}",
    ]
    assert all(source.size == 4242 and source.version == "26.2.6" for source in found)
    assert not any(url.startswith(f"{first}26.2.6/") for url in asked)


def test_versions_come_from_the_first_mirror_that_answers(monkeypatch):
    monkeypatch.setattr(
        office_download, "MIRRORS", ("https://down.example/", "https://up.example/")
    )
    listing = b"".join(
        f'<a href="{version}/">{version}/</a>'.encode()
        for version in ("26.2.6", "26.8.1", "25.8.7", "26.10.0")
    )
    server = Server(URLError("unreachable"), Response(listing))
    monkeypatch.setattr(office_download, "_open", server)

    assert office_download._newest_versions() == ["26.10.0", "26.8.1", "26.2.6"]
    assert [request.full_url for request in server.requests] == [
        "https://down.example/",
        "https://up.example/",
    ]


def test_redirects_may_only_stay_on_https():
    handler = office_download._HttpsOnlyRedirects()
    request = urllib.request.Request("https://mirror.example/x.msi")

    with pytest.raises(URLError):
        handler.redirect_request(
            request, None, 302, "Found", headers(0), "http://plain.example/x.msi"
        )

    moved = handler.redirect_request(
        request, None, 302, "Found", headers(0), "https://other.example/x.msi"
    )
    assert moved.full_url == "https://other.example/x.msi"


def test_every_mirror_is_https():
    assert all(
        mirror.startswith("https://") and mirror.endswith("/stable/")
        for mirror in office_download.MIRRORS
    )
    assert office_download.MIRRORS[-1] == office_download.STABLE_INDEX_URL
