# License

> What vivePDF's AGPL-3.0 licence means for users and for anyone distributing modified builds, plus the third-party components it uses.

URL: https://vivepdf.com/en/docs/license/
Last updated: 2026-10-18

vivePDF is free software released under version 3 of the GNU Affero General Public License (AGPL-3.0-only). You can use the app at no cost, read its source code, change it and share it; if you give a modified version to other people, you must also offer them its source code under the same licence.

> **Not legal advice**
>
> This page sums up the licence in plain words. The full text in the repository's [LICENSE](https://github.com/mtvrkan/vivePDF/blob/main/LICENSE) file is what counts. If you are unsure about your situation, ask a lawyer.

## For users

There are no conditions on using vivePDF for personal work, at school or at work. No fee, account or licence key is needed, and there is no limit on how many computers you install it on.

- All of the source code is public on [GitHub](https://github.com/mtvrkan/vivePDF), so you can see for yourself what the app does.
- You can change the code as you like on your own computer and [build it from source](https://vivepdf.com/en/docs/build-from-source/).
- The licence also states that the software comes without any warranty.

## For people distributing modified builds

The licence's conditions apply once you pass a copy of vivePDF, or a version you have changed, on to others:

- Offer the source code of the version you distribute, including your changes, to everyone who receives it.
- License the modified version under AGPL-3.0 as well; you cannot add further restrictions for the people who receive it.
- Keep the copyright and licence notices intact.
- If you let people use your modified version over a network, the AGPL asks you to offer them its source code too. That is the main difference from the GPL.

## Third-party components

vivePDF is built on open-source components that carry their own licences. Some of them:

- **MuPDF / PyMuPDF** (AGPL-3.0) — the PDF engine
- **Tesseract OCR** (Apache-2.0) — the OCR engine and its language models
- **LibreOffice** (MPL-2.0) — Office file conversions. The Windows installer carries The Document Foundation's signed LibreOffice installer unmodified.
- **pyHanko** (MIT) — digital signatures
- **pdf2docx** (GPL-3.0) — PDF to Word conversion
- **Tauri** (MIT / Apache-2.0) — the desktop shell

The full list, with each component's licence and role in the app, is in [THIRD_PARTY_NOTICES.md](https://github.com/mtvrkan/vivePDF/blob/main/THIRD_PARTY_NOTICES.md). Inside the app, the **Licences** link on the **Help › About** page also lists the components and their licences.
