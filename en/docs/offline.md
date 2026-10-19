# Offline mode

> How to turn on Offline mode in vivePDF, what it stops, what keeps working without the internet and how features show that they are off.

URL: https://vivepdf.com/en/docs/offline/
Last updated: 2026-10-18

Offline mode stops every internet connection vivePDF makes with a single switch: update checks, downloads, web searches and lookups, opening web pages and online checks. Because the PDF tools already run on this computer, everything else keeps working without the internet. Your documents never leave this computer, whether the mode is on or off.

## Turn on Offline mode

1. Open **Settings** from the top bar.
2. Go to the **Web** section in the **Application** group.
3. Turn on **Offline mode**.

The mode is off by default. You can also see its state at the top of **Help › Privacy**: "Offline mode is on" or "Offline mode is off". **Open setting** there takes you straight to the switch.

## What it stops

While the mode is on, every feature that needs the internet is switched off:

- **Updates**: no automatic check at start-up, and **Settings › Updates** shows "Not checked: offline mode is on".
- **Downloads**: OCR language packs, read-aloud voices, translation languages, missing fonts in Studio and the LibreOffice download.
- **Web searches**: **Search on the web**, **Search picture with Google Lens** and **Google Translate** under **Translate** in the Viewer's right-click menu.
- **Web pages**: the **Web page → PDF** conversion.
- **Online checks**: the Have I Been Pwned check for new passwords, the timestamp server while signing, **Check revocation online** while verifying, and DOI lookups and checks in Studio.
- **GitHub**: **Open on GitHub** in a bug report and **Refresh from GitHub** in About.

This is not only a matter of the interface: the PDF engine also refuses requests that would go online while the mode is on.

## What keeps working

Everything that does not need the internet works as usual:

- Opening, reading, searching, organising pages, merging, splitting, compressing, converting, signing, password protection and every other PDF tool.
- [OCR](https://vivepdf.com/en/docs/ocr/) with installed languages, read aloud with installed voices and the **Offline translator** with installed languages.
- Word, Excel and PowerPoint [conversions](https://vivepdf.com/en/docs/convert/) through the LibreOffice that comes with the Windows installer.
- Studio, presentations and presenter view.
- **Help topics**, the keyboard shortcut list, **Save support bundle…** and copying a bug report or saving it to a file.

> **Download first, then switch off**
>
> If you will work on a computer without internet, download the OCR languages, voices and translation languages you need first, then turn on Offline mode. Downloaded packs stay on this computer and work offline.

## How switched-off features look

Offline mode does not hide anything. Buttons stay where they are but are greyed out and cannot be clicked; hovering over one shows "Off while offline mode is on (Settings › Web)".

Sections that download things (such as the OCR language packs in **Settings › Tools**) and the **Web page → PDF** screen show a note: "Offline mode is on, so nothing is downloaded or looked up on the internet." **Change** beside the note takes you to **Settings › Web**.

Offline mode only stops vivePDF's own connections; it does not cut your computer's internet connection, so your browser and other apps carry on as usual.

If an action still needs the internet, you see the message "This needs the internet, but offline mode is on." Switching the mode off brings everything back straight away; you do not need to restart the app.

For the full list of when vivePDF goes online and what it stores on this computer, see [Settings and privacy](https://vivepdf.com/en/docs/settings-privacy/).
