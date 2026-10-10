#!/bin/zsh
# Type-checks Core + Engine plus the given files/folders against the iOS simulator SDK, without the
# rest of the app. Lets modules be developed in parallel even while other modules are mid-edit.
#   scripts/typecheck.sh VivePDF/Features/Tools/Merge VivePDF/Engine/PDFCore
set -e
cd "${0:A:h}/.."
files=(${(f)"$(find VivePDF/Core -name '*.swift')"} VivePDF/App/AppModel.swift)
for p in "$@"; do
  if [[ -d $p ]]; then files+=(${(f)"$(find $p -name '*.swift')"}); else files+=($p); fi
done
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun --sdk iphonesimulator swiftc -typecheck -sdk "$sdk" -target arm64-apple-ios17.0-simulator \
  -module-name vivePDF -swift-version 5 "${files[@]}" 2>&1 | grep -E "error|warning: (unre|var)" || echo "typecheck ok (${#files[@]} files)"
