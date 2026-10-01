import hashlib
import http.client
import io
import ssl
import urllib.error

import pytest

from vivepdf.ops import password_breach
from vivepdf.ops.password_breach import PasswordBreachParams
from vivepdf.ops.password_breach import password_breach as check
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress
from vivepdf.rpc.registry import get_operation
from vivepdf.rpc.server import run_operation

UNCOMMON = "Kx9#vQ2!mZr7-Tqw8&Lp"


def sha1_upper(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest().upper()


def run(password: str, online: bool = False):
    return check(PasswordBreachParams(password=password, online=online), silent_progress())


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


class RecordingOpener:
    def __init__(self, payload: bytes = b"", error: Exception | None = None) -> None:
        self.payload = payload
        self.error = error
        self.requests: list = []
        self.timeouts: list[float] = []

    def open(self, request, timeout: float):
        self.requests.append(request)
        self.timeouts.append(timeout)
        if self.error is not None:
            raise self.error
        return FakeResponse(self.payload)


@pytest.fixture
def opener(monkeypatch: pytest.MonkeyPatch) -> RecordingOpener:
    recording = RecordingOpener()
    monkeypatch.setattr(password_breach, "_OPENER", recording)
    return recording


def test_bundled_list_is_sorted_fixed_width_and_large() -> None:
    blob = password_breach.COMMON_PASSWORDS.read_bytes()
    width = password_breach.DIGEST_BYTES
    assert len(blob) % width == 0
    records = [blob[index : index + width] for index in range(0, len(blob), width)]
    assert len(records) > 90_000
    assert records == sorted(records)
    assert len(set(records)) == len(records)


@pytest.mark.parametrize("password", ["123456", "password", "qwerty", "iloveyou", "dragon"])
def test_offline_hit_for_common_passwords(password: str) -> None:
    result = run(password)
    assert result.breached is True
    assert result.source == "offline"
    assert result.count is None


@pytest.mark.parametrize("password", ["PASSWORD", "  password  ", "Password\t", "ＰＡＳＳＷＯＲＤ"])
def test_offline_matches_trimmed_case_folded_and_width_variants(password: str) -> None:
    assert run(password).breached is True


@pytest.mark.parametrize("password", [UNCOMMON, "şğıİüöç-Uzun-Parola-2026!", "   "])
def test_offline_miss(password: str) -> None:
    result = run(password)
    assert result.breached is False
    assert result.source == "offline"


def test_empty_password_is_not_breached_and_never_goes_online(opener: RecordingOpener) -> None:
    result = run("", online=True)
    assert result.breached is False
    assert opener.requests == []


def test_too_long_password_is_rejected_without_echo() -> None:
    secret = "a" * (password_breach.MAX_PASSWORD_LENGTH + 1)
    with pytest.raises(OpError) as caught:
        run(secret)
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert secret not in str(caught.value.to_payload())


def test_offline_mode_never_touches_the_network(opener: RecordingOpener) -> None:
    run("password")
    run(UNCOMMON)
    assert opener.requests == []


def test_online_sends_only_prefix_with_padding_and_parses_count(opener: RecordingOpener) -> None:
    digest = sha1_upper(UNCOMMON)
    opener.payload = (
        f"0000000000000000000000000000000000A:0\r\n{digest[5:]}:42\r\n"
        "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3\r\n"
    ).encode("ascii")
    result = run(UNCOMMON, online=True)
    assert result.breached is True
    assert result.count == 42
    assert result.source == "online"
    request = opener.requests[0]
    assert request.full_url == f"https://api.pwnedpasswords.com/range/{digest[:5]}"
    assert request.get_header("Add-padding") == "true"
    assert request.get_header("User-agent")
    assert request.data is None
    everything_sent = request.full_url + repr(request.header_items())
    assert digest[5:] not in everything_sent
    assert UNCOMMON not in everything_sent
    assert opener.timeouts == [password_breach.REQUEST_TIMEOUT]
    assert password_breach.REQUEST_TIMEOUT <= 5.0


def test_online_miss_returns_zero_count(opener: RecordingOpener) -> None:
    opener.payload = b"0000000000000000000000000000000000A:12\n"
    result = run(UNCOMMON, online=True)
    assert result.breached is False
    assert result.count == 0
    assert result.source == "online"


def test_padding_entry_with_zero_count_is_not_a_breach(opener: RecordingOpener) -> None:
    opener.payload = f"{sha1_upper(UNCOMMON)[5:]}:0\n".encode("ascii")
    assert run(UNCOMMON, online=True).breached is False


def test_online_keeps_offline_variant_hit(opener: RecordingOpener) -> None:
    opener.payload = b""
    result = run("PassWord  ", online=True)
    assert result.breached is True
    assert result.source == "online"


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError("timed out"),
        http.client.IncompleteRead(b""),
        ssl.SSLCertVerificationError("bad certificate"),
        urllib.error.URLError("offline"),
        urllib.error.HTTPError("https://api.pwnedpasswords.com", 503, "down", None, None),
        ConnectionResetError("reset"),
    ],
)
def test_network_failure_falls_back_to_offline(opener: RecordingOpener, error: Exception) -> None:
    opener.error = error
    hit = run("password", online=True)
    miss = run(UNCOMMON, online=True)
    assert (hit.breached, hit.source, hit.count) == (True, "offline", None)
    assert (miss.breached, miss.source, miss.count) == (False, "offline", None)


