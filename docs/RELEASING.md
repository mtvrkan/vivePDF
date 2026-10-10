# Releasing and updating vivePDF

The desktop app ships its own updater (`tauri-plugin-updater`). Users get a signed update
offer inside the app; nothing is installed without their confirmation. This page describes
how a new version reaches them.

## How the in-app updater behaves

| Moment | What happens |
|---|---|
| App start (release builds only) | 5 s after launch, if *Ayarlar › Güncellemeler › Açılışta otomatik denetle* is on, the app fetches the manifest at the configured endpoint. Only version metadata travels; nothing is downloaded. |
| Update available | The top bar shows a green "vX.Y.Z hazır" pill; Settings shows the version, release notes and *İndir ve yükle*. |
| Install | Download progress is shown; the installer runs in passive mode on Windows; the app then offers *Yeniden başlat*. |
| Manual | *Güncellemeleri denetle* in Settings or in the Help menu at any time. |
| Not configured | Until the public key and endpoint are set, the status reads "Güncelleme kanalı henüz yapılandırılmadı" and auto-check stays silent. |

## One-time setup (owner does this once, locally)

1. Generate the signing key pair. Keep the private key out of the repository; it is credential material.
   ```
   cd apps/desktop
   pnpm tauri signer generate -w ~/.tauri/vivepdf.key
   ```
2. Paste the printed **public** key into `apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`. This is the only field still empty; everything else is configured.
3. Add the private key and its password as the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` so the release workflow can sign the artefacts.

The endpoint already points at `https://github.com/mtvrkan/vivePDF/releases/latest/download/latest.json`.
The release workflow refuses to run while the secret or `plugins.updater.pubkey` is empty.

## What gets packaged

The Python engine is one PyInstaller **onedir** folder built from `sidecar/vivepdf-sidecar.spec`:

```
engine/
  vivepdf-sidecar(.exe)   JSON-RPC engine the app spawns
  vivepdf-cli(.exe)       command-line entry point (launcher for vivepdf-sidecar --cli)
  _internal/              shared Python runtime and libraries (pikepdf's qpdf, onnxruntime, …)
```

`scripts/build-sidecar.ps1` (or `.sh`) builds it, copies it to
`apps/desktop/src-tauri/binaries/engine/` and fails unless the copy passes its self-checks:
`vivepdf-cli selftest` exits 0, a qpdf library exists under `_internal/`, the engine answers a
`system.ping` and exits when stdin closes, and on Windows no relative path under `engine/` is
160 characters or longer. `scripts/smoke-engine.sh <engine dir>` runs the same checks against any
engine folder, including one inside an installed app.

