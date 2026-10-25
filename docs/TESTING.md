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

Close `pnpm tauri dev` and any other running vivePDF first. With a second copy busy on the same
machine, the viewer flow that types a page number right after opening a file fails every time
(the view lands on page 1); with the machine otherwise idle it passes.

| Command | What it does |
|---|---|
| `pnpm e2e` | builds the test binary, then runs every flow |
| `pnpm e2e:smoke` | builds the test binary, then runs the core flows only: home, viewer, edit, convert, organize and a Studio document; the check to run before every release |
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
| `security` | compress a document picked from a new folder in Documents while another program's file already sits at the suggested output | the save dialog is asked, the output lands at the picked path and the other file is left as it was |
| `security` | ask open folder, reveal, delete, open produced file/picture and drag-out for a path on a network share nobody opened | every command answers PERMISSION_DENIED in under a second, without trying to reach the server |
| `edit` | fill a form field with Turkish text | field value round-trips exactly |
| `edit` | find and replace | replaced on every page, rest of the line kept |
| `edit` | Edit › Add formula: type LaTeX, wait for the preview, place it on page 1, *Save as* | more vector drawings on page 1 and no new picture, the page text kept, page 2 and the original untouched; screenshots of the dialog and the placed formula in the run folder |
| `edit` | Edit › Add shape: Solids › Cone, wait for the labelled preview, place it on page 1, *Save as* | more vector drawings on page 1 and no new picture, the page text kept, page 2 and the original untouched; screenshots of the dialog and the placed shape in the run folder |
| `edit` | Edit › Add function graph: type `x^3 - 3x`, wait for the preview, place it on page 1, *Save as* | many more vector drawings on page 1 and no new picture, the page text kept, page 2 and the original untouched; screenshots of the dialog and the placed graph in the run folder |
| `edit` | Edit › Add table: type Turkish words and a decimal comma into four cells, wait for the engine's preview, place it on page 1, *Save as* | the cell text is real text on page 1 (Ürün, 15,50), more vector drawings and no new picture, the page text kept, the original untouched; screenshots of the dialog and the placed table in the run folder |
| `edit` | Edit › Add chart: rename the first category to `Çay`, type a title, pick Bar, wait for the engine's preview, place it on page 1, *Save as* | the title, `Çay` and the series name are real text on page 1, more vector drawings and no new picture, the page text kept; screenshots of the dialog and the placed chart in the run folder |
| `home` | open a file so it is remembered, see its cover on Home, replace the file on disk, come back to Home | the cover picture changes, then stays the same on the next visit |
| `engine` | four OCR jobs on a 400-page file keep every heavy engine worker busy while a page thumbnail is asked for, then the jobs are cancelled | the thumbnail arrives within 10 s while none of the OCR jobs has finished, and all four stop after the cancel |
| `studiodoc` | type a few words at the end of a saved document's heading and press Ctrl+S at once | the saved file holds the new words and the bar still shows the file as saved half a second later |
| `convert` | PDF to pictures, PDF to SVG, pictures to PDF, two SVG drawings combined into one PDF | 3 images; 3 SVG files with the text drawn as outlines; 2-page PDF with one image per page; 2 vector pages (no images) with the drawings' text and aspect ratios |
| `convert` | Word document with a Turkish file name to PDF through LibreOffice (skipped when LibreOffice is not installed) | one page with the heading and the Turkish line as real text, written next to the source |
| `batch` | compress then password chain on two files | both outputs encrypted, page counts kept |
| `windows` | moving a tab into a new window from the tab menu, the theme chosen in the main window reaching the second one, closing a document window from its own title bar, an empty window from the palette's New window action, opening a file another window already holds | window handles, the held file getting no tab in the second window and staying in the first, the tab leaving the first window and loading in the second, the second window's page number, the `dark` class on the second window's root |
| `windows` | dragging tabs with the real Windows mouse: a tab torn off into a new window, the same tab dragged back between two tabs of the main window with the drop line showing there first, a named tab group torn off into a new window (arriving there as the same group) and dropped back after the last tab | the new window's position under the pointer (within 12 px of the expected spot), the tab order in both windows, the drop line under the pointer, the emptied window closing, the group chip and its name in the main window |
| `settings` | every section from the rail; dark theme, 120 % scale, reduced motion and Turkish applied live and kept after a reload; a switch saved in another section; search across sections and the no-match state; a recently opened file counted under Data and cleared through the confirmation; success messages only while that switch is on; reset all | the `dark` class, root font size, `lang`, stored preferences, rail and top-bar buttons inside the window at 120 % in Turkish, row counts, the recent-files count, the success toast appearing and closing, theme, language and preferences gone after the reset; a screenshot of each section in the run folder |
| `readerparity` | page display menu (horizontal and vertical scrolling), automatic scrolling with speed-up and Escape, page colour schemes and the rail switch, toolbar snapshot, the signature message and signature panel on a signed fixture, form field highlighting, replying to a comment and setting its review status with the status and reply filters, switching document layers | page positions, scroll offsets over time, the applied filter, clipboard picture size and shape, signer listed in the panel, highlight box within 3 px of the field, reply and state read back from the saved file, layer colours counted in a page screenshot and the file bytes unchanged |
| `contextmenu` | every entry of the viewer's right-click menu on selected text, a picture and a page, and which group opens for what was clicked | clipboard text and pictures (read back through Windows), the addresses the web searches and Lens would open (caught before the browser starts), saved picture, PNG and extracted page, OCR text, print range, bookmark, rotation, zoom |
| `translate` | import an Argos en→tr model in Settings, select a line, *Translate (offline)* from the right-click menu, remove the model | Turkish result shown; the model row goes back to Download (skipped unless `VIVEPDF_E2E_ARGOS_EN_TR` names a `translate-en_tr` `.argosmodel`) |

