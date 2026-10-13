import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from vivepdf.external import office_download, office_packages
from vivepdf.rpc.errors import ErrorCode, OpError

PINNED = office_packages.TDF_SIGNING_FINGERPRINT
SUBKEY = "186E7249C8D1276865EA987DB93EA4B367BD5E4C"
FOREIGN = "0123456789ABCDEF0123456789ABCDEF01234567"
UNSIGNED = {"tool": "gpgv", "reason": "officeUnsigned", "phase": "verify"}


def status(*lines: str) -> str:
    return "\n".join(f"[GNUPG:] {line}" for line in lines) + "\n"


def valid(signer: str = PINNED, primary: str = PINNED, digest: str = "8", kind: str = "00") -> str:
    return f"VALIDSIG {signer} 2026-09-03 1788449245 0 4 0 1 {digest} {kind} {primary}"


GOOD = (
    "GOODSIG F434A1EFAFEEAEA3 LibreOffice Build Team (CODE SIGNING KEY)"
    " <build@documentfoundation.org>"
)


def test_the_shipped_key_is_the_pinned_document_foundation_key():
    digest = hashlib.sha256(office_packages.TDF_KEYRING.read_bytes()).hexdigest()

    assert digest == office_packages.TDF_KEYRING_SHA256
    assert office_packages.TDF_SIGNING_FINGERPRINT == "C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA3"


@pytest.mark.parametrize("signer", [PINNED, SUBKEY])
def test_a_good_signature_of_the_pinned_key_or_its_subkey_is_accepted(signer):
    assert office_packages.signed_by(status("NEWSIG", GOOD, valid(signer=signer)), PINNED)


@pytest.mark.parametrize(
    "lines",
    [
        (GOOD, valid(primary=FOREIGN)),
        (GOOD, valid(digest="2")),
        (GOOD, valid(kind="01")),
        (GOOD, valid(), GOOD, valid()),
        (valid(),),
        (GOOD,),
        ("BADSIG F434A1EFAFEEAEA3 LibreOffice", valid()),
        ("ERRSIG F434A1EFAFEEAEA3 1 8 00 1788449245 9", GOOD, valid()),
        ("NO_PUBKEY F434A1EFAFEEAEA3", GOOD, valid()),
        ("EXPKEYSIG F434A1EFAFEEAEA3 LibreOffice", GOOD, valid()),
        ("REVKEYSIG F434A1EFAFEEAEA3 LibreOffice", GOOD, valid()),
        ("EXPSIG F434A1EFAFEEAEA3 LibreOffice", GOOD, valid()),
    ],
)
def test_foreign_weak_doubled_or_failed_signatures_are_refused(lines):
    assert not office_packages.signed_by(status(*lines), PINNED)


def test_lines_without_the_status_prefix_are_ignored():
    text = f"{GOOD}\n{valid()}\n"

    assert not office_packages.signed_by(text, PINNED)


def test_a_damaged_key_file_stops_before_gpgv_runs(monkeypatch, tmp_path):
    damaged = tmp_path / "keyring.gpg"
    damaged.write_bytes(b"not the key")
    monkeypatch.setattr(office_packages, "TDF_KEYRING", damaged)
    ran: list[list[str]] = []
    monkeypatch.setattr(
        office_packages, "run_tool", lambda arguments, *_a, **_k: ran.append(arguments)
    )

    with pytest.raises(OpError) as caught:
        office_packages.verify_deb_signature(tmp_path / "x.tar.gz", b"sig", "gpgv")

    assert caught.value.data == UNSIGNED
    assert ran == []


def test_gpgv_runs_with_an_empty_home_and_only_the_pinned_key(monkeypatch, tmp_path):
    installer = tmp_path / "libreoffice.deb"
    installer.write_bytes(b"payload")
    seen: list[list[str]] = []

    def run_tool(arguments, _timeout, tool, env=None):
        seen.append(arguments)
        home = Path(arguments[arguments.index("--homedir") + 1])
        assert tool == "gpgv"
        assert home.is_dir() and not any(home.iterdir())
        assert Path(arguments[-2]).read_bytes() == b"signature"
        return subprocess.CompletedProcess(arguments, 0, status(GOOD, valid()), "")

    monkeypatch.setattr(office_packages, "run_tool", run_tool)

    office_packages.verify_deb_signature(installer, b"signature", "gpgv")

    arguments = seen[0]
    assert arguments[0] == "gpgv"
    assert arguments[arguments.index("--keyring") + 1] == str(office_packages.TDF_KEYRING)
    assert arguments[-1] == str(installer)
    assert sorted(path.name for path in tmp_path.iterdir()) == ["libreoffice.deb"]


