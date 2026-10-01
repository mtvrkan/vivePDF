#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
engine="${1:-$root/apps/desktop/src-tauri/binaries/engine}"
identity="${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY is required}"

fail() {
  echo "sign-engine-macos: $1" >&2
  exit 1
}

[ -d "$engine" ] || fail "engine directory not found: $engine"

if [ -n "${APPLE_CERTIFICATE:-}" ]; then
  keychain="$RUNNER_TEMP/engine-signing.keychain-db"
  keychain_password="$(uuidgen)"
  certificate="$RUNNER_TEMP/engine-signing-certificate.p12"
  echo "$APPLE_CERTIFICATE" | base64 --decode > "$certificate"
  security create-keychain -p "$keychain_password" "$keychain"
  security set-keychain-settings -lut 3600 "$keychain"
  security unlock-keychain -p "$keychain_password" "$keychain"
  security import "$certificate" -k "$keychain" -P "${APPLE_CERTIFICATE_PASSWORD:-}" -T /usr/bin/codesign
  security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain"
  security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
  rm -f "$certificate"
fi

signed=0
while IFS= read -r candidate; do
  if file -b "$candidate" | grep -q "Mach-O"; then
    codesign --force --timestamp --options runtime --sign "$identity" "$candidate"
    signed=$((signed + 1))
  fi
done < <(find "$engine" -type f ! -name "vivepdf-sidecar" ! -name "vivepdf-cli")

for executable in vivepdf-sidecar vivepdf-cli; do
  codesign --force --timestamp --options runtime --sign "$identity" "$engine/$executable"
  signed=$((signed + 1))
done

echo "signed $signed Mach-O files under $engine"
