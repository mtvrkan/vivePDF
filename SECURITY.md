# Security policy

## Supported versions

Security fixes go into the latest release only. The app checks for updates itself (**Settings › Updates**), so staying current is the way to receive them.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead: open the [Security tab](https://github.com/mtvrkan/vivePDF/security) of this repository and choose **Report a vulnerability**.

A useful report says which version and operating system you used, what an attacker can do, and how to reproduce it (a sample file helps; remove anything personal from it first). You will get an answer as soon as possible, and a fix ships in a release once the problem is confirmed. Reporters are credited in the release notes unless they prefer not to be.

## Scope

In scope: the vivePDF desktop app, its PDF engine and its updater, and the website at https://vivepdf.com.

vivePDF works offline and uploads nothing, so most reports concern malicious PDF or Office files, the local engine and its file access, or the update channel. Problems in third-party components (PyMuPDF, LibreOffice, Tesseract, Ghostscript and others) are welcome too; they are patched in vivePDF where possible.