The tab-dragging flows move the real Windows pointer (`nativeMouse` in `e2e/support/desktop.ts`).
Keep the mouse and keyboard still while `windows.e2e.ts` runs, and run it on one screen.

### Checked by hand on Windows

Things the suite cannot drive, to try once on a Windows machine after a change to them:

- Drag a tab from a window on one screen to a window on a second screen with a different
  scaling (for example 100 % and 150 %): the tab lands where it was dropped and the drop line
  sits under the pointer.
- With two document windows overlapping, drop a tab where both are under the pointer: it goes
  to the window that was used last.
- Drag a tab out and back in quickly several times: no empty window is left behind and no tab
  is lost.
- Tear a tab off near a screen edge: the new window stays fully on that screen.
- With the main screen at 100 % and a second screen at 150 %, tear a tab off onto the second
  screen: the new window opens there under the pointer. Present on a screen where full screen
  leaves a gap (the window is then pinned by hand): the page fills the screen, the window edges
  cannot be dragged, and after End the window can be resized again. Unplug the projector during
  a presentation that used Swap screens, then End: the window comes back centred on the laptop.
- Open the Tools menu in the top bar and press on a page of an open PDF: the menu closes.
- Open a PDF from a folder outside Documents and run a tool whose output folder already exists
  there (for example Split into a folder made by hand): vivePDF asks for a folder instead of
  writing into it, and the folder chosen in that dialog is used.
- In a long PDF, Ctrl + mouse wheel and a precision-touchpad pinch still zoom around the
  pointer without zooming the whole window, and right after releasing Ctrl the wheel scrolls
  again; a fast fling through the document then logs a `[scroll]` line in the app log with
  few frames over 34 ms.
- In the page organizer and the Studio canvas, one Ctrl + wheel notch still changes the size
  by one step and a precision-touchpad pinch now changes it smoothly. A file whose name holds a
  backslash cannot exist on Windows, so nothing there changes for path handling.
- With Windows set to dark mode, open Edit › Text edit and Reading view in each reading
  theme: the page stays white, its text and a failed-page message stay readable, and the
  sentence being read aloud keeps the theme's text colour. With Narrator on, Tab into the Pages
  grid and use the arrow keys: the focused page shows a ring and is announced, today is
  announced in the date picker and the current slide in the presenter overview.
- Open Tools › Forms › Export (and separately Scan › Photo, OMR › Grade), then go to
  Compress and drop a PDF from Explorer onto the window: Compress takes it. Back on Forms,
  switching from Export to another tab and dropping a PDF makes it the form source.
- In Edit › Text edit change two spans on page 5 of one PDF, then pick another PDF: the edit
  list is empty and the new file opens on page 1. Start a signature check with the online check
  on and pick another file while it runs: the panel stays empty for the new file.
- Open a form whose Yes/No boxes share one field name (many government forms): ticking Yes in
  the viewer or in Tools › Forms leaves No empty, and the saved file shows only Yes. On a scanned
  page turned 90° with a cropped margin, Edit › Text and Remove watermark keep the text where it
  was and upright.
- On that Yes/No form the viewer shows both as square boxes with a check mark; clicking the
  ticked box again clears it. Change the title in Document info and save: File › Properties in
  Acrobat shows the new title and today's modify date. With the app in English, Sign › Export
  certificate and Sign › New certificate suggest `certificate.cer` / `certificate.p12`.
