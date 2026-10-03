import re

UNSAFE_TAGS = re.compile(
    r"<(script|style|iframe|object|embed|noscript|head)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL
)
LONELY_TAGS = re.compile(r"<(meta|link|base)\b[^>]*>", re.IGNORECASE)
BODY_CONTENT = re.compile(r"<body\b[^>]*>(.*)</body\s*>", re.IGNORECASE | re.DOTALL)
REMOTE_SOURCE = re.compile(
    r"""(<img\b[^>]*?)\ssrc\s*=\s*["'](?:https?:|file:)?//[^"']*["']""", re.IGNORECASE
)
TAG = re.compile(r"<[^>]*>")


def body_fragment(document: str) -> str:
    match = BODY_CONTENT.search(document)
    body = match.group(1) if match else document
    return LONELY_TAGS.sub("", UNSAFE_TAGS.sub("", body))


def without_remote_pictures(body: str) -> str:
    return REMOTE_SOURCE.sub(r"\1", body)


def visible_text(body: str) -> str:
    return TAG.sub(" ", body).replace("&nbsp;", " ").strip()
