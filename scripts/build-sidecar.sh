#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/apps/desktop/src-tauri/binaries"
engine="$dest/engine"

(
  cd "$root/sidecar"
  uv sync --group dev
  uv run pyinstaller vivepdf-sidecar.spec --noconfirm --clean
)

rm -rf "$dest"
mkdir -p "$dest"
cp -Rp "$root/sidecar/dist/vivepdf-engine" "$engine"
echo "engine -> $engine"

bash "$root/scripts/smoke-engine.sh" "$engine"

(
  cd "$root/sidecar"
  uv run python "$root/scripts/engine-smoke.py" "$engine"
)