- Convert a PDF to HTML and open the result from the result panel: Edge shows the text and
  pictures, and its developer console reports no script or network request from the file.
  Convert a page range to PNG next to the PDF and choose "Show in folder" on the second
  picture: Explorer selects it.
- Present with a second screen set to Extend, press Swap screens, then End: the window comes
  back to the first screen at its old size. Rehearse on one screen: the console's top bar drags
  the window and its minimise, maximise and close buttons work. With Close to tray on, close
  the window during a presentation: the audience window closes too and the tray brings the app
  back out of presentation view.
- The top bar's minimise, maximise and close buttons still work and a failure still shows a
  toast; F11 with a document open still presents full screen with no window buttons over it.
- After saving a support bundle choose "Show in folder" in the toast: Explorer opens with the
  zip selected. Delete a produced PDF in Explorer, then choose "Show in folder" for it in the
  result panel: Explorer opens its folder instead of showing an error.
- With "Open PDFs with vivePDF" on in Settings, right-click a .pptx, .docx and .xlsx in
  Explorer: Open with lists vivePDF, choosing it converts and opens the file, and the default
  app for those types stays what it was. Turning the setting off removes vivePDF from those
  lists; updating from 0.3.0 with the setting already on adds them on first start; uninstalling
  leaves no vivePDF.Office key or OpenWithProgids value behind.
- With LibreOffice removed under Settings › Tools, open a .pptx from Explorer: a dialog offers
  to set LibreOffice up, shows the download progress, and opens the file as a PDF when it is
  done. Cancel stops the download; with a bundled installer the button installs from the app
  package without internet.
- Build the installer and look at `vivePDF_<version>_x64-setup.exe` in Explorer and while it
  runs: the file and the installer window show the vivePDF icon, not the generic installer one.
- With another app set for PDF, Settings › System shows "Default PDF app" with that app's name,
  and the home page offers to make vivePDF the default. "Make default" opens Windows Settings
  on vivePDF's default-apps page (with "Open PDFs with vivePDF" turned on if it was off); after
  choosing vivePDF for .pdf there and coming back to the app, the row shows a check mark and the
  home card is gone. "Don't ask again" hides the card for good. On Linux the button switches
  `xdg-mime query default application/pdf` to vivePDF's desktop file without a dialog.
- Print a two-sheet selection with 2 pages per sheet on a real printer: the paper matches the
  print dialog's preview (page order, rotation, grayscale), apart from the printer's own margins.
- Convert a PDF set in a font Windows does not have (Geist, Inter) to Word on a PC
  without that font: Word shows the headings in the bold face and the body in the regular face
  of that font, not Calibri or Times, and File › Info does not say the document is read-only.
  Word for Mac only uses the regular face and thickens it for bold runs.
- Convert the same PDF to PowerPoint (editable) on a PC without that font and open it in
  PowerPoint: the titles and body text show in that font in its bold and regular faces, not
  Calibri, and two converted files opened one after the other both keep it.
- Convert a CSV saved by Excel on Turkish Windows (semicolons, numbers with leading zeros, an
  IBAN, dates) to PDF on a PC without LibreOffice: no "needs LibreOffice" warning appears, the
  table shows every value as written, and no file name or "Page 1" is printed.
- On an English-language Windows, convert a Notepad TXT saved as ANSI on Turkish Windows to
  PDF: "Başlık, ışık, İğne" reads correctly, not "Baþlýk".
- Convert a README.md with a table of contents (links like `#kurulum`) to PDF and open it in
  Edge and Acrobat: the bookmarks panel lists the headings, the contents links jump to their
  heading and web links open the browser after the viewer's usual prompt.
- Convert an SVG exported from Illustrator (with the `<!DOCTYPE svg PUBLIC ...>` line) to PDF
  with the bundled LibreOffice: it converts and looks like the drawing in a browser.
- Convert an SVG icon sheet that uses `<symbol>` and `<use>` (for example from an icon set's
  sprite) to PDF with the bundled LibreOffice: every icon has the size and colour it has in a
  browser.
- Convert an SVG with a linked logo or text (`<a href="https://...">`) to PDF with the bundled
  LibreOffice and open it in Edge: the pointer turns into a hand over the logo and clicking
  opens the address.
- Convert a PDF made by an old Word "Save as PDF" (fonts listed as "Times New Roman,Bold" in
  the document properties) to Word and open it in Word: the font box shows Times New Roman,
  not a name with a comma, and bold text is bold.
- Convert a report whose footer reads "page 3 / 10" in a font Windows lacks (for example
  Geist) to Word on a PC without that font: the footer, page number included, shows in that
  font on every page, and the number counts up.
