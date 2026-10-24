# Build from source

> What you need to run vivePDF from its source code, how to start it in development mode, run the tests and build your own installer.

URL: https://vivepdf.com/en/docs/build-from-source/
Last updated: 2026-10-24

You can build and run vivePDF from its source code. That is the way to use it on Linux and on Intel Macs, which have no ready-made package; it is also where you start if you want to contribute.

## Repository layout

All of the source code is in the [vivePDF repository on GitHub](https://github.com/mtvrkan/vivePDF). It has three main folders:

- `apps/desktop` — the desktop app: the Tauri 2 (Rust) shell and the interface, written in React 19, TypeScript and Tailwind v4. The PDF viewer is EmbedPDF.
- `sidecar` — the Python engine, built on PyMuPDF. The app starts it as a separate process; pdf2docx, OCRmyPDF, pyHanko and Tesseract are used here too.
- `scripts` — scripts that package the engine and prepare release builds.

## Prerequisites

- Node 22 and pnpm 10
- Rust (stable) and your platform's build tools; on macOS, the Xcode command line tools
- Python 3.12 or later and uv

## Run in development mode

1. Clone the repository:

   ```sh
   git clone https://github.com/mtvrkan/vivePDF.git
   cd vivePDF
   ```

2. Install the interface dependencies:

   ```sh
   cd apps/desktop
   pnpm install
   ```

3. Set up the Python engine's environment. In development mode the app runs the engine straight from source:

   ```sh
   cd ../../sidecar
   uv sync
   ```

4. Start the app:

   ```sh
   cd ../apps/desktop
   pnpm tauri dev
   ```

## Tests

Each layer has its own tests. Run the commands in the folder shown:

| Layer | Folder | Command |
|---|---|---|
| Interface unit tests | `apps/desktop` | `pnpm test` |
| Type check and lint | `apps/desktop` | `pnpm typecheck` · `pnpm lint` |
| RPC types between the interface and the engine | `apps/desktop` | `pnpm check:rpc` |
| Python engine | `sidecar` | `uv run pytest -x -q` |
| Rust shell | `apps/desktop/src-tauri` | `cargo test` |
| End to end, with the real app | `apps/desktop` | `pnpm e2e` |

The end-to-end tests drive the real app through its interface and run on Windows only; they also need `cargo install tauri-driver --locked`. Setup details and the tests with real-world and very large documents are described in [docs/TESTING.md](https://github.com/mtvrkan/vivePDF/blob/main/docs/TESTING.md).

## Build an installer

For an installable package, first package the Python engine as a single folder. The script builds the engine, copies it to `apps/desktop/src-tauri/binaries/engine/` and stops if the copy fails its self-checks:

```sh
scripts/build-sidecar.sh
```

On Windows, `scripts/build-sidecar.ps1` does the same. Then build the app with the release configuration. Without the update signing key, turn the updater files off:

```sh
cd apps/desktop
pnpm tauri build --config src-tauri/tauri.release.conf.json --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

The packages are written under `apps/desktop/src-tauri/target/release/bundle/`. On Linux these include a `.deb` and an AppImage; make the AppImage executable with `chmod +x` before starting it.

> **Office conversions**
>
> Builds you make yourself on macOS and Linux use the LibreOffice installed on the system for Word, Excel and PowerPoint conversions. The Windows installer that carries LibreOffice inside is built with `scripts/build-windows-release.ps1`.

How the official releases are built and published, including signing and the update channel, is in [docs/RELEASING.md](https://github.com/mtvrkan/vivePDF/blob/main/docs/RELEASING.md). For the licence that covers the code, see [License](https://vivepdf.com/en/docs/license/).
