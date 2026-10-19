# Security

> How to password-protect a PDF in vivePDF, set permissions, seal it with a certificate, add watermarks and stamps, strip hidden data and redact.

URL: https://vivepdf.com/en/docs/security/
Last updated: 2026-10-18

vivePDF's security tools let you add a password and permissions to a PDF, remove a password, seal a file so that only chosen certificate holders can open it, add watermarks and stamps, clean out hidden data before sharing and permanently redact text. Every tool writes its result to a new file; your original stays as it was.

## Finding the tools

Open **Tools › Security**; the page starts on **Add password**. Click **Security** above the page title to list every tool in the group: **Add password**, **Remove password**, **Seal with a certificate**, **Open with a certificate**, **Redaction**, **Privacy check** and the [signing tools](https://vivepdf.com/en/docs/sign/). **Add watermark**, **Stamp** and **Remove watermark** sit in the **Content editing** group. **Show all** in the **Tools** menu lists every tool as well.

## Passwords and permissions

1. On **Add password**, choose the PDF.
2. Type an **Open password**. It is needed to open the document; leave it empty if you only want to limit what people can do.
3. Type an **Owner password**. It is needed to change the permissions later.
4. Under **Permissions**, choose what is allowed, or use **Quick set**: **Everything allowed**, **Read only**, **No copying** or **Most restricted**.
5. Click **Add password**.

If you leave the owner password empty, a random one is created and shown once when the file is written. Keep it somewhere safe: it is the only way to lift the limits later. For **Encryption**, use **AES-256 (recommended)**; AES-128 and RC4 are only for older readers and cannot store letters such as ş, ğ or İ in a password. **Encrypt the file information too** also protects the title, author and subject.

New passwords are checked against a built-in list of common breached passwords. If you turn on the online check in **Settings › Web**, only the first 5 characters of the password's SHA-1 hash go to Have I Been Pwned, never the password itself.

**Remove password** creates a copy without a password; enter the open or the owner password. If the file is protected by permissions only, it works without one.

## Sealing with a certificate

**Seal with a certificate** encrypts the file so that only the holders of the private keys for the certificates under **Recipients** can open it, with no password at all. Add the recipients' public certificates with **Add a certificate**, then click **Seal**. Only RSA certificates can receive a sealed document.

To open a sealed file, use **Open with a certificate**: choose the **Sealed PDF**, the **Certificate (.p12 / .pfx)** that carries your private key and its password, then click **Open**. An unprotected copy is written. To give someone your own public certificate, see **Export public certificate** on [Sign and verify](https://vivepdf.com/en/docs/sign/).

## Watermarks and stamps

In **Add watermark**, choose a **Watermark type**: **Text**, **Image** (PNG / JPG) or a **PDF page** from another file. A live preview shows the first page while you set the size, position and pages. **Show the watermark** can limit it to the screen or to print. **Burn the watermark into the page** turns marked pages into pictures, so the watermark can no longer be removed, but the text on those pages can no longer be selected or searched either.

**Stamp** puts a framed word at the chosen place on each page: pick a preset such as **APPROVED**, **DRAFT**, **CONFIDENTIAL** or **PAID**, or write your own. Placeholders such as `{date}`, `{name}`, `{page}` and `{total}` are filled in. Settings you use often can be kept under **Presets**.

**Remove watermark** scans the document and lists the watermarks it finds; tick the ones to remove. Check the result in the Viewer.

## Privacy check

**Privacy check** shows what a file reveals beyond its visible pages. Click **Scan document** to see findings such as metadata, XMP metadata, JavaScript and automatic actions, embedded files, comments, external links, hidden text, hidden layers, and camera and location details in photos. Tick the items under **What to remove** and click **Clean and save**.

> **Signed files**
>
> Cleaning a signed file writes a new file without a valid signature. If it has to stay signed, sign the cleaned copy again.

## Redaction

If sensitive text stays in the file, remove it for good with **Redaction**. Type words under **Text to find**, or pick kinds from **Sensitive data found**, such as IBANs, e-mail addresses or phone numbers, and add regular expressions if needed. Use **Count matches** to check first, then click **Redact**. Matching text is removed from the file and covered; this cannot be undone.

**Also remove matches outside the page** searches comments, form fields, bookmarks and document properties too. To black out an area by hand, open the document in the Viewer, choose **Edit › Page tools › Black out area**, drag over the area and click **Black out**. The full list of tools is on the [Tools](https://vivepdf.com/en/docs/tools/) page.
