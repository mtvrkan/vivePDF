#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/apps/desktop/src-tauri/resources/libreoffice"
MIRROR="https://download.documentfoundation.org/libreoffice/stable"
WORK="${TMPDIR:-/tmp}/vivepdf-libreoffice"
mkdir -p "$WORK"

if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL "$MIRROR/" | grep -oE 'href="[0-9]+\.[0-9]+\.[0-9]+/"' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -n1)"
fi

find "$DEST" -mindepth 1 ! -name .gitkeep -exec rm -rf {} + 2>/dev/null || true
mkdir -p "$DEST"

case "$(uname -s)" in
  Linux)
    ARCHIVE="LibreOffice_${VERSION}_Linux_x86-64_deb.tar.gz"
    curl -fL "$MIRROR/$VERSION/deb/x86_64/$ARCHIVE" -o "$WORK/$ARCHIVE"
    rm -rf "$WORK/deb" && mkdir -p "$WORK/deb"
    tar -xzf "$WORK/$ARCHIVE" -C "$WORK/deb"
    for deb in "$WORK"/deb/*/DEBS/*.deb; do dpkg-deb -x "$deb" "$WORK/deb/root"; done
    cp -R "$WORK"/deb/root/opt/libreoffice*/. "$DEST/"
    ;;
  Darwin)
    ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] && ARCH="aarch64" || ARCH="x86-64"
    DMG="LibreOffice_${VERSION}_MacOS_${ARCH}.dmg"
    curl -fL "$MIRROR/$VERSION/mac/$ARCH/$DMG" -o "$WORK/$DMG"
    MOUNT="$(hdiutil attach -nobrowse -readonly "$WORK/$DMG" | awk -F'\t' '/Volumes/ {print $NF}')"
    cp -R "$MOUNT/LibreOffice.app" "$DEST/"
    hdiutil detach "$MOUNT"
    ;;
  *)
    echo "Unsupported platform; use fetch-libreoffice.ps1 on Windows" >&2
    exit 1
    ;;
esac

for trim in share/extensions help readmes share/wizards share/template share/gallery sdk; do
  rm -rf "$DEST/$trim" "$DEST/LibreOffice.app/Contents/Resources/$trim" 2>/dev/null || true
done
echo "LibreOffice $VERSION ready at $DEST ($(du -sh "$DEST" | cut -f1))"
