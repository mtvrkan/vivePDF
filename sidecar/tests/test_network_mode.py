import urllib.request
from collections.abc import Callable, Iterator
from pathlib import Path
from types import SimpleNamespace

import pymupdf
import pytest
from pydantic import SecretStr

from vivepdf import net
from vivepdf.external import office_download
from vivepdf.ops import _font_download, password_breach, sources, tessdata, translate, tts, web
from vivepdf.ops.sign_verify import VerifyParams, verify
from vivepdf.ops.system import NetworkModeParams, network_mode
from vivepdf.ops.translate_catalog import CATALOG
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def offline() -> Iterator[None]:
    network_mode(NetworkModeParams(offline=True), silent_progress())
    yield
    network_mode(NetworkModeParams(offline=False), silent_progress())


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    def refuse(*args, **kwargs):
        calls.append("network")
        raise AssertionError("the network was used in offline mode")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", refuse)
    return calls


def _font_entry() -> SimpleNamespace:
    return SimpleNamespace(name="Inter.ttf", size=10, sha256="0" * 64)


CHOKEPOINTS: dict[str, Callable[[Path], object]] = {
    "tts": lambda tmp: tts._fetch(
        "https://huggingface.co/x.onnx", tmp / "x.onnx", silent_progress(), "x", (0.0, 1.0)
    ),
    "tessdata": lambda tmp: tessdata._fetch("deu", tmp, silent_progress()),
    "fonts": lambda tmp: _font_download.fetch_font_file(
        "inter", _font_entry(), tmp, silent_progress(), 0, 1, "https://example.com"
    ),
    "translate": lambda tmp: translate._fetch_archive(CATALOG[0], tmp / "m.zip", silent_progress()),
    "sources": lambda _tmp: sources._get("https://api.crossref.org/works/10.1000/x", "*/*"),
    "web": lambda _tmp: web.fetch("https://example.com/", 1024),
    "office": lambda _tmp: office_download._open(
        urllib.request.Request(office_download.STABLE_INDEX_URL), 1.0
    ),
    "breach": lambda _tmp: password_breach.range_payload("ABCDE"),
}


@pytest.mark.parametrize("name", sorted(CHOKEPOINTS))
def test_every_download_and_lookup_refuses_without_touching_the_network(
    name: str, offline: None, no_network: list[str], tmp_path: Path
):
    with pytest.raises(OpError) as raised:
        CHOKEPOINTS[name](tmp_path)

    assert raised.value.code == ErrorCode.OFFLINE
    assert raised.value.data and raised.value.data["feature"]
    assert no_network == []


def test_switching_offline_mode_off_lets_requests_through_again(offline: None):
    network_mode(NetworkModeParams(offline=False), silent_progress())

    assert not net.is_offline()
    net.require_online("anything")


def test_leaked_password_check_falls_back_to_the_built_in_list(
    offline: None, no_network: list[str]
):
    result = password_breach.password_breach(
        password_breach.PasswordBreachParams(password=SecretStr("password123"), online=True),
        silent_progress(),
    )

    assert result.source == "offline"
    assert result.breached
    assert no_network == []


def test_source_check_reports_offline_instead_of_a_failed_lookup(
    offline: None, no_network: list[str]
):
    with pytest.raises(OpError) as raised:
        sources._check_one("10.1000/xyz123")

    assert raised.value.code == ErrorCode.OFFLINE


def test_online_signature_check_is_refused_but_the_offline_one_still_runs(
    offline: None, tmp_path: Path
):
    path = tmp_path / "plain.pdf"
    with pymupdf.open() as document:
        document.new_page()
        document.save(path)

    with pytest.raises(OpError) as raised:
        verify(VerifyParams(path=str(path), online=True), silent_progress())

    assert raised.value.code == ErrorCode.OFFLINE
    assert verify(VerifyParams(path=str(path)), silent_progress()).signatures == []
