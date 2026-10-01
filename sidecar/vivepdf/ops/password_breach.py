import functools
import hashlib
import http.client
import re
import ssl
import unicodedata
import urllib.error
import urllib.request
from bisect import bisect_left
from pathlib import Path
from typing import Literal

from pydantic import SecretStr

from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

COMMON_PASSWORDS = (
    Path(__file__).resolve().parent.parent / "assets" / "passwords" / "common-sha1-64.bin"
)
DIGEST_BYTES = 8
RANGE_URL = "https://api.pwnedpasswords.com/range/"
PREFIX_LENGTH = 5
REQUEST_TIMEOUT = 5.0
USER_AGENT = "vivePDF-password-check"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_PASSWORD_LENGTH = 1024
MIN_VARIANT_BASE = 4
AFFIX = re.compile(r"^[\d\W_]+|[\d\W_]+$")
LEET = str.maketrans(
    {"@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t"}
)
LEET_L = str.maketrans({"1": "l", "!": "l"})

BreachSource = Literal["offline", "online"]
BreachMatch = Literal["exact", "variant"]


class PasswordBreachParams(RpcModel):
    password: SecretStr
    online: bool = False


class PasswordBreachResult(RpcModel):
    breached: bool
    count: int | None = None
    source: BreachSource
    match: BreachMatch | None = None


class _Digests:
    def __init__(self, blob: bytes) -> None:
        self._blob = blob

    def __len__(self) -> int:
        return len(self._blob) // DIGEST_BYTES

    def __getitem__(self, index: int) -> bytes:
        start = index * DIGEST_BYTES
        return self._blob[start : start + DIGEST_BYTES]

    def __contains__(self, digest: object) -> bool:
        index = bisect_left(self, digest)
        return index < len(self) and self[index] == digest


class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args: object, **_kwargs: object) -> None:
        return None


_OPENER = urllib.request.build_opener(
    _RefuseRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context())
)


def normalized(password: str) -> str:
    return unicodedata.normalize("NFKC", password.strip()).casefold()


def _digest(text: str) -> bytes:
    return hashlib.sha1(text.encode("utf-8"), usedforsecurity=False).digest()[:DIGEST_BYTES]


def list_digest(password: str) -> bytes:
    return _digest(normalized(password))


@functools.cache
def common_digests() -> _Digests:
    try:
        blob = COMMON_PASSWORDS.read_bytes()
    except OSError as error:
        raise OpError(
            ErrorCode.UNSUPPORTED, "breached password list missing", {"reason": "listMissing"}
        ) from error
    if not blob or len(blob) % DIGEST_BYTES:
        raise OpError(
            ErrorCode.UNSUPPORTED, "breached password list damaged", {"reason": "listDamaged"}
        )
    return _Digests(blob)


def variant_bases(password: str) -> set[str]:
    base = normalized(password)
    stripped = AFFIX.sub("", base)
    candidates = {stripped}
    for text in (base, stripped):
        decoded = text.translate(LEET)
        candidates.update({decoded, AFFIX.sub("", decoded), text.translate(LEET_L).translate(LEET)})
    candidates.discard(base)
    return {text for text in candidates if len(text) >= MIN_VARIANT_BASE}


def offline_match(password: str) -> BreachMatch | None:
    if not normalized(password):
        return None
    digests = common_digests()
    if list_digest(password) in digests:
        return "exact"
    if any(_digest(text) in digests for text in variant_bases(password)):
        return "variant"
    return None


def breached_offline(password: str) -> bool:
    return offline_match(password) is not None


def range_payload(prefix: str) -> bytes:
    request = urllib.request.Request(
        RANGE_URL + prefix,
        headers={"User-Agent": USER_AGENT, "Add-Padding": "true", "Accept": "text/plain"},
    )
    with _OPENER.open(request, timeout=REQUEST_TIMEOUT) as response:
        payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("range response too large")
    return payload


def count_in_range(payload: bytes, suffix: str) -> int:
    for line in payload.decode("ascii").splitlines():
        candidate, separator, count = line.strip().partition(":")
        if separator and candidate.upper() == suffix:
            return int(count)
    return 0


def breach_count_online(password: str) -> int | None:
    digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest().upper()
    try:
        payload = range_payload(digest[:PREFIX_LENGTH])
        return count_in_range(payload, digest[PREFIX_LENGTH:])
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError):
        return None


@op("security.password_breach", PasswordBreachParams)
def password_breach(params: PasswordBreachParams, progress: Progress) -> PasswordBreachResult:
    password = params.password.get_secret_value()
    if len(password) > MAX_PASSWORD_LENGTH:
        raise OpError(ErrorCode.INVALID_PARAMS, "password too long", {"reason": "tooLong"})
    if not password:
        return PasswordBreachResult(breached=False, source="offline")
    offline = offline_match(password)
    if not params.online:
        return PasswordBreachResult(breached=offline is not None, source="offline", match=offline)
    progress.check_cancelled()
    count = breach_count_online(password)
    if count is None:
        return PasswordBreachResult(breached=offline is not None, source="offline", match=offline)
    match = "exact" if count > 0 else offline
    return PasswordBreachResult(
        breached=match is not None, count=count, source="online", match=match
    )