`src-tauri/tauri.release.conf.json` adds that folder as `bundle.resources` (`engine/` next to the
app's other resources) and sets ad-hoc macOS signing. Only release bundles use it, so
`pnpm tauri dev`, `cargo clippy` and `cargo test` never need the engine. A release build spawns
`<resource dir>/engine/vivepdf-sidecar` by absolute path; a missing engine is reported as
`SIDECAR_SPAWN_FAILED` ("engine missing: …").

Where the CLI ends up after installation:

| OS | Path |
|---|---|
| Windows | `<install dir>\engine\vivepdf-cli.exe` (default install dir: `%LOCALAPPDATA%\vivePDF`) |
| macOS | `vivePDF.app/Contents/Resources/engine/vivepdf-cli` |
| Linux (deb) | `/usr/lib/vivePDF/engine/vivepdf-cli` |
| Linux (AppImage) | inside the image; run `--appimage-extract` to reach it |

The Windows installer deletes `engine\` before installing and after uninstalling, so an update
never leaves files of an older engine behind.

LibreOffice is not bundled. Windows downloads it on request (Settings › Tools, `system.office_install`)
and only extracts an MSI whose Authenticode signature is valid and issued to The Document
Foundation. macOS and Linux use a LibreOffice installed on the system. `scripts/fetch-libreoffice.*`
only prepare a development copy under `apps/desktop/src-tauri/resources/libreoffice/`.

Only the Latin fallback font (Noto Sans, Latin/Greek/Cyrillic/Vietnamese) ships in the installer.
The Japanese, Korean and Simplified/Traditional Chinese fonts are downloaded on request by
`system.fallback_fonts_download` from the `fonts-1` release of this repository into
`<user data dir>/fallback-fonts`, and must match the sizes and SHA-256 values in
`apps/desktop/src/features/viewer/pdf/fallbackFonts.json` (mirrored in
`sidecar/vivepdf/ops/fallback_fonts.py`). The app serves both through the `vivepdf-font` scheme
(`src-tauri/src/font_source.rs`). Publish that release once, not marked as latest so the updater
never looks at it, with the four OTF files from the `@embedpdf/fonts-jp`, `-kr`, `-sc` and `-tc`
packages and their licence:

```
gh release create fonts-1 NotoSansJP-Regular.otf NotoSansKR-Regular.otf NotoSansHans-Regular.otf NotoSansHant-Regular.otf OFL.txt --title "Fallback fonts 1" --notes "Noto Sans CJK fallback fonts for vivePDF (SIL Open Font License 1.1)" --latest=false
```

The Studio font library (24 OFL families from Google Fonts, static Regular/Bold/Italic/Bold Italic
cuts, each checked for Turkish letters) is downloaded on request by `fonts.library_download` from the
`fonts-2` release into `<user data dir>/font-library`, and must match
`sidecar/vivepdf/ops/font_library_catalog.py`. Both the files and that table come from
`scripts/gen_font_library.py`, which reads a pinned google/fonts commit; run it from `sidecar/` with
`uv run python ../scripts/gen_font_library.py` and publish everything it writes to
`sidecar/build/fonts-2/` (the `.ttf` files and one `<Family>-OFL.txt` per family):

```
gh release create fonts-2 sidecar/build/fonts-2/* --title "Studio font library 2" --notes "Open-licensed fonts for vivePDF Studio (SIL Open Font License 1.1), built from google/fonts" --latest=false
```

A new font version goes into a new `fonts-N` release with the manifest, the sidecar table and
`downloadBase` updated together; never replace files inside an existing one, installed apps check
them against the old digests.

## Cutting a release

Releases are built and published locally; GitHub Actions is switched off for the repository
(Settings › Actions) and stays off unless the owner decides otherwise. Windows and macOS (Apple
silicon) are built locally, so `latest.json` carries `windows-x86_64` and `darwin-aarch64` entries
until Linux and Intel Mac builds exist.

1. Bump the version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`
   and `apps/desktop/package.json` (same value everywhere) and add a `## [X.Y.Z] - YYYY-MM-DD`
   heading under `## [Unreleased]` in `CHANGELOG.md`; commit.
2. Build the engine (`scripts/build-sidecar.ps1`, which runs its self-checks) and the installer
   without the updater signature:
   ```
   cd apps/desktop
   pnpm tauri build --config src-tauri/tauri.release.conf.json --config '{"bundle":{"createUpdaterArtifacts":false}}'
   ```
   then run `scripts/smoke-engine.sh apps/desktop/src-tauri/target/release/engine`.
3. Sign the installer for the updater (prompts for the key's password, writes a `.sig` next to it):
   ```
   pnpm tauri signer sign -f ~/.tauri/vivepdf.key src-tauri/target/release/bundle/nsis/vivePDF_X.Y.Z_x64-setup.exe
   ```
4. On the Mac (macOS 14 or later, Xcode command line tools, Rust, Node 22 + pnpm 10, uv), build
   the engine with `scripts/build-sidecar.sh` (same self-checks), then the app from `apps/desktop`
   with the same `pnpm tauri build …` command as in step 2. The macOS-only settings (native title
   bar with traffic lights, `minimumSystemVersion` 14.0, which is the oldest system the bundled
   numpy/onnxruntime/qpdf libraries load on) live in `src-tauri/tauri.macos.conf.json`, which Tauri
   merges on macOS only. Run `scripts/smoke-engine.sh src-tauri/target/release/bundle/macos/vivePDF.app/Contents/Resources/engine`,
   then sign the updater archive:
   ```
   pnpm tauri signer sign -f ~/.tauri/vivepdf.key src-tauri/target/release/bundle/macos/vivePDF.app.tar.gz
   ```
   Upload `vivePDF_X.Y.Z_aarch64.dmg` for people installing by hand and
   `vivePDF_X.Y.Z_aarch64.app.tar.gz` + `.sig` for the updater (`darwin-aarch64` entry). Without the
   updater key on the Mac, skip `createUpdaterArtifacts` and upload only the `.dmg`; installed Mac
   apps then simply see no update.
5. Write `latest.json` (shape below, the platforms built above), tag `vX.Y.Z`, push the tag and run
   `gh release create vX.Y.Z <installers> <signatures> latest.json --title "vivePDF X.Y.Z" --notes-file <notes>`.
6. Check that `https://github.com/mtvrkan/vivePDF/releases/latest/download/latest.json` answers
   without signing in; installed apps pick the new version up on their next start or manual check.

The rest of this section describes the four-platform workflow kept in the repository for when
Actions is turned back on.

Push a `vX.Y.Z` tag and `.github/workflows/release.yml` does the rest by calling
`.github/workflows/bundle.yml` with `publish: true`. Four runners build in parallel:

| Platform | Runner | Target |
|---|---|---|
| windows-x64 | `windows-latest` | host |
| macos-arm64 | `macos-latest` | `aarch64-apple-darwin` |
| macos-x64 | `macos-15-intel` | `x86_64-apple-darwin` |
| linux-x64 | `ubuntu-22.04` (oldest supported glibc) | host |

macOS is built once per architecture instead of as a universal app, because PyInstaller only
builds the engine for the runner's own architecture. `latest.json` therefore gets separate
`darwin-aarch64` and `darwin-x86_64` entries.

Each job builds and self-tests the engine, signs it when certificates are configured, bundles the
app, then installs or unpacks its own bundle and runs `smoke-engine.sh` against the engine inside
it (Windows: silent NSIS install into the runner's temp folder; macOS: the `.app`; Linux: the
unpacked `.deb` and AppImage). Finally it signs the updater artefacts with the two secrets and
opens a **draft** GitHub release with the installers, their `.sig` files and `latest.json`.
Review the draft and publish it.

Before tagging, do steps 1 and 2 below. Steps 3 and 4 are the manual fallback if the workflow
cannot run.

1. Bump the version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/package.json` (same value everywhere).
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version heading.
3. Build the engine and the app with the release configuration:
   ```
   scripts/build-sidecar.ps1        (or build-sidecar.sh)
   cd apps/desktop
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/vivepdf.key -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password chosen in step 1>"
   pnpm tauri build --config src-tauri/tauri.release.conf.json
   ```
   `bundle.createUpdaterArtifacts` is on, so next to the installers Tauri writes `*.sig` files.
   For a local test build without the signing key add
   `--config '{"bundle":{"createUpdaterArtifacts":false}}'`.
4. Create a GitHub release tagged `vX.Y.Z`, upload the installers and their `.sig` files, and a `latest.json` manifest:
   ```json
   {
     "version": "X.Y.Z",
     "notes": "Short release notes shown inside the app",
     "pub_date": "2026-09-04T12:00:00Z",
     "platforms": {
       "windows-x86_64": { "signature": "<contents of the .sig>", "url": "https://github.com/mtvrkan/vivePDF/releases/download/vX.Y.Z/vivePDF_X.Y.Z_x64-setup.exe" },
       "darwin-aarch64": { "signature": "…", "url": "…/vivePDF_X.Y.Z_aarch64.app.tar.gz" },
       "darwin-x86_64":  { "signature": "…", "url": "…/vivePDF_X.Y.Z_x64.app.tar.gz" },
       "linux-x86_64":   { "signature": "…", "url": "…/vivePDF_X.Y.Z_amd64.AppImage" }
     }
   }
   ```
5. Installed apps pick the new version up on their next start or manual check.

## Test bundles without releasing

`.github/workflows/package.yml` calls the same `bundle.yml` with `publish: false`: no release,
no updater artefacts, and each platform's installers are uploaded as the workflow artefact
`vivepdf-<platform>-<commit>` (kept for 7 days). It runs

- on demand (*Actions › Package › Run workflow*),
- every Monday at 04:00 UTC,
- on pull requests that touch packaging: the spec, `sidecar/uv.lock`, the build, smoke and
  signing scripts, `src-tauri/tauri*.json`, `src-tauri/src/sidecar.rs`,
  `installer-hooks.nsh` and the three packaging workflows.

A run started by hand also fetches LibreOffice with `scripts/fetch-libreoffice.sh` on Ubuntu
22.04 and macOS and runs `soffice --version`, which is the only check of that script's Linux and
macOS branches.

## First run of an unsigned build

Until the code-signing certificates below exist, installers are unsigned and the operating
system warns once:

- **Windows** — SmartScreen shows "Windows protected your PC". Click *More info* → *Run anyway*.
- **macOS** — the app is only ad-hoc signed, so Gatekeeper refuses the first start. Open
  *System Settings › Privacy & Security* and click *Open Anyway* next to the vivePDF message, or
  remove the quarantine flag:
  `xattr -dr com.apple.quarantine /Applications/vivePDF.app`.
- **Linux** — no warning; make the AppImage executable (`chmod +x`) before starting it.

## Code signing

Nothing is needed to build; signing switches on as soon as the secrets exist.

**Windows.** An open-source project can get a free certificate from the SignPath Foundation or a
Certum Open Source Code Signing certificate. Two places sign:

- the *Sign engine* step in `bundle.yml` signs every `.exe`, `.dll` and `.pyd` under
  `binaries/engine` that is not already validly signed, before bundling. It runs when the
  repository secret `WINDOWS_CERTIFICATE` (base64 of the `.pfx`) exists and uses
  `WINDOWS_CERTIFICATE_PASSWORD`;
- the app executable and the installers are signed by Tauri through
  `bundle.windows.certificateThumbprint` or, for a cloud signing service such as SignPath,
  `bundle.windows.signCommand` in `tauri.release.conf.json`. With a cloud service, replace the
  `.pfx` import in the *Sign engine* step with the same sign command.

**macOS.** Signing and notarisation need an Apple Developer ID. Add the repository secrets
`APPLE_CERTIFICATE` (base64 of the `.p12`), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and
`APPLE_TEAM_ID`. With `APPLE_SIGNING_IDENTITY` set, the *Sign engine* step runs
`scripts/sign-engine-macos.sh`, which imports the certificate into a temporary keychain and signs
every Mach-O file in `binaries/engine` with the hardened runtime and a timestamp, the two
executables last. Then pass the six secrets as environment variables to the `tauri-action` step
and drop `"signingIdentity": "-"` from `tauri.release.conf.json`, so Tauri signs and notarises
the app itself.

## What CI checks before a release

`.github/workflows/ci.yml` runs on every push and pull request to `main`: type-check, lint and
unit tests for the UI plus `pnpm check:rpc` (the TypeScript RPC types against the sidecar's
schema); ruff and pytest for the sidecar on all three operating systems; `cargo fmt --check`,
`cargo clippy -D warnings` and `cargo test` for the shell; and a dependency audit (`cargo
audit`, `pnpm audit --audit-level high` and `pip-audit` over the locked sidecar environment).
Every action is pinned to a commit SHA.

## Still open before the first release

- Code-signing certificates for Windows and macOS notarisation are not set up; installers will
  warn on first run until they are (see above).
- `package.yml` has not had its first green run on all four runners yet; the Windows bundle has
  been built, installed, self-tested and uninstalled locally.
- The WIA scanner path has never run against real hardware.