def test_garbled_or_oversized_answer_falls_back(
    opener: RecordingOpener, monkeypatch: pytest.MonkeyPatch
) -> None:
    opener.payload = "é:1".encode()
    assert run(UNCOMMON, online=True).source == "offline"
    monkeypatch.setattr(password_breach, "MAX_RESPONSE_BYTES", 4)
    opener.payload = b"0123456789"
    assert run(UNCOMMON, online=True).source == "offline"


def test_real_opener_refuses_redirects_and_verifies_tls() -> None:
    handlers = password_breach._OPENER.handlers
    https = [handler for handler in handlers if handler.__class__.__name__ == "HTTPSHandler"]
    assert https and https[0]._context.verify_mode.name == "CERT_REQUIRED"
    assert https[0]._context.check_hostname is True
    redirect = [h for h in handlers if isinstance(h, password_breach._RefuseRedirect)]
    assert redirect and redirect[0].redirect_request() is None


def test_through_rpc_returns_only_the_result_fields(opener: RecordingOpener) -> None:
    operation = get_operation("security.password_breach")
    assert operation is not None
    result = run_operation(
        operation, {"password": "password", "online": False}, silent_progress(), "x"
    )
    assert result.model_dump(by_alias=True, mode="json") == {
        "breached": True,
        "count": None,
        "source": "offline",
        "match": "exact",
    }


def test_params_repr_hides_the_password() -> None:
    params = PasswordBreachParams(password=UNCOMMON)
    assert UNCOMMON not in repr(params)
    assert UNCOMMON not in str(params)


def test_missing_list_is_unsupported(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    password_breach.common_digests.cache_clear()
    monkeypatch.setattr(password_breach, "COMMON_PASSWORDS", tmp_path / "none.bin")
    try:
        with pytest.raises(OpError) as caught:
            run("password")
        assert caught.value.code == ErrorCode.UNSUPPORTED
    finally:
        password_breach.common_digests.cache_clear()


@pytest.mark.parametrize(
    "password",
    [
        "Password2026!",
        "P@ssw0rd!2026",
        "!!dragon99",
        "Qwerty1234$",
        "!Lovey0u2026",
        "Sunsh1ne.2026",
    ],
)
def test_offline_catches_common_manglings_as_variants(password: str) -> None:
    result = run(password)
    assert result.breached is True
    assert result.match == "variant"


def test_exact_list_entries_are_reported_as_exact() -> None:
    assert run("password").match == "exact"
    assert run("P@ssw0rd").match == "exact"


@pytest.mark.parametrize(
    "password", [UNCOMMON, "şğıİüöç-Uzun-Parola-2026!", "zqxw9", "Zx!7", "Tr0ub4dor&3xq"]
)
def test_short_or_unusual_bases_are_not_variants(password: str) -> None:
    result = run(password)
    assert result.breached is False
    assert result.match is None


def test_variant_bases_strip_affixes_and_undo_symbol_swaps() -> None:
    bases = password_breach.variant_bases("P@ssw0rd2026!")
    assert "password" in bases
    assert "p@ssw0rd2026!" not in bases
    assert all(len(base) >= password_breach.MIN_VARIANT_BASE for base in bases)


def test_online_zero_count_keeps_the_offline_variant(opener: RecordingOpener) -> None:
    opener.payload = b""
    result = run("Password2026!", online=True)
    assert result.breached is True
    assert result.count == 0
    assert result.match == "variant"


def test_online_hit_is_exact_even_when_offline_only_saw_a_variant(opener: RecordingOpener) -> None:
    opener.payload = f"{sha1_upper('Password2026!')[5:]}:17\r\n".encode()
    result = run("Password2026!", online=True)
    assert result.match == "exact"
    assert result.count == 17
