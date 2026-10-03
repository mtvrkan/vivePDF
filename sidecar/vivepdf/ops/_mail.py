import email
import email.policy
import email.utils
import html
import re
import struct
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path

from vivepdf.ops._html_clean import body_fragment, without_remote_pictures
from vivepdf.ops._story import declared_charset, decode_text
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.protocol import RpcModel

MAIL_EXTENSIONS = {"eml", "msg"}
MAX_MAIL_BYTES = 100 * 1024 * 1024
FILETIME_EPOCH = datetime(1601, 1, 1, tzinfo=UTC)
PT_UNICODE = "001F"
PT_STRING8 = "001E"
PT_BINARY = "0102"
PT_SYSTIME = 0x0040
PT_LONG = 0x0003
SUBJECT = 0x0037
SENDER_NAME = 0x0C1A
SENDER_EMAIL = 0x0C1F
SENDER_SMTP = 0x5D01
REPRESENTING_NAME = 0x0042
REPRESENTING_EMAIL = 0x0065
DISPLAY_TO = 0x0E04
DISPLAY_CC = 0x0E03
BODY = 0x1000
BODY_HTML = 0x1013
TRANSPORT_HEADERS = 0x007D
CLIENT_SUBMIT_TIME = 0x0039
DELIVERY_TIME = 0x0E06
MESSAGE_CODEPAGE = 0x3FFD
INTERNET_CODEPAGE = 0x3FDE
ATTACH_LONG_NAME = 0x3707
ATTACH_SHORT_NAME = 0x3704
ATTACH_DISPLAY_NAME = 0x3001
ATTACH_DATA = 0x3701
ATTACH_CONTENT_ID = 0x3712
ATTACH_MIME = 0x370E
TOP_HEADER_BYTES = 32
CHILD_HEADER_BYTES = 8
PROPERTY_ENTRY_BYTES = 16
CID_SOURCE = re.compile(r"""(src\s*=\s*["'])cid:([^"']+)(["'])""", re.IGNORECASE)
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class MailLabels(RpcModel):
    sender: str = "From"
    to: str = "To"
    cc: str = "Cc"
    date: str = "Date"
    attachments: str = "Attachments"


@dataclass
class MailAttachment:
    name: str
    data: bytes
    content_id: str = ""
    mime: str = ""


@dataclass
class MailMessage:
    subject: str = ""
    sender: str = ""
    to: str = ""
    cc: str = ""
    date: str = ""
    html_body: str = ""
    text_body: str = ""
    attachments: list[MailAttachment] = field(default_factory=list)


def _unreadable(path: Path) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        f"cannot read the e-mail: {path.name}",
        {"reason": "fileUnreadable", "path": str(path)},
    )


def _clean_cid(value: str) -> str:
    return value.strip().strip("<>").strip()


def _eml_text(part: EmailMessage) -> str:
    try:
        return str(part.get_content())
    except (LookupError, UnicodeError):
        payload = part.get_payload(decode=True) or b""
        return decode_text(payload, part.get_content_charset())


def read_eml(path: Path) -> MailMessage:
    try:
        parsed = email.message_from_bytes(path.read_bytes(), policy=email.policy.default)
    except Exception as error:  # noqa: BLE001
        raise _unreadable(path) from error
    if not isinstance(parsed, EmailMessage):
        raise _unreadable(path)
    message = MailMessage(
        subject=str(parsed.get("subject", "") or ""),
        sender=str(parsed.get("from", "") or ""),
        to=str(parsed.get("to", "") or ""),
        cc=str(parsed.get("cc", "") or ""),
        date=str(parsed.get("date", "") or ""),
    )
    html_part = parsed.get_body(preferencelist=("html",))
    text_part = parsed.get_body(preferencelist=("plain",))
    if html_part is not None:
        message.html_body = _eml_text(html_part)
    if text_part is not None:
        message.text_body = _eml_text(text_part)
    for part in parsed.walk():
        if part.is_multipart() or part in (html_part, text_part):
            continue
        content_id = _clean_cid(str(part.get("content-id", "") or ""))
        name = part.get_filename() or ""
        if not name and not content_id and part.get_content_disposition() != "attachment":
            continue
        data = part.get_payload(decode=True) or b""
        message.attachments.append(
            MailAttachment(
                name=name or content_id or "attachment",
                data=data,
                content_id=content_id,
                mime=part.get_content_type(),
            )
        )
    return message