- Convert a PDF with a tilted stamp (a rotated "ONAYLANDI" word inside a tilted frame) to
  Word and open it in Word: the stamp word shows over its frame at the same angle, not behind
  it and not missing.
- Convert a PDF exported from LibreOffice (fonts such as Liberation Serif) to Word and to
  PowerPoint on a PC without LibreOffice's fonts: the headings show in Liberation Serif, not
  in a substitute font.
- Convert › File to PDF: add a Word file written in a font Windows lacks (for example Aptos
  on an older Windows, or Geist): the row shows "Not on this computer: …" under the file name;
  a file in Calibri or Arial shows nothing.
- Convert › File to PDF: convert a Word file with Heading 1/Heading 2 titles and a PowerPoint
  file, with a system LibreOffice older than 25 if one is at hand: each PDF opens with a
  bookmark per heading or slide, and Acrobat's Accessibility check finds tags.
- Convert › Images to PDF: add a large phone photo (several MB) and a screenshot, turn on
  "Compress photos": the PDF is a fraction of the photo's size, the photo still looks sharp
  at 100 % zoom and the screenshot text is as crisp as without the option.
- Convert › Images to PDF: a lossless WebP screenshot gives a PDF whose text has no JPEG
  blotches around the letters.
- Convert › SVG to PDF: an Inkscape drawing that links a photo kept in the same folder (not
  embedded) shows the photo in the PDF; a photo linked from another folder is left out.
- Convert › File to PDF: add an .xlsx with about 15 columns, choose Letter: the "Fit columns to
  the page width" switch appears; the PDF has every column on one landscape Letter page per
  page of rows. Turn the switch off: the columns spread over extra pages as before.
- Open an .xlsx with no print setup straight from Explorer (Open with vivePDF) on a Windows set
  to Turkish: the converted pages are A4; set Windows to English (United States): Letter.
- Convert a PDF report with a bar chart (filled bars and an axis line) to PowerPoint
  (editable) and open it in PowerPoint on Windows: each bar and line can be clicked, moved and
  recoloured, the chart looks as in the PDF, and moving a bar leaves white page behind it, not a
  copy of the bar. A black box drawn over text in the PDF stays part of the page picture.
- Run OCR on a scanned invoice, then convert it to PowerPoint (editable) and open it in
  PowerPoint on Windows: every line is a text box you can edit, the scan behind it shows no
  doubled words, the text sits where the scanned words were, and the notes hold the invoice text.
- Convert a Turkish PDF to PowerPoint (editable): Review › Language shows Turkish for the slide
  text and correctly spelled Turkish words are not underlined.
- Convert a PDF with justified paragraphs (a lecture slide deck exported from PowerPoint) to
  PowerPoint (editable): each justified line reaches the right margin as in the PDF.
- Convert a brochure with full-page photos to PowerPoint: the file is a fraction of its
  earlier size and the photos look the same at 100 % zoom.
- Convert a PDF whose table runs over two pages (the header repeated on the second page) to
  Excel on Windows: one sheet named like `S1-S2-T1` holds the whole table with the header once,
  in bold, and the header stays in view while scrolling; clock times show as times (14:30) and
  a description that wrapped inside its cell is one line in the cell.
- With Windows set to Turkish, convert a PDF table to CSV: the separator shows "Noktalı virgül
  (;)" and the CSV opens in Excel with every value in its own column.
- Convert a scanned PDF with a ruled table to Excel with "Read pages without text with OCR" ticked:
  the table comes out in rows and columns with its numbers and dates as values.
- Run `pnpm tauri dev`, quit it, change a dependency import (or delete `node_modules/.vite`),
  run it again: the window shows the app, not a blank white page.
- With the app in English, convert a Turkish PDF with words hyphenated at line ends to text,
  Markdown, HTML and EPUB: split words are whole again, compounds like "sebep-sonuç" keep their
  hyphen, the Markdown has no "picture text" comments, and the EPUB opens in Windows as a
  Turkish book (`dc:language` tr).
- Convert a slide-deck PDF (template background on every page, logo on each slide, a ruled
  table) to HTML and EPUB, open the HTML in Edge and the EPUB in a Windows reader: no page-sized
  template pictures, the logo shows on every slide, and the table has borders, a header row and
  merged cells where the PDF has them.
- Convert a two-column article PDF to text and HTML: each column reads top to bottom before the
  next one, the title stays first, and a ruled two-column table still reads row by row. Then
  convert any PDF to Markdown and, without restarting, a PDF with a ruled table to HTML: the
  table is text, not a picture.
