import pymupdf

from vivepdf.ops._document import open_document
from vivepdf.ops._studio_cv_models import (
    CvCertificate,
    CvContact,
    CvCustom,
    CvEducation,
    CvExperience,
    CvLevelled,
    CvProfile,
    CvProject,
    CvReference,
    CvSection,
    StudioCvImportParams,
    StudioCvImportResult,
)
from vivepdf.ops._studio_cv_parse import (
    INFERRED_CONFIDENCE,
    KEYWORD_CONFIDENCE,
    Block,
    Line,
    block_contacts,
    first_page_emails,
    page_lines,
    read_header,
    segment,
)
from vivepdf.ops._studio_cv_sections import (
    certificates,
    education_fields,
    entries,
    experience_fields,
    list_items,
    paragraph,
    projects,
    references,
    skills,
)
from vivepdf.ops._studio_cv_text import TEXT_LIMIT, clip, fold, language_level
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op

MAX_PAGES = 40
LIMITS = {
    "contacts": 10,
    "experience": 30,
    "education": 20,
    "skills": 60,
    "languages": 20,
    "certificates": 30,
    "projects": 30,
    "references": 10,
    "custom": 10,
}
SECTION_ORDER = (
    "personal",
    "contact",
    "summary",
    "experience",
    "education",
    "skills",
    "languages",
    "certificates",
    "projects",
    "references",
    "interests",
    "custom",
)


def _read(params: StudioCvImportParams, progress: Progress) -> tuple[list[Line], int, int]:
    lines: list[Line] = []
    footers = 0
    with open_document(params.path, params.password, mutable=False) as document:
        pages = document.page_count
        total = min(pages, MAX_PAGES)
        try:
            for index in range(total):
                progress.check_cancelled()
                found, footer_count = page_lines(document[index], index)
                lines.extend(found)
                footers += footer_count
                progress.report(
                    (index + 1) / total,
                    "progress.analyzing",
                    {"current": index + 1, "total": total},
                )
        except (RuntimeError, ValueError, pymupdf.FileDataError) as error:
            raise OpError(ErrorCode.INVALID_PDF, "cannot read the PDF text") from error
    return lines, footers, pages


def _contacts(found: list[tuple[str, str]]) -> list[CvContact]:
    seen: set[tuple[str, str]] = set()
    result: list[CvContact] = []
    for kind, value in found:
        key = (kind, fold(value).rstrip("/"))
        if value and key not in seen:
            seen.add(key)
            result.append(CvContact(kind=kind, value=clip(value)))
    return result[: LIMITS["contacts"]]


def _levelled(names: list[str], languages: bool) -> list[CvLevelled]:
    result: list[CvLevelled] = []
    for item in names:
        name, level = language_level(item) if languages else (clip(item), 0)
        if name:
            result.append(CvLevelled(name=name, level=level))
    return result


