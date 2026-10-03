import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field

from PIL import Image

from vivepdf.ops._html_clean import body_fragment, visible_text

FRAGMENT_OFFSET = re.compile(rb"(StartHTML|EndHTML|StartFragment|EndFragment):(-?\d+)")
OPEN_ATTEMPTS = 10
OPEN_PAUSE = 0.05
TOOL_TIMEOUT = 5


@dataclass
class ClipboardContent:
    files: list[str] = field(default_factory=list)
    image: Image.Image | None = None
    html: str = ""
    text: str = ""


def html_fragment(data: bytes) -> str:
    offsets = {name.decode(): int(value) for name, value in FRAGMENT_OFFSET.findall(data[:400])}
    start, end = offsets.get("StartFragment", -1), offsets.get("EndFragment", -1)
    if not 0 <= start <= end <= len(data):
        start, end = offsets.get("StartHTML", -1), offsets.get("EndHTML", -1)
    if not 0 <= start <= end <= len(data):
        marker = data.find(b"<")
        start, end = (marker, len(data)) if marker >= 0 else (len(data), len(data))
    return data[start:end].decode("utf-8", errors="replace")


def clipboard_kind(content: ClipboardContent) -> str | None:
    if content.files:
        return "files"
    if content.html and visible_text(body_fragment(content.html)):
        return "html"
    if content.image is not None:
        return "image"
    if content.text.strip():
        return "text"
    return None


def _grab(content: ClipboardContent) -> None:
    from PIL import ImageGrab

    try:
        grabbed = ImageGrab.grabclipboard()
    except (OSError, NotImplementedError):
        return
    if isinstance(grabbed, list):
        content.files = [str(path) for path in grabbed if os.path.isfile(path)]
    elif isinstance(grabbed, Image.Image):
        content.image = grabbed


def _tool_output(command: list[str]) -> str:
    if shutil.which(command[0]) is None:
        return ""
    try:
        completed = subprocess.run(
            command, capture_output=True, timeout=TOOL_TIMEOUT, check=False, shell=False
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    if completed.returncode != 0:
        return ""
    return completed.stdout.decode("utf-8", errors="replace")


def _windows(content: ClipboardContent) -> None:
    import pywintypes
    import win32clipboard

    html_format = win32clipboard.RegisterClipboardFormat("HTML Format")
    for _attempt in range(OPEN_ATTEMPTS):
        try:
            win32clipboard.OpenClipboard()
            break
        except pywintypes.error:
            time.sleep(OPEN_PAUSE)
    else:
        return
    try:
        if win32clipboard.IsClipboardFormatAvailable(html_format):
            data = win32clipboard.GetClipboardData(html_format)
            content.html = html_fragment(data if isinstance(data, bytes) else str(data).encode())
        if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
            content.text = str(win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT))
    finally:
        win32clipboard.CloseClipboard()


def _linux(content: ClipboardContent) -> None:
    if os.environ.get("WAYLAND_DISPLAY") and shutil.which("wl-paste"):
        content.html = _tool_output(["wl-paste", "--no-newline", "--type", "text/html"])
        content.text = _tool_output(["wl-paste", "--no-newline"])
        return
    content.html = _tool_output(["xclip", "-selection", "clipboard", "-t", "text/html", "-o"])
    content.text = _tool_output(["xclip", "-selection", "clipboard", "-o"])


def read_clipboard() -> ClipboardContent:
    content = ClipboardContent()
    _grab(content)
    if content.files:
        return content
    if sys.platform == "win32":
        _windows(content)
    elif sys.platform == "darwin":
        content.text = _tool_output(["pbpaste"])
    else:
        _linux(content)
    return content