- Extract images from a slide-deck PDF with "As shown on the page" on, then off: with it on, no
  slide backgrounds, a cropped picture is only its visible part, a picture made of pieces is one
  file, a photo stays JPEG and the repeated logo is saved once; with it off, the files match the
  earlier release.
- Extract images ("As shown on the page" off) from a PDF with inline images (a scanner's PDF
  or an old PDF maker's file): each inline picture is saved after the page's other pictures,
  a photo as JPEG, a one-colour mask in its colour on a clear background.
- Fill a form whose fields have a border and background colour with "Esma Yılmaz" in one
  field and an e-mail address in another, save, open in Acrobat or Edge: both fields keep their
  box and background, the Turkish text reads upright.
- Without LibreOffice installed, convert an Illustrator or Inkscape SVG with a hidden layer to
  PDF and add it as a picture in Studio: the hidden layer is not drawn in either.
- Convert the same 400 px SVG to PDF with and without LibreOffice installed: both pages are
  300 pt wide with the same height, and the links sit over what they wrap.
- Convert a PDF with a landscape page that holds a ruled table (a Word landscape section saved
  as PDF) to HTML, EPUB and Excel: the table is a real table in all three, the heading above it
  comes first, and the Excel sheet has the table's rows.
- Convert a wide spreadsheet (15+ columns) saved as .xls, .ods and .xlsm to PDF with "Fit
  columns to the page width" on: each gives one landscape page with every column, like the
  same sheet as .xlsx; with the switch off the .xls and .ods keep their own print setup.
- PDF to Excel with "Also find tables without lines" on a PDF whose unruled table has a column
  like "Kalem 1", "Kalem 2": each "Kalem n" stays in one cell, and a table whose columns
  sit apart keeps every column.
- PDF to PowerPoint on a PDF with a black bar over part of a photo: the bar cannot be selected
  or moved and the photo stays covered; a coloured banner over a full-page background photo
  is still a shape you can move.
- PDF to text, Markdown and Word on several slide decks merged into one PDF where only the
  first deck has page numbers: the numbers of that deck are gone from the output and the rest
  of the text is unchanged.
- PDF to Word on a PDF that uses both Arial and Arial Narrow (or Times New Roman in bold and
  italic): in Word each run shows its own font name in the font box, and the bold and italic
  Times New Roman runs are named Times New Roman.
- Extract images with "as shown on the page" on a slide with two photos touching at a corner
  and on a clip-art drawing made of overlapping pieces: the photos are two files, the drawing
  is one.
- Presenter view on Windows with a projector, then Swap screens twice: the slide still fills
  each screen edge to edge with no black band at the top (the notch spacing is Mac only).
- In the installed build, PDF to Markdown on a page with a link, a rotated side label and a
  struck-through word, and a line with `a < b` and `2 * 3`: the link, the label and the
  strike-through come out as before and the `<` and `*` stay plain text.
- In the installed build, PDF to HTML on a page with a cropped photo, a chart drawn as lines
  and a filled table: the photo shows only its visible part, the chart is one picture and the
  table stays a table.
- In the installed build, Images to PDF with a turned phone photo, a lossless WebP and Compress
  photos on: the photo stands upright, the WebP stays sharp and the file is smaller.
- In the installed build, PDF to images as separate PNGs, as one joined image, as a multi-page
  TIFF and as a ZIP: the same files come out as before and Cancel leaves no half-written file.
- In the installed build, PDF to Excel on a ruled table, a table without lines and a page with
  a border round it: the same sheets and cells come out as before.
- In the installed build, PDF to Word on a page with a cropped photo, a table with merged cells
  and a "Arial,Bold" heading: the photo shows only its visible part, the merged cells stay
  merged and the heading is bold Arial, as before.
- In the installed build, Extract images both ways (as stored and as shown on the page), then
  Replace image in the editor: the same files come out and the replaced picture keeps its
  transparency.
- In the installed build, PDF to PowerPoint (editable) on a slide with outlined title text, a
  fake-bold word and Helvetica body text: the title stays outlined, the word bold and the body
  font Arial, as before.
- From the Tools catalogue, pick Attachments, Comments, Document info, Read aloud and Translate
  with a PDF open: the viewer comes forward with that side panel open. Pick Print: the print
  dialog opens. With no PDF open, the viewer waits on its empty page and opens the panel once a
  PDF is opened.
- PDF to SVG on a turned page, a cropped page and a page with Turkish text: open each SVG in
  Inkscape or Edge; it has the page's visible size and look. With "Keep text as text" on, the
  text can be selected and edited in Inkscape.

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
