#!/usr/bin/env bash
set -euo pipefail
engine="${1:?usage: smoke-engine.sh <engine directory>}"
ping_request='{"id":"1","method":"system.ping","params":{}}'

fail() {
  echo "smoke-engine: $1" >&2
  exit 1
}

[ -d "$engine" ] || fail "engine directory not found: $engine"
suffix=""
[ -f "$engine/vivepdf-cli.exe" ] && suffix=".exe"

"$engine/vivepdf-cli$suffix" selftest || fail "engine selftest failed"

qpdf="$(find "$engine/_internal" \( -name 'qpdf*.dll' -o -name 'libqpdf*' \) -print -quit)"
[ -n "$qpdf" ] || fail "qpdf library missing under engine/_internal"
echo "qpdf -> ${qpdf#"$engine/"}"

started=$SECONDS
response="$(printf '%s\n' "$ping_request" | "$engine/vivepdf-sidecar$suffix")"
echo "$response" | grep -Eq '"id": ?"1"' || fail "engine ping got no answer: $response"
echo "engine ping answered and exited in $((SECONDS - started)) s"