def _fill(profile: CvProfile, block: Block, linkedin: bool) -> int:
    lines = block.lines
    if block.key == "summary":
        text = paragraph(lines)
        profile.summary = clip(
            f"{profile.summary}\n{text}" if profile.summary else text, TEXT_LIMIT
        )
        return 1 if text else 0
    if block.key == "experience":
        items = []
        for entry in entries(lines, linkedin):
            role, organisation, details = experience_fields(entry, linkedin)
            items.append(
                CvExperience(
                    role=role,
                    organisation=organisation,
                    location=clip(entry.location),
                    start=entry.start,
                    end=entry.end,
                    current=entry.current,
                    details=details,
                )
            )
        profile.experience.extend(items)
        return len(items)
    if block.key == "education":
        schools = []
        for entry in entries(lines, linkedin):
            degree, school, details = education_fields(entry, linkedin)
            schools.append(
                CvEducation(
                    degree=degree,
                    school=school,
                    location=clip(entry.location),
                    start=entry.start,
                    end=entry.end,
                    details=details,
                )
            )
        profile.education.extend(schools)
        return len(schools)
    if block.key == "skills":
        found = _levelled(skills(lines), False)
        profile.skills.extend(found)
        return len(found)
    if block.key == "languages":
        found = _levelled(list_items(lines, False), True)
        profile.languages.extend(found)
        return len(found)
    if block.key == "certificates":
        certs = [CvCertificate(name=n, issuer=i, date=d) for n, i, d in certificates(lines)]
        profile.certificates.extend(certs)
        return len(certs)
    if block.key == "projects":
        works = [CvProject(name=n, link=k, details=d) for n, k, d in projects(lines)]
        profile.projects.extend(works)
        return len(works)
    if block.key == "references":
        people = [CvReference(name=n, role=r, contact=c) for n, r, c in references(lines)]
        profile.references.extend(people)
        return len(people)
    if block.key == "interests":
        items = list_items(lines, False)
        joined = ", ".join(filter(None, [profile.interests, *items]))
        profile.interests = clip(joined, TEXT_LIMIT)
        return len(items)
    if block.key == "custom":
        body = paragraph(lines)
        if body:
            profile.custom.append(CvCustom(heading=clip(block.heading), body=body))
        return 1 if body else 0
    return 0


def _profile(lines: list[Line], footers: int) -> tuple[CvProfile, list[CvSection], bool]:
    header_lines, blocks, headings = segment(lines)
    every = " ".join(fold(line.text) for line in lines)
    linkedin = "linkedin.com/in/" in every and (
        footers > 0 or bool(headings & {"top skills", "contact"})
    )
    header = read_header(header_lines, lines, linkedin)
    profile = CvProfile(name=clip(header.name), headline=clip(header.headline))
    counts: dict[str, int] = {}
    confidence: dict[str, float] = {}
    found_contacts = list(header.contacts)
    location = header.location
    for block in blocks:
        if block.key in ("contact", "personal"):
            extra, place = block_contacts(block.lines)
            found_contacts.extend(extra)
            location = location or place
            if extra:
                confidence["contact"] = KEYWORD_CONFIDENCE
            if block.key == "personal":
                confidence["personal"] = KEYWORD_CONFIDENCE
            continue
        count = _fill(profile, block, linkedin)
        if count:
            counts[block.key] = counts.get(block.key, 0) + count
            confidence[block.key] = max(confidence.get(block.key, 0.0), block.confidence)
    if not profile.summary and header.leftover:
        profile.summary = paragraph(header.leftover)
        counts["summary"] = 1
        confidence["summary"] = INFERRED_CONFIDENCE
    if not any(kind == "email" for kind, _ in found_contacts):
        found_contacts.extend(first_page_emails(lines))
    if location:
        found_contacts.append(("location", location))
    profile.contacts = _contacts(found_contacts)
    for key, limit in LIMITS.items():
        setattr(profile, key, getattr(profile, key)[:limit])
    counts["personal"] = int(bool(profile.name)) + int(bool(profile.headline))
    counts["contact"] = len(profile.contacts)
    for key, limit in LIMITS.items():
        if key in counts:
            counts[key] = min(counts[key], limit)
    sections = [
        CvSection(
            key=key,
            count=counts[key],
            confidence=confidence.get(key, INFERRED_CONFIDENCE),
        )
        for key in SECTION_ORDER
        if counts.get(key, 0) > 0
    ]
    return profile, sections, linkedin


@op("studio.cv_import_pdf", StudioCvImportParams)
def cv_import_pdf(params: StudioCvImportParams, progress: Progress) -> StudioCvImportResult:
    lines, footers, pages = _read(params, progress)
    if not any(any(character.isalnum() for character in line.text) for line in lines):
        raise OpError(ErrorCode.UNSUPPORTED, "the PDF has no text", {"reason": "noText"})
    profile, sections, linkedin = _profile(lines, footers)
    return StudioCvImportResult(
        profile=profile,
        sections=sections,
        source="linkedin" if linkedin else "generic",
        pages=pages,
    )
