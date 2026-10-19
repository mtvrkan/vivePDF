# Write a document in Studio

> How to write reports, assignments and theses in the Studio document editor, with headings, tables, footnotes, references, columns and PDF export.

URL: https://vivepdf.com/en/docs/studio-document/
Last updated: 2026-10-18

The Studio document editor lets you write a report, article, assignment or thesis inside vivePDF and turn it into a properly paginated PDF. While you type, the preview on the right shows the finished pages, and the cover, contents, page numbers, footnotes and reference list fall into place on their own.

## Start a new document

1. Click **Studio** in the top bar. You can also get there from the **Write a document** card in **Tools › Show all**, or from the command palette with `Ctrl+K`.
2. Under **Start a document**, pick a starting point: **Blank document**, **Report**, **Letter**, **Petition**, **Assignment**, **Meeting minutes**, **Lecture notes**, **Booklet**, **CV** or **Invoice**.
3. Start typing. To return to a document you left unfinished, choose **Continue** on the **Continue your document** card.

If you already have the text, **Import text…** turns a plain text, Markdown or web page file into a document.

## Formatting

The formatting bar above the editor keeps everything you use often in one place:

- **Paragraph style** switches between **Normal text** and **Heading 1** to **Heading 4**. The table of contents is built from these headings.
- **Bold**, **Italic**, **Underline**, **Strikethrough**, **Superscript**, **Subscript**, **Text colour** and **Highlight** format the text; **Format painter** copies formatting from one place to another, and **Clear formatting** removes it.
- **Bulleted list**, **Numbered list** and **Checklist** add lists; **Quote**, **Code block**, **Link**, **Insert picture**, **Insert symbol**, **Horizontal line** and **Page break** sit on the same bar.
- The **Line and paragraph spacing** menu sets line spacing, space before and after, and first-line indent for the selected paragraphs.

From the keyboard, `Ctrl+Alt+1`, `2` and `3` apply heading levels, `Ctrl+Shift+8` and `Ctrl+Shift+7` start lists, and `Shift+Enter` breaks the line without starting a new paragraph. The full list is on the [Keyboard shortcuts](https://vivepdf.com/en/docs/shortcuts/) page.

### Tables

Place a table with **Insert table**. While the cursor is inside it, table buttons appear on the bar: **Add row below**, **Add column to the right**, **Delete row**, **Delete column**, **Merge cells**, **Split cell**, **Header row on or off** and **Delete table**.

## Footnotes

The **Insert footnote** button, or `Ctrl+Alt+F`, puts a numbered marker at the cursor and opens the note panel below. Write the note, then click **Back to the text**. Each footnote is printed at the foot of the page its marker lands on; if the notes grow too long for the page, they become endnotes under **Notes** at the end of the document. A note can hold citations and small pictures too.

## Sources and references

**Citations and references** on the formatting bar opens the **Sources** window:

- **Import file** loads a BibTeX, RIS or CSL JSON library; **Paste** adds entries copied from Zotero, Mendeley or EndNote; **New source** lets you type one in.
- **Add by DOI** fetches the details from doi.org and needs internet; only the DOI is sent. **Add from PDF** finds the DOI inside an article's PDF on your computer and then fetches its details the same way. With offline mode on, neither goes online.
- Choose a **Citation style**: **APA 7**, **MLA 9**, **Chicago (author-date)** or **IEEE**. **Insert citation** places a citation in the text and **Insert reference list** adds the list.
- **Check sources** asks Crossref whether any of your sources has been retracted or corrected.

To start from a source library, the **Bibliography** card in the tool catalogue opens a document with this window already open.

## Page settings and columns

The **Preview** tab in the side panel shows how the PDF will look. The **Settings** tab holds:

- **Page**: **Paper size** (A4, A5, B5, Letter, Legal), **Orientation**, **Margins**, **Columns** and **Column gap**.
- **Text**: **Font**, **Size**, **Line spacing**, **Heading colour**, and a separate heading font if you want one.
- **Header and footer**: header and footer text, plus **Page numbers**.
- **Table of contents**: **Add a table of contents** and how many heading levels it shows.
- **Cover**: **Add a cover page** in the **Classic**, **Colour band**, **Frame** or **Minimal** style.

To set part of the document in a different number of columns, use the **Section break** menu on the formatting bar. **Section break: 2 columns** starts the next page in two columns, while **Continuous section break: 2 columns** carries on on the same page, so a full-width title can sit above two-column text.

## Find and replace, word count

The search button at the top, or `Ctrl+F`, opens the **Find and replace** bar; `Ctrl+H` opens it with the replace field showing. **Match case** and **Whole words only** narrow the search, and **Replace all** changes every match in one step that a single undo reverses.

The word and character count is always shown below the editor. When you select text, it shows the words in the selection alongside the total.

## Save and export

`Ctrl+S` saves a vivePDF document (`.vivedoc`) that you can reopen and keep editing. For the finished file, click **Export** or press `Ctrl+E` and choose a **File type**:

- **PDF**: with its cover, contents, page numbers and bookmarks. The text stays selectable.
- **Markdown**: headings, lists, tables, links, pictures and footnotes are kept; colours, fonts and the page layout are left out.

For free-form work such as posters, invitations or business cards, see [Design in Studio](https://vivepdf.com/en/docs/studio-design/). To change a PDF you already have, start from the [Tools](https://vivepdf.com/en/docs/tools/) list.
