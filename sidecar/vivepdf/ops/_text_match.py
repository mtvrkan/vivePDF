import re

from vivepdf.ops._safe_pattern import compile_safe_patterns
from vivepdf.rpc.errors import ErrorCode, OpError

_INLINE_SPACE = re.compile(r"[^\S\n]")


def compile_text_pattern(value: str) -> re.Pattern[str]:
    compiled = compile_safe_patterns([value], re.IGNORECASE)
    if not compiled:
        raise OpError(ErrorCode.INVALID_PARAMS, "empty pattern", {"reason": "badPattern"})
    return compiled[0]


def text_label(text: str, pattern: re.Pattern[str]) -> str | None:
    match = pattern.search(_INLINE_SPACE.sub(" ", text))
    if match is None:
        return None
    label = match.group(1) if match.groups() else match.group(0)
    return (label or "").strip()