class _MsgReader:
    def __init__(self, ole, prefix: list[str]):
        self.ole = ole
        self.prefix = prefix
        self.codepage = "cp1252"

    def _stream(self, name: str) -> bytes | None:
        entry = [*self.prefix, name]
        if not self.ole.exists("/".join(entry)):
            return None
        return self.ole.openstream(entry).read()

    def raw(self, prop: int, kind: str) -> bytes | None:
        return self._stream(f"__substg1.0_{prop:04X}{kind}")

    def text(self, prop: int) -> str:
        unicode = self.raw(prop, PT_UNICODE)
        if unicode is not None:
            return unicode.decode("utf-16-le", errors="replace").rstrip("\x00")
        narrow = self.raw(prop, PT_STRING8)
        if narrow is not None:
            return narrow.decode(self.codepage, errors="replace").rstrip("\x00")
        return ""

    def fixed(self, header: int) -> dict[int, tuple[int, bytes]]:
        data = self._stream("__properties_version1.0") or b""
        values: dict[int, tuple[int, bytes]] = {}
        for offset in range(header, len(data) - PROPERTY_ENTRY_BYTES + 1, PROPERTY_ENTRY_BYTES):
            tag = struct.unpack_from("<I", data, offset)[0]
            values[tag >> 16] = (tag & 0xFFFF, data[offset + 8 : offset + 16])
        return values


def _codepage(values: dict[int, tuple[int, bytes]]) -> str:
    for prop in (INTERNET_CODEPAGE, MESSAGE_CODEPAGE):
        kind, value = values.get(prop, (0, b""))
        if kind == PT_LONG:
            number = struct.unpack_from("<I", value)[0]
            name = "utf-8" if number == 65001 else f"cp{number}"
            try:
                "".encode(name)
            except LookupError:
                continue
            return name
    return "cp1252"


def _filetime(values: dict[int, tuple[int, bytes]]) -> str:
    for prop in (CLIENT_SUBMIT_TIME, DELIVERY_TIME):
        kind, value = values.get(prop, (0, b""))
        if kind == PT_SYSTIME:
            ticks = struct.unpack_from("<Q", value)[0]
            if ticks:
                moment = FILETIME_EPOCH + timedelta(microseconds=ticks // 10)
                return email.utils.format_datetime(moment)
    return ""


def _header_date(headers: str) -> str:
    if not headers:
        return ""
    parsed = email.message_from_string(headers, policy=email.policy.default)
    return str(parsed.get("date", "") or "")


def _msg_sender(reader: _MsgReader) -> str:
    name = reader.text(SENDER_NAME) or reader.text(REPRESENTING_NAME)
    address = (
        reader.text(SENDER_SMTP) or reader.text(SENDER_EMAIL) or reader.text(REPRESENTING_EMAIL)
    )
    if address and "@" not in address:
        address = ""
    if name and address and name != address:
        return f"{name} <{address}>"
    return name or address


def _msg_attachments(ole, reader: _MsgReader) -> list[MailAttachment]:
    storages = sorted(
        {
            entry[0]
            for entry in ole.listdir(streams=True, storages=True)
            if entry and entry[0].startswith("__attach_version1.0_")
        }
    )
    attachments = []
    for storage in storages:
        child = _MsgReader(ole, [storage])
        child.codepage = reader.codepage
        data = child.raw(ATTACH_DATA, PT_BINARY)
        if data is None:
            continue
        name = (
            child.text(ATTACH_LONG_NAME)
            or child.text(ATTACH_SHORT_NAME)
            or child.text(ATTACH_DISPLAY_NAME)
            or "attachment"
        )
        attachments.append(
            MailAttachment(
                name=name,
                data=data,
                content_id=_clean_cid(child.text(ATTACH_CONTENT_ID)),
                mime=child.text(ATTACH_MIME),
            )
        )
    return attachments


def read_msg(path: Path) -> MailMessage:
    import olefile

    if not olefile.isOleFile(str(path)):
        raise _unreadable(path)
    try:
        with olefile.OleFileIO(str(path)) as ole:
            reader = _MsgReader(ole, [])
            values = reader.fixed(TOP_HEADER_BYTES)
            reader.codepage = _codepage(values)
            html_raw = reader.raw(BODY_HTML, PT_BINARY)
            html_body = (
                decode_text(html_raw, declared_charset(html_raw) or reader.codepage)
                if html_raw
                else reader.text(BODY_HTML)
            )
            return MailMessage(
                subject=reader.text(SUBJECT),
                sender=_msg_sender(reader),
                to=reader.text(DISPLAY_TO),
                cc=reader.text(DISPLAY_CC),
                date=_header_date(reader.text(TRANSPORT_HEADERS)) or _filetime(values),
                html_body=html_body,
                text_body=reader.text(BODY),
                attachments=_msg_attachments(ole, reader),
            )
    except OpError:
        raise
    except Exception as error:  # noqa: BLE001
        raise _unreadable(path) from error


def read_mail(path: Path) -> MailMessage:
    if path.stat().st_size > MAX_MAIL_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the e-mail is too large",
            {"reason": "sourceTooLarge", "limit": MAX_MAIL_BYTES},
        )
    if path.suffix.lower() == ".msg":
        return read_msg(path)
    return read_eml(path)


