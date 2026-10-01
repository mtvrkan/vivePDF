import argparse
import importlib
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "sidecar"))

SOURCE_URL = (
    "https://raw.githubusercontent.com/danielmiessler/SecLists/"
    "c205c36a445bff37f8e58a9ec829105cd4975c58/Passwords/Common-Credentials/"
    "xato-net-10-million-passwords-100000.txt"
)


def read_source(path: str | None) -> str:
    if path:
        return Path(path).read_text(encoding="utf-8")
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "vivePDF"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    arguments = parser.parse_args()
    breach = importlib.import_module("vivepdf.ops.password_breach")
    entries = {line.strip() for line in read_source(arguments.source).splitlines()}
    digests = sorted({breach.list_digest(entry) for entry in entries if entry})
    target = breach.COMMON_PASSWORDS
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"".join(digests))
    print(f"{len(digests)} digests -> {target}")


if __name__ == "__main__":
    main()
