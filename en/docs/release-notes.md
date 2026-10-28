# Release notes

> The main changes in each vivePDF version, how updates reach you and where to find the complete list of changes.

URL: https://vivepdf.com/en/docs/release-notes/
Last updated: 2026-10-18

This page lists the main changes that came with each version of vivePDF. The notes below match the **What's new** section inside the app: the newest version comes first, each under its own heading. They cover the highlights only; for every small fix, see the complete list.

## How updates arrive

vivePDF checks for new versions itself and tells you when one is out. At start-up it only fetches version information; downloading and installing always ask you first.

1. Open **Settings › Updates** and click **Check for updates**. The same command is also in the **Help** menu.
2. When a new version is out, a **v… ready** label appears in the top bar. Choose **Download and install**; the update arrives signed.
3. Once the download finishes, click **Restart** and the app opens on the new version.

The **Installed version** line on the same screen shows which version you have. If you do not want automatic checks, turn off **Check automatically at startup**. While [Offline mode](https://vivepdf.com/en/docs/offline/) is on, no check is made at all. Installing and uninstalling are covered on the [Installation](https://vivepdf.com/en/docs/installation/) page.

### After an update

The first time you start the new version, vivePDF shows its highlights once in a window titled **vivePDF … is installed**. After you close it, the same notes are always available under **Help › What's new**.

## The complete list of changes

Every addition, change and fix in each version is recorded with its date in [CHANGELOG.md](https://github.com/mtvrkan/vivePDF/blob/main/CHANGELOG.md) on GitHub. The installers and a short note for each version are on the [releases page](https://github.com/mtvrkan/vivePDF/releases).

## vivePDF 0.5.0

- A renewed reference manager: a DOI becomes a reference in the official APA 7, MLA, Chicago, IEEE, ISNAD, Vancouver and Harvard styles, and .bib files are read correctly, edited and saved back into their own file.
- Conversions to Word, PowerPoint, Excel and HTML are far closer to the PDF: fonts, links, pictures, tables and columns stay in place, and scanned tables reach Excel row by row.
- The print dialog shows a preview of each sheet next to the settings, with your chosen pages, pages per sheet, grayscale and scale.
- Make vivePDF the app that opens your PDF files from Settings › System, on Windows, macOS and Linux.
- New tools: PDF → SVG and Background colour; Comments, Attachments, Read aloud, Translate and Print now also sit in the tool categories.
- Wide Excel tables fit the paper, missing fonts are named before converting, Images → PDF can compress photos, and pictures can be extracted as the page shows them.
- The Studio document editor works like Word: a ribbon with tabs, rulers, page lines and page setup, a navigation pane, and thesis tools: numbered headings, figure and table captions with their lists, and roman page numbers before the main text.
- Thesis writing in the Studio: ready Master's and Doctoral thesis starters with common university rules, equations typed in LaTeX and numbered (1), (2)… for reference, comments with replies beside the page, and export to Word with the contents, footnotes, equations and comments.
- Thesis check and review: Tools › Thesis check checks a finished thesis PDF against university rules for paper, margins, font, line spacing, headings and page numbers; in a Studio document, Track changes marks inserted and deleted text with its author, lets you accept or reject one or all, and goes to Word as real tracked changes; version history keeps a version on every save and every 10 minutes, with a preview and restore.

## vivePDF 0.4.0

Released: 2026-10-21 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.4.0)

- Word, Excel and PowerPoint files open straight in vivePDF as PDFs, also from Open With in Finder and Explorer; when LibreOffice is missing, vivePDF offers to set it up and opens the file once it is ready.
- Tabs work like a browser's: drag a tab or a whole tab group out to open it in its own window where you drop it, or onto another vivePDF window to move it there.
- vivePDF runs on the Mac: full screen keeps the window buttons beside the logo, Command shortcuts and the menu bar work the macOS way, trackpad pinch zooms smoothly, and updates arrive inside the app.
- The black and white presentation boards have a toolbar with pen, highlighter, shapes and eraser, pick several drawings at once and undo up to 100 steps.
- Smoother and lighter: scrolling a PDF no longer stutters, typing stays quick in long Studio documents, and page previews no longer wait for each other.

## vivePDF 0.3.0

Released: 2026-10-15 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.3.0)

- Help that works offline: F1 shows the shortcuts of the screen you are on (and saves them as a PDF), Help › Help topics explains the main tasks step by step, and bug reports can carry pictures and sample files in a support package you save yourself.
- Offline mode: one switch in Settings › Web turns off every feature that would use the internet — updates, downloads, web search, citation lookups and the leaked-password check.
- Presenter view: the projector shows only the slides while your laptop shows the next page, a timer and speaker notes.
- Studio documents learned Word-style writing tools: footnotes, columns and section breaks, find and replace, line spacing, symbols, word count and Markdown export.
- Presentations can insert formulas, shapes, charts, tables and diagrams on the fly, also on the black and white boards.

## vivePDF 0.2.0

Released: 2026-10-09 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.2.0)

- Studio has 174 templates, with new CV layouts, ornaments and redesigned business documents, planners and labels.
- The CV builder imports an existing CV or LinkedIn PDF and gains undo, reordering and month pickers.
- The page organizer selects pages by shape, size or text, drags pages out to the desktop or onto another tab, and saves pages as pictures.
- The viewer fills in forms on the page, copies text blocks and pictures between documents, highlights selected text and edits bookmarks.
- Home collections can be rearranged, searched and recoloured, and recent files can be pinned.

## vivePDF 0.1.1

Released: 2026-10-04 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.1.1)

- Studio: a design editor for making a PDF from scratch, with ready-made templates for certificates, invitations, cards, posters and more.
- The CV builder fills a form on the left and shows the finished CV on the right.
- Studio pictures can be cropped and adjusted, and designs gain tables, charts, flowcharts, formulas, shadows and rulers.
- A library of 24 open-licence fonts, all with Turkish letters, downloads on request.
- More than 1,600 icons can be searched by name in your language and added as sharp, recolourable drawings.