def test_a_gpgv_failure_or_timeout_is_a_retryable_verify_error(monkeypatch, tmp_path):
    def run_tool(*_args, **_kwargs):
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED, "gpgv timed out", {"tool": "gpgv", "reason": "timeout"}
        )

    monkeypatch.setattr(office_packages, "run_tool", run_tool)

    with pytest.raises(OpError) as caught:
        office_packages.verify_deb_signature(tmp_path / "x.tar.gz", b"sig", "gpgv")

    assert caught.value.code == ErrorCode.EXTERNAL_TOOL_FAILED
    assert caught.value.data == UNSIGNED


class FakeResponse:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def read(self, limit: int) -> bytes:
        return self.body[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None


def test_the_signature_comes_from_the_same_mirror_and_stays_small(monkeypatch):
    requested: list[str] = []

    def answer(request, _timeout):
        requested.append(request.full_url)
        return FakeResponse(b"-----BEGIN PGP SIGNATURE-----")

    monkeypatch.setattr(office_download, "_open", answer)
    assert office_download.fetch_signature("https://mirror.example/a.tar.gz").startswith(
        b"-----BEGIN"
    )
    assert requested == ["https://mirror.example/a.tar.gz.asc"]

    monkeypatch.setattr(office_download, "_open", lambda *_a: FakeResponse(b"x" * 20000))
    with pytest.raises(OpError) as oversized:
        office_download.fetch_signature("https://mirror.example/a.tar.gz")
    assert oversized.value.data == UNSIGNED


def test_a_missing_signature_is_a_network_error_for_that_mirror(monkeypatch):
    def refuse(*_args):
        raise OSError("404")

    monkeypatch.setattr(office_download, "_open", refuse)

    with pytest.raises(OpError) as caught:
        office_download.fetch_signature("https://mirror.example/a.tar.gz")

    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data == UNSIGNED


def gpg(home: Path, *arguments: str) -> str:
    completed = subprocess.run(  # noqa: S603
        [shutil.which("gpg") or "gpg", "--batch", "--homedir", str(home), *arguments],
        capture_output=True,
        text=True,
        check=True,
    )
    return completed.stdout


def new_key(home: Path, name: str) -> str:
    gpg(
        home,
        "--pinentry-mode",
        "loopback",
        "--passphrase",
        "",
        "--quick-gen-key",
        f"{name} <test@invalid>",
        "ed25519",
        "sign",
        "1d",
    )
    listing = gpg(home, "--with-colons", "--list-keys", f"{name} <test@invalid>")
    return next(line.split(":")[9] for line in listing.splitlines() if line.startswith("fpr:"))


@pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("gpg") is None or shutil.which("gpgv") is None,
    reason="needs native gpg and gpgv; the Linux install is the only caller",
)
def test_real_gpgv_accepts_the_pinned_signer_and_refuses_tampering_and_other_keys(
    monkeypatch, tmp_path
):
    pinned_home = tmp_path / "pinned"
    other_home = tmp_path / "other"
    for home in (pinned_home, other_home):
        home.mkdir(mode=0o700)
    fingerprint = new_key(pinned_home, "vivePDF Test")
    new_key(other_home, "Someone Else")
    keyring = tmp_path / "keyring.gpg"
    keyring.write_bytes(
        subprocess.run(
            [
                shutil.which("gpg") or "gpg",
                "--batch",
                "--homedir",
                str(pinned_home),
                "--export",
                fingerprint,
            ],
            capture_output=True,
            check=True,
        ).stdout
    )  # noqa: S603
    monkeypatch.setattr(office_packages, "TDF_KEYRING", keyring)
    monkeypatch.setattr(
        office_packages, "TDF_KEYRING_SHA256", hashlib.sha256(keyring.read_bytes()).hexdigest()
    )
    monkeypatch.setattr(office_packages, "TDF_SIGNING_FINGERPRINT", fingerprint)
    staging = tmp_path / "staging"
    staging.mkdir()
    installer = staging / "libreoffice.deb"
    installer.write_bytes(b"LibreOffice payload")
    gpg(pinned_home, "--armor", "--detach-sign", "-o", str(tmp_path / "good.asc"), str(installer))
    gpg(other_home, "--armor", "--detach-sign", "-o", str(tmp_path / "other.asc"), str(installer))
    gpgv = office_packages.gpgv_path() or "gpgv"

    office_packages.verify_deb_signature(installer, (tmp_path / "good.asc").read_bytes(), gpgv)

    with pytest.raises(OpError):
        office_packages.verify_deb_signature(installer, (tmp_path / "other.asc").read_bytes(), gpgv)
    installer.write_bytes(b"LibreOffice payload!")
    with pytest.raises(OpError):
        office_packages.verify_deb_signature(installer, (tmp_path / "good.asc").read_bytes(), gpgv)
