import re
from dataclasses import dataclass, field

from vivepdf.ops._studio_cv_parse import Line, body_size
from vivepdf.ops._studio_cv_text import (
    BULLET,
    TEXT_LIMIT,
    URL,
    DateSpan,
    clip,
    contacts_in,
    find_range,
    find_single,
    fold,
    location_value,
    trimmed,
)

PAIR = re.compile(r"\s+(?:at|@|bei|chez|presso)\s+|\s+[-|—–]\s+|\s*[,|@]\s+", re.IGNORECASE)
CATEGORY = re.compile(r"^[^:,]{1,30}:\s+(?=\S)")
SCHOOL = re.compile(
    r"universit|univ\.|college|school|okul|lise|institut|enstitu|academy|akademi|hochschule"
    r"|fakulte|faculty|gymnasium|ecole|escuela|escola|liceo|lycee|politecnic|polytechnic|جامعة"
)
ORGANISATION = re.compile(
    r"\b(?:inc|ltd|llc|gmbh|ag|corp|co|a\.s|s\.a|sti|plc|bv|srl|sas|holding|group)\b\.?"
)
ON_REQUEST = re.compile(r"request|talep|anfrage|demande|solicitud|richiesta|solicitacao")
ITEM_SEPARATORS = ",;•|·▪●"


@dataclass
class Entry:
    titles: list[str] = field(default_factory=list)
    start: str = ""
    end: str = ""
    current: bool = False
    location: str = ""
    details: str = ""


def _bullet_text(text: str) -> tuple[bool, str]:
    match = BULLET.match(text)
    return (True, text[match.end() :].strip()) if match else (False, text.strip())


def paragraph(lines: list[Line]) -> str:
    parts: list[str] = []
    previous: Line | None = None
    for line in lines:
        bullet, text = _bullet_text(line.text)
        if bullet:
            parts.append(f"- {text}")
        elif (
            parts
            and previous is not None
            and previous.page == line.page
            and line.y0 - previous.y1 < line.size * 0.6
            and not previous.text.rstrip().endswith(":")
        ):
            parts[-1] += f" {text}"
        else:
            parts.append(text)
        previous = line
    return clip("\n".join(parts), TEXT_LIMIT)


def logical_lines(lines: list[Line]) -> list[str]:
    result: list[str] = []
    previous: Line | None = None
    for line in lines:
        bullet, text = _bullet_text(line.text)
        if not text:
            continue
        joins = (
            result
            and not bullet
            and previous is not None
            and previous.page == line.page
            and (result[-1].endswith((",", "-", "/", "&")) or text[:1].islower())
        )
        if joins:
            glue = "" if result[-1].endswith(("-", "/")) else " "
            result[-1] += glue + text
        else:
            result.append(text)
        previous = line
    return result


def _split_items(text: str) -> list[str]:
    items: list[str] = []
    depth = 0
    current: list[str] = []
    for character in text:
        depth += (character == "(") - (character == ")")
        if character in ITEM_SEPARATORS and depth <= 0:
            items.append("".join(current))
            current = []
        else:
            current.append(character)
    items.append("".join(current))
    return [item.strip(" \t-–—:;") for item in items if item.strip(" \t-–—:;")]


def list_items(lines: list[Line], strip_category: bool) -> list[str]:
    items: list[str] = []
    for text in logical_lines(lines):
        if strip_category:
            text = CATEGORY.sub("", text, count=1)
        items.extend(_split_items(text))
    return items


