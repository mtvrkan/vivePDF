# Testing vivePDF

| Layer | Where | Command (run in the listed dir) |
|---|---|---|
| Engine (Python) | `sidecar/tests/` | `sidecar`: `uv run pytest -x -q` |
| Interface units (TypeScript) | `apps/desktop/src/**/*.test.ts` | `apps/desktop`: `pnpm test` |
| Shell (Rust) | `apps/desktop/src-tauri/src/**` | `apps/desktop/src-tauri`: `cargo test` |
| RPC contract | TS types vs engine models | `apps/desktop`: `pnpm check:rpc` |
| End-to-end (real desktop app) | `apps/desktop/e2e/` | `apps/desktop`: `pnpm e2e` |
| Real documents (engine) | `sidecar/tests/robustness/` + `.corpus/real/` | `sidecar`: see [Real-document corpus](#real-document-corpus) |
| Large documents (app) | `apps/desktop/e2e/specs/large.e2e.ts` + `.corpus/large/` | see [Large documents](#large-documents) |

## Real-document corpus

`sidecar/tests/robustness/real_corpus.json` pins 128 openly available PDFs (py-pdf producer
samples, a sample of pdf.js bug-report files, arXiv papers, Internet Archive scans) by URL and
SHA-256. The files are downloaded into the git-ignored `.corpus/real/`; add your own documents
(lecture notes, scanned exams, theses) under `.corpus/real/own/` and they are tested too.

```sh
cd sidecar
uv run python tests/robustness/fetch_real_corpus.py
export VIVEPDF_ROBUSTNESS_REAL_DIR=../.corpus/real
uv run pytest -m robustness_full tests/robustness/test_real_journeys.py -q
uv run pytest -m robustness_full tests/robustness/test_robustness_full.py -k real_documents -q
```

`test_real_journeys.py` follows one student session per document and checks the results
(reading text, adding text, compressing, turning a page); the `real_documents` matrix runs
every file-reading operation on every document and fails on crashes, hangs and leaked
exceptions. `fetch_real_corpus.py --pin` records the hash of a newly listed document.

## Large documents

`sidecar/tests/robustness/large_documents.py` builds two stress files into the git-ignored
`.corpus/large/`: an 800-page Turkish thesis with chapters, an outline, charts and photos
(about 1.4 MB) and a 240-page 300 dpi grayscale scan of it (about 244 MB). The gated
end-to-end spec opens both in the real app and times opening, the first drawn page and a jump
to the last page, failing over its budgets; it also opens a locked copy of the scan, compares two
copies side by side and inserts scan pages in the page organizer, checking each time that the file
is read in pieces from a private copy and that the copy is gone once its view closes:

```sh
cd sidecar && uv run python tests/robustness/large_documents.py
cd ../apps/desktop
VIVEPDF_E2E_LARGE_DIR=../../.corpus/large pnpm e2e:run --spec e2e/specs/large.e2e.ts
```

Timings land in `large-timings.json` in the run's work folder. Measured on 2026-09-29: the
thesis opens in about 0.7 s and reaches its last page in 0.3 s; the scan opens in about 3.5 s
(most of it moving the file into the viewer) and reaches its last page in 0.8 s.

## Performance

`apps/desktop/e2e/specs/perf.e2e.ts` measures start-up (process start to first paint, to the viewer engine being ready and to the first engine answer), times engine operations on the two large documents and opens, reads through and closes five documents for `VIVEPDF_E2E_SOAK_CYCLES` rounds (default 10), sampling every process of the app after each round. Run it against a release-optimised build that keeps the e2e identifier, so your own settings and session are untouched:

```sh
cd apps/desktop
CARGO_TARGET_DIR=target/perf pnpm tauri build --no-bundle --features e2e --config e2e/tauri.e2e.conf.json
cp -r src-tauri/binaries/engine src-tauri/target/perf/release/engine   # after scripts/build-sidecar
VIVEPDF_E2E_APP=<absolute path to target/perf/release/vivepdf.exe> VIVEPDF_E2E_PERF_DIR=<absolute path to .corpus/large> pnpm e2e:run --spec e2e/specs/perf.e2e.ts
```

`VIVEPDF_E2E_CORES=2` pins the app to two processor cores to approximate a low-end laptop; `VIVEPDF_E2E_SOAK_SKIP_SCAN=1` leaves the 244 MB scan out of the rounds. The report lands in `perf.json` in the run's work folder.

## End-to-end suite

The end-to-end suite drives the real Tauri app through the official Tauri 2 WebDriver setup:
WebdriverIO talks to `tauri-driver`, which starts Microsoft Edge WebDriver against the app's
WebView2 window. Every flow clicks through the actual interface, lets the real engine do the
work, and then opens the file it wrote to check the result (page count, text, rotation,
annotations, form values, encryption, signature integrity).

It runs on Windows only, because `tauri-driver` has no macOS support and the Linux WebKit
driver needs a different setup.

### One-time setup

1. Rust, Node 22, pnpm 10 and uv, as for normal development.
2. `cargo install tauri-driver --locked`
3. `pnpm install` in `apps/desktop` (brings WebdriverIO as dev dependencies).
4. `uv sync` in `sidecar` (the debug app runs the engine from source).

Microsoft Edge WebDriver must match the installed WebView2 runtime exactly. The suite reads
the WebView2 version from the registry and downloads the matching `msedgedriver.exe` into
`apps/desktop/node_modules/.cache/vivepdf-e2e/` on first run. Set `VIVEPDF_E2E_EDGEDRIVER`
to a driver path to skip the download (offline machines).

### Running

| Command | What it does |
|---|---|
| `pnpm e2e` | builds the test binary, then runs every flow |
| `pnpm e2e:build` | builds only the test binary |
| `pnpm e2e:run` | runs the flows against the last build |
| `pnpm e2e:run --spec e2e/specs/security.e2e.ts` | runs one spec file |
| `pnpm e2e:typecheck` | type-checks the specs and helpers |

`pnpm e2e:build` runs `tauri build --debug --no-bundle --features e2e` with
`e2e/tauri.e2e.conf.json` merged in. That produces
`src-tauri/target/e2e/debug/vivepdf.exe`, which embeds the built interface (it never talks to
the Vite dev server) and starts the engine from `sidecar/` with `uv run`. The separate cargo
target directory, the separate frontend output (`src-tauri/target/e2e-dist`) and the separate
app identifier (`com.vivepdf.desktop.e2e`) keep the test app apart from a `pnpm tauri dev`
instance on ports 1420/9222: it does not share its binary, its single-instance lock, its
settings or its WebView data. The first build takes a few minutes; later builds are
incremental.

Each run writes to `%TEMP%\vivepdf-e2e\<timestamp>\` (override with `VIVEPDF_E2E_OUTPUT`):
generated fixtures, one folder per spec with every file the app produced, the app and engine
log (`app.log`), the dialog log and a screenshot of any failed test. The test app's settings
folders are deleted before each run, and the engine keeps its data (models, trust store, search
index, imported fonts) in `engine-data` inside the run folder through `VIVEPDF_DATA_DIR`, so every
run starts from a clean profile and never touches the real app's data. Fixtures are
generated by `e2e/support/make_fixtures.py` at the start of the run; nothing binary is checked
in.

### Flows covered

| Spec | Flow | Checked on the output file |
|---|---|---|
| `viewer` | open a PDF, next / previous page, jump to a page | page indicator follows |
| `viewer` | highlight text with the annotate bar, *Save as* | highlight on page 1 only, original untouched |
| `organize` | merge two files (one with a Turkish file name) | 5 pages in the right order |
| `organize` | split every 2 pages | three 2-page parts with the right pages |
| `organize` | page organizer: rotate page 1, delete page 3, apply | 2 pages, page 1 at 90° |
| `optimize` | compress a scanned page | smaller file, still one page with its image |
| `optimize` | OCR a scanned page with Turkish and English | recognised Turkish and English text |
| `security` | add an open password, then remove it | encrypted, opens with the password; decrypted copy has all pages |
| `security` | text watermark with Turkish letters | watermark text on every page |
| `security` | create a certificate, sign with it | one signature, intact, covering the whole file |
| `edit` | fill a form field with Turkish text | field value round-trips exactly |
| `edit` | find and replace | replaced on every page, rest of the line kept |
| `edit` | Edit › Add formula: type LaTeX, wait for the preview, place it on page 1, *Save as* | more vector drawings on page 1 and no new picture, the page text kept, page 2 and the original untouched; screenshots of the dialog and the placed formula in the run folder |
| `edit` | Edit › Add shape: Solids › Cone, wait for the labelled preview, place it on page 1, *Save as* | more vector drawings on page 1 and no new picture, the page text kept, page 2 and the original untouched; screenshots of the dialog and the placed shape in the run folder |
| `edit` | Edit › Add function graph: type `x^3 - 3x`, wait for the preview, place it on page 1, *Save as* | many more vector drawings on page 1 and no new picture, the page text kept, page 2 and the original untouched; screenshots of the dialog and the placed graph in the run folder |
| `edit` | Edit › Add table: type Turkish words and a decimal comma into four cells, wait for the engine's preview, place it on page 1, *Save as* | the cell text is real text on page 1 (Ürün, 15,50), more vector drawings and no new picture, the page text kept, the original untouched; screenshots of the dialog and the placed table in the run folder |
| `edit` | Edit › Add chart: rename the first category to `Çay`, type a title, pick Bar, wait for the engine's preview, place it on page 1, *Save as* | the title, `Çay` and the series name are real text on page 1, more vector drawings and no new picture, the page text kept; screenshots of the dialog and the placed chart in the run folder |
| `convert` | PDF to pictures, pictures to PDF, two SVG drawings combined into one PDF | 3 images; 2-page PDF with one image per page; 2 vector pages (no images) with the drawings' text and aspect ratios |
| `batch` | compress then password chain on two files | both outputs encrypted, page counts kept |
| `windows` | moving a tab into a new window from the tab menu, the theme chosen in the main window reaching the second one, closing a document window from its own title bar, an empty window from the palette's New window action, opening a file another window already holds | window handles, the held file getting no tab in the second window and staying in the first, the tab leaving the first window and loading in the second, the second window's page number, the `dark` class on the second window's root |
| `settings` | every section from the rail; dark theme, 120 % scale, reduced motion and Turkish applied live and kept after a reload; a switch saved in another section; search across sections and the no-match state; a recently opened file counted under Data and cleared through the confirmation; success messages only while that switch is on; reset all | the `dark` class, root font size, `lang`, stored preferences, rail and top-bar buttons inside the window at 120 % in Turkish, row counts, the recent-files count, the success toast appearing and closing, theme, language and preferences gone after the reset; a screenshot of each section in the run folder |
| `readerparity` | page display menu (horizontal and vertical scrolling), automatic scrolling with speed-up and Escape, page colour schemes and the rail switch, toolbar snapshot, the signature message and signature panel on a signed fixture, form field highlighting, replying to a comment and setting its review status with the status and reply filters, switching document layers | page positions, scroll offsets over time, the applied filter, clipboard picture size and shape, signer listed in the panel, highlight box within 3 px of the field, reply and state read back from the saved file, layer colours counted in a page screenshot and the file bytes unchanged |
| `contextmenu` | every entry of the viewer's right-click menu on selected text, a picture and a page, and which group opens for what was clicked | clipboard text and pictures (read back through Windows), the addresses the web searches and Lens would open (caught before the browser starts), saved picture, PNG and extracted page, OCR text, print range, bookmark, rotation, zoom |
| `translate` | import an Argos en→tr model in Settings, select a line, *Translate (offline)* from the right-click menu, remove the model | Turkish result shown; the model row goes back to Download (skipped unless `VIVEPDF_E2E_ARGOS_EN_TR` names a `translate-en_tr` `.argosmodel`) |

### How native dialogs are answered

Native open and save dialogs would block WebDriver, so the test binary is compiled with the
cargo feature `e2e`. In that build only, and only when `VIVEPDF_E2E=1` is set, the Rust side
registers a replacement for the dialog plugin (`src-tauri/src/e2e.rs`) that answers `open` and
`save` calls from the JSON queue in the file named by `VIVEPDF_E2E_DIALOG_FILE`, and logs each
request next to it. A spec queues answers with `answerDialogs(...)` before it clicks the button
that opens the dialog. With the variable unset the real dialog plugin is used; builds without
the feature (every normal and release build) do not contain the replacement at all. The test
build also skips re-registering the Explorer context menu and the `.pdf` file association, so
running the suite never repoints them at the test binary.

### Writing a new flow

- Select elements by the English interface text through `t("locale.key")`, never by copying the
  English string, so a wording change breaks the lookup loudly.
- Wait for DOM conditions (`waitForOutputs`, `waitForDialogsAnswered`, `waitUntil`), never a
  fixed sleep.
- Type with `typeInto` / `fill`: they select the old value and type over it, which is how a
  person edits a number field (clearing first lets controlled inputs snap back to their
  minimum).
- Check the real output file with `probe(path, password?)` (`e2e/support/probe_pdf.py`).

### CI

The suite needs a Windows runner with WebView2 (present on `windows-latest`). A proposed job
is in the round-4 W1 report; it is not wired into `.github/workflows` yet because workflow
files are owner-reviewed.
