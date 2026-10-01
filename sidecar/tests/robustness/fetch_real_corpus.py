import argparse
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

MANIFEST = Path(__file__).with_name("real_corpus.json")
DEFAULT_TARGET = Path(__file__).resolve().parents[3] / ".corpus" / "real"
AGENT = {"User-Agent": "vivepdf-corpus/1.0 (+https://github.com/vivepdf)"}
ATTEMPTS = 3


def download(url: str) -> bytes:
    for attempt in range(1, ATTEMPTS + 1):
        try:
            request = urllib.request.Request(url, headers=AGENT)
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except OSError:
            if attempt == ATTEMPTS:
                raise
            time.sleep(2 * attempt)
    raise RuntimeError("unreachable")


def fetch(target: Path, pin: bool) -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    failures: list[str] = []
    fetched = 0
    for entry in manifest["documents"]:
        path = target / entry["source"] / entry["name"]
        expected = entry.get("sha256")
        if path.exists() and expected and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            continue
        try:
            data = download(entry["url"])
        except OSError as error:
            failures.append(f"{entry['url']}: {error}")
            continue
        digest = hashlib.sha256(data).hexdigest()
        if not data.startswith(b"%PDF") and b"%PDF" not in data[:1024]:
            failures.append(f"{entry['url']}: not a PDF")
            continue
        if expected and digest != expected:
            failures.append(f"{entry['url']}: sha256 {digest} does not match the manifest")
            continue
        if pin:
            entry["sha256"] = digest
            entry["bytes"] = len(data)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        fetched += 1
    if pin:
        MANIFEST.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    print(f"fetched {fetched}, {len(manifest['documents'])} listed, into {target}")
    for failure in failures:
        print("failed:", failure, file=sys.stderr)
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the real-document robustness corpus.")
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--pin", action="store_true", help="record sha256 and size of new entries")
    arguments = parser.parse_args()
    sys.exit(fetch(arguments.target, arguments.pin))


if __name__ == "__main__":
    main()