def _safe_file_name(name: str, index: int) -> str:
    cleaned = SAFE_NAME.sub("_", Path(name).name).strip("._") or "file"
    return f"cid{index}-{cleaned}"


def _body_html(message: MailMessage, workdir: Path) -> tuple[str, set[str]]:
    used: set[str] = set()
    if not message.html_body.strip():
        text = message.text_body.strip()
        return (f'<pre class="plain">{html.escape(text)}</pre>' if text else ""), used
    body = body_fragment(message.html_body)
    inline = {item.content_id.lower(): item for item in message.attachments if item.content_id}
    names: dict[str, str] = {}

    def replace(found: re.Match[str]) -> str:
        key = _clean_cid(found.group(2)).lower()
        item = inline.get(key)
        if item is None:
            return f"{found.group(1)}{found.group(3)}"
        if key not in names:
            names[key] = _safe_file_name(item.name, len(names))
            (workdir / names[key]).write_bytes(item.data)
        used.add(key)
        return f"{found.group(1)}{names[key]}{found.group(3)}"

    body = CID_SOURCE.sub(replace, body)
    return without_remote_pictures(body), used


def _header_row(label: str, value: str) -> str:
    if not value.strip():
        return ""
    return f"<tr><th>{html.escape(label)}</th><td>{html.escape(value.strip())}</td></tr>"


def mail_document_html(
    message: MailMessage, labels: MailLabels, workdir: Path
) -> tuple[str, list[MailAttachment]]:
    body, used = _body_html(message, workdir)
    listed = [item for item in message.attachments if item.content_id.lower() not in used]
    rows = (
        _header_row(labels.sender, message.sender)
        + _header_row(labels.to, message.to)
        + _header_row(labels.cc, message.cc)
        + _header_row(labels.date, message.date)
        + _header_row(labels.attachments, ", ".join(item.name for item in listed))
    )
    subject = f'<h1 class="subject">{html.escape(message.subject.strip())}</h1>'
    head = subject if message.subject.strip() else ""
    table = f'<table class="mail-head">{rows}</table>' if rows else ""
    return f'<div class="mail">{head}{table}</div><div class="mail-body">{body}</div>', listed


MAIL_CSS = (
    ".mail{border-bottom:0.8pt solid #999999;padding-bottom:6pt;margin-bottom:10pt;}"
    ".subject{font-size:15pt;margin:0 0 6pt 0;}"
    ".mail-head{border:none;border-collapse:collapse;}"
    ".mail-head th,.mail-head td{border:none;padding:1pt 6pt 1pt 0;font-size:9.5pt;"
    "vertical-align:top;text-align:left;}"
    ".mail-head th{color:#555555;font-weight:normal;}"
    ".mail-body img{max-width:100%;}"
    "pre.plain{font-family:vivepdf,sans-serif;font-size:10.5pt;white-space:pre-wrap;}"
)