def skills(lines: list[Line]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in list_items(lines, True):
        key = fold(item)
        if key not in seen:
            seen.add(key)
            result.append(clip(item))
    return result


def _style_flags(lines: list[Line]) -> tuple[list[bool], bool]:
    body = body_size(lines)
    flags = [line.bold or line.size > body + 0.6 for line in lines]
    return flags, any(flags) and not all(flags)


def _title_like(line: Line, styled: bool, varied: bool, loose: bool) -> bool:
    text = line.text.strip()
    if BULLET.match(text) or len(text) > 120 or text.endswith(":"):
        return False
    if text.endswith(".") and not styled:
        return False
    if varied:
        return styled
    return loose or len(text) <= 80


def _anchors(lines: list[Line]) -> list[tuple[int, DateSpan]]:
    for finder, limit in ((find_range, 140), (find_single, 80)):
        anchors: list[tuple[int, DateSpan]] = []
        for index, line in enumerate(lines):
            if BULLET.match(line.text) or len(line.text) > limit:
                continue
            span = finder(line.text)
            if span is not None and len(span.before) + len(span.after) <= 120:
                anchors.append((index, span))
        if anchors:
            return anchors
    return []


def _location_after(
    lines: list[Line], index: int, limit: int, flags: list[bool], linkedin: bool
) -> str:
    if index >= limit:
        return ""
    line = lines[index]
    text = line.text.strip()
    if BULLET.match(text):
        return ""
    place = location_value(text)
    if place:
        return place
    relaxed = (
        linkedin
        and not flags[index]
        and len(text) <= 40
        and not any(character.isdigit() for character in text)
        and not text.endswith((".", ":"))
    )
    return trimmed(text) if relaxed else ""


def entries(lines: list[Line], linkedin: bool) -> list[Entry]:
    if not lines:
        return []
    pairs = _anchors(lines)
    if not pairs:
        return [Entry([lines[0].text], details=paragraph(lines[1:]))]
    anchors = [index for index, _ in pairs]
    flags, varied = _style_flags(lines)
    found: list[Entry] = []
    consumed: list[int] = []
    for position, (anchor, span) in enumerate(pairs):
        limit = anchors[position + 1] if position + 1 < len(anchors) else len(lines)
        entry = Entry(start=span.start, end=span.end, current=span.current)
        if span.before:
            entry.titles.append(span.before)
        if span.after:
            place = location_value(span.after)
            if place:
                entry.location = place
            else:
                entry.titles.append(span.after)
        cursor = anchor + 1
        if anchors[0] == 0:
            while (
                cursor < limit
                and len(entry.titles) < 2
                and _title_like(lines[cursor], flags[cursor], varied, not entry.titles)
            ):
                entry.titles.append(lines[cursor].text.strip())
                cursor += 1
        if not entry.location:
            entry.location = _location_after(lines, cursor, limit, flags, linkedin)
            cursor += 1 if entry.location else 0
        consumed.append(cursor)
        found.append(entry)
    if anchors[0] == 0:
        for position, entry in enumerate(found):
            limit = anchors[position + 1] if position + 1 < len(anchors) else len(lines)
            entry.details = paragraph(lines[consumed[position] : limit])
        return found
    starts: list[int] = []
    for position, anchor in enumerate(anchors):
        lower = 0 if position == 0 else consumed[position - 1]
        reach = 3 if position == 0 else 2
        start = anchor
        styled_seen = False
        while start - 1 >= lower and anchor - (start - 1) <= reach:
            styled = flags[start - 1]
            if not _title_like(lines[start - 1], styled, False, False) or (
                varied and styled_seen and not styled
            ):
                break
            start -= 1
            styled_seen = styled_seen or styled
        if varied and not styled_seen:
            start = anchor
        starts.append(start)
        found[position].titles[:0] = [line.text.strip() for line in lines[start:anchor]]
    for position, entry in enumerate(found):
        limit = starts[position + 1] if position + 1 < len(found) else len(lines)
        orphans = lines[: starts[0]] if position == 0 else []
        entry.details = paragraph(orphans + lines[consumed[position] : limit])
    return found


def split_pair(text: str) -> tuple[str, str]:
    match = PAIR.search(text)
    if match is None:
        return trimmed(text), ""
    return trimmed(text[: match.start()]), trimmed(text[match.end() :])


def _with_extra(details: str, extra: list[str]) -> str:
    return clip("\n".join([*extra, details]) if extra else details, TEXT_LIMIT)


def experience_fields(entry: Entry, linkedin: bool) -> tuple[str, str, str]:
    texts = [trimmed(text) for text in entry.titles if trimmed(text)]
    if not texts:
        return "", "", entry.details
    if len(texts) == 1:
        role, organisation = split_pair(texts[0])
        return clip(role), clip(organisation), entry.details
    first, second = texts[0], texts[1]
    first_org = ORGANISATION.search(fold(first)) is not None
    second_org = ORGANISATION.search(fold(second)) is not None
    if linkedin or (first_org and not second_org):
        first, second = second, first
    return clip(first), clip(second), _with_extra(entry.details, texts[2:])


def education_fields(entry: Entry, linkedin: bool) -> tuple[str, str, str]:
    texts = [trimmed(text) for text in entry.titles if trimmed(text)]
    if not texts:
        return "", "", entry.details
    if len(texts) == 1:
        left, right = split_pair(texts[0])
        if right and SCHOOL.search(fold(left)):
            return clip(right), clip(left), entry.details
        if right and SCHOOL.search(fold(right)):
            return clip(left), clip(right), entry.details
        if SCHOOL.search(fold(texts[0])):
            return "", clip(texts[0]), entry.details
        return clip(texts[0]), "", entry.details
    schools = [index for index, text in enumerate(texts[:2]) if SCHOOL.search(fold(text))]
    school_index = schools[0] if schools else (0 if linkedin else 1)
    degree = texts[1 - school_index]
    return clip(degree), clip(texts[school_index]), _with_extra(entry.details, texts[2:])


def certificates(lines: list[Line]) -> list[tuple[str, str, str]]:
    result: list[tuple[str, str, str]] = []
    for text in logical_lines(lines):
        span = find_range(text) or find_single(text)
        date = ""
        if span is not None:
            date = f"{span.start} - {span.end}" if span.start else span.end
            text = " ".join(part for part in (span.before, span.after) if part)
        name, issuer = split_pair(text)
        if name:
            result.append((clip(name), clip(issuer), clip(date)))
    return result


def _groups(lines: list[Line]) -> list[list[Line]]:
    flags, varied = _style_flags(lines)
    groups: list[list[Line]] = []
    for index, line in enumerate(lines):
        previous = lines[index - 1] if index else None
        if varied:
            starts = flags[index] and not (index and flags[index - 1])
        else:
            starts = previous is None or (
                previous.page != line.page or line.y0 - previous.y1 > line.size * 0.9
            )
        if starts or not groups:
            groups.append([line])
        else:
            groups[-1].append(line)
    return groups


def projects(lines: list[Line]) -> list[tuple[str, str, str]]:
    result: list[tuple[str, str, str]] = []
    for group in _groups(lines):
        link = ""
        for line in group:
            match = URL.search(line.text)
            if match:
                link = match.group().rstrip(".,;:)")
                break
        name = trimmed(URL.sub(" ", group[0].text)) if link else trimmed(group[0].text)
        rest = [line for line in group[1:] if trimmed(URL.sub(" ", line.text))]
        if name:
            result.append((clip(name), clip(link), paragraph(rest)))
    return result


def references(lines: list[Line]) -> list[tuple[str, str, str]]:
    result: list[tuple[str, str, str]] = []
    for group in _groups(lines):
        if len(group) <= 2 and ON_REQUEST.search(fold(" ".join(line.text for line in group))):
            continue
        contact, role = "", ""
        for line in group[1:]:
            found, rest = contacts_in(line.text)
            if found and not contact:
                contact = found[0][1]
            elif not found and rest and not role:
                role = rest
        result.append((clip(trimmed(group[0].text)), clip(role), clip(contact)))
    return result
