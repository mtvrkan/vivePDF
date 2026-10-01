import re
import xml.etree.ElementTree as ElementTree
from datetime import UTC, datetime
from typing import Literal
from xml.sax.saxutils import escape

import pymupdf
from PIL import ImageCms

from vivepdf.ops._colour_use import ColourUse
from vivepdf.ops._document import open_document
from vivepdf.ops._objects import set_key
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._pdfa_fonts import fix_fonts, font_problems
from vivepdf.ops._pdfa_levels import (
    DEFAULT_LEVEL,
    Level,
    associate_attachments,
    attachment_problems,
    claim_satisfies,
    conformance_of,
    jpx_images,
    object_streams,
    optional_content,
    part_of,
    reencode_jpx,
    remove_optional_content,
    remove_transparency_groups,
    srgb_profile_v2,
    transparency,
)
from vivepdf.ops.a11y import _font_facts, require_pages
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

PdfaStatus = Literal["pass", "fail"]
CheckId = Literal[
    "encryption",
    "actions",
    "fonts",
    "colour",
    "outputIntent",
    "metadata",
    "annotations",
    "forms",
    "attachments",
    "compression",
    "images",
    "layers",
    "transparency",
    "jpeg2000",
    "objectStreams",
    "unicode",
]
FORBIDDEN_ACTIONS = {
    "/Launch",
    "/Sound",
    "/Movie",
    "/ResetForm",
    "/ImportData",
    "/JavaScript",
    "/Hide",
    "/SetOCGState",
    "/Rendition",
    "/Trans",
    "/GoTo3DView",
}
ALLOWED_NAMED = {"/NextPage", "/PrevPage", "/FirstPage", "/LastPage"}
FORBIDDEN_ANNOTATIONS = {"/Sound", "/Movie", "/3D", "/RichMedia", "/Screen", "/FileAttachment"}
ATTACHMENT_ANNOTATION = "/FileAttachment"
NO_APPEARANCE_NEEDED = {"/Popup", "/Link"}
FLAG_INVISIBLE = 1
FLAG_HIDDEN = 2
FLAG_PRINT = 4
FLAG_NO_ZOOM = 8
FLAG_NO_ROTATE = 16
FLAG_NO_VIEW = 32
FLAG_TOGGLE_NO_VIEW = 256
CONCEALING_FLAGS = FLAG_INVISIBLE | FLAG_HIDDEN | FLAG_NO_VIEW
SRGB_NAME = "sRGB IEC61966-2.1"
ICC_VERSION_4_2 = bytes([4, 0x20, 0, 0])
ICC_ID_RANGE = slice(84, 100)
ICC_MAJOR_LIMIT_PART_1 = 4
ICC_VERSION_PROBLEM = "iccVersion"
REFERENCE = re.compile(r"(\d+)\s+0\s+R")
RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
KEPT_XMP_PROPERTIES = {
    "http://purl.org/dc/elements/1.1/": {"rights", "language", "publisher", "contributor"},
    "http://ns.adobe.com/xap/1.0/rights/": None,
    "http://ns.adobe.com/xap/1.0/mm/": {"DocumentID", "InstanceID", "OriginalDocumentID"},
}
XMP_PREFIXES = {
    "http://purl.org/dc/elements/1.1/": "dc",
    "http://ns.adobe.com/xap/1.0/rights/": "xmpRights",
    "http://ns.adobe.com/xap/1.0/mm/": "xmpMM",
    RDF_NS: "rdf",
    "http://www.w3.org/XML/1998/namespace": "xml",
}
PDF_DATE = re.compile(r"D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?")


class PdfaCheck(RpcModel):
    id: CheckId
    status: PdfaStatus
    fixable: bool
    count: int | None = None
    value: str | None = None


class PdfaReport(RpcModel):
    level: Level
    page_count: int
    claimed: str | None
    checks: list[PdfaCheck]
    ready: bool
    convertible: bool


class PdfaCheckParams(RpcModel):
    path: str
    password: str | None = None
    level: Level = DEFAULT_LEVEL


class PdfaConvertParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    level: Level = DEFAULT_LEVEL


class PdfaConvertResult(OutputResult):
    fixed: list[CheckId]
    report: PdfaReport


def _key(document: pymupdf.Document, xref: int, key: str) -> tuple[str, str]:
    try:
        return document.xref_get_key(xref, key)
    except (RuntimeError, ValueError):
        return ("null", "null")


def _set(document: pymupdf.Document, xref: int, key: str, value: str) -> None:
    set_key(document, xref, key.split("/"), value)


def _object_xrefs(document: pymupdf.Document) -> range:
    return range(1, document.xref_length())


def _claimed(document: pymupdf.Document) -> str | None:
    xml = document.get_xml_metadata() or ""
    part = re.search(r"pdfaid:part(?:>|\s*=\s*[\"'])\s*(\d)", xml)
    if not part:
        return None
    conformance = re.search(r"pdfaid:conformance(?:>|\s*=\s*[\"'])\s*([ABUabu])", xml)
    return f"PDF/A-{part.group(1)}{(conformance.group(1) if conformance else '').lower()}"


def _action_forbidden_at(document: pymupdf.Document, xref: int, prefix: str) -> bool:
    kind, value = _key(document, xref, f"{prefix}S")
    if kind == "name" and value in FORBIDDEN_ACTIONS:
        return True
    if kind == "name" and value == "/Named":
        return _key(document, xref, f"{prefix}N")[1] not in ALLOWED_NAMED
    return False


def _inline_action_forbidden(document: pymupdf.Document, xref: int, key: str) -> bool:
    kind, value = _key(document, xref, key)
    if kind == "array":
        return any(
            _action_forbidden_at(document, int(reference), "")
            for reference in REFERENCE.findall(value)
            if 0 < int(reference) < document.xref_length()
        )
    return _action_forbidden_at(document, xref, f"{key}/")


def _action_holders(document: pymupdf.Document) -> list[tuple[int, str]]:
    catalog = document.pdf_catalog()
    holders: list[tuple[int, str]] = []
    if _key(document, catalog, "Names/JavaScript")[0] != "null":
        holders.append((catalog, "Names/JavaScript"))
    if _inline_action_forbidden(document, catalog, "OpenAction"):
        holders.append((catalog, "OpenAction"))
    for xref in _object_xrefs(document):
        if _key(document, xref, "AA")[0] != "null":
            holders.append((xref, "AA"))
        for key in ("A", "A/Next", "Next"):
            if _inline_action_forbidden(document, xref, key):
                holders.append((xref, key))
    return holders


def _action_problems(document: pymupdf.Document) -> int:
    return len(_action_holders(document))


def _remove_actions(document: pymupdf.Document) -> None:
    for xref, key in _action_holders(document):
        _set(document, xref, key, "null")


def _uses_cmyk(document: pymupdf.Document) -> bool:
    colours = ColourUse(document)
    return any("cmyk" in colours.page_families(page) for page in document)


def _pdfa_intent(document: pymupdf.Document) -> tuple[int, int] | None:
    kind, value = _key(document, document.pdf_catalog(), "OutputIntents")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]))
    if kind not in ("array", "xref"):
        return None
    for reference in REFERENCE.findall(value):
        intent = int(reference)
        if not 0 < intent < document.xref_length():
            continue
        if _key(document, intent, "S")[1] != "/GTS_PDFA1":
            continue
        profile_kind, profile = _key(document, intent, "DestOutputProfile")
        if profile_kind != "xref":
            continue
        profile_xref = int(profile.split()[0])
        if not document.xref_is_stream(profile_xref):
            continue
        components_kind, components = _key(document, profile_xref, "N")
        if components_kind == "int":
            header = document.xref_stream(profile_xref) or b""
            return int(components), header[8] if len(header) > 8 else 0
    return None


def _pdfa_intent_components(document: pymupdf.Document) -> int | None:
    intent = _pdfa_intent(document)
    return intent[0] if intent else None


def _intent_problem(document: pymupdf.Document, level: Level) -> tuple[bool, bool, str | None]:
    intent = _pdfa_intent(document)
    if intent is None:
        return True, True, None
    components, major = intent
    if part_of(level) == "1" and major >= ICC_MAJOR_LIMIT_PART_1:
        return True, components != 4, ICC_VERSION_PROBLEM
    return False, True, None


def _colour_problem(document: pymupdf.Document) -> bool:
    return _uses_cmyk(document) and _pdfa_intent_components(document) != 4


def _srgb_profile() -> bytes:
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
    profile[8:12] = ICC_VERSION_4_2
    profile[ICC_ID_RANGE] = bytes(16)
    return bytes(profile)


def _add_output_intent(document: pymupdf.Document, level: Level) -> None:
    profile = document.get_new_xref()
    document.update_object(profile, "<< /N 3 >>")
    data = srgb_profile_v2(SRGB_NAME) if part_of(level) == "1" else _srgb_profile()
    document.update_stream(profile, data, compress=True)
    intent = document.get_new_xref()
    document.update_object(
        intent,
        f"<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier ({SRGB_NAME})"
        f" /Info ({SRGB_NAME}) /RegistryName (http://www.color.org)"
        f" /DestOutputProfile {profile} 0 R >>",
    )
    _set(document, document.pdf_catalog(), "OutputIntents", f"[{intent} 0 R]")


def _forbidden_annotations(level: Level) -> set[str]:
    if part_of(level) == "3":
        return FORBIDDEN_ANNOTATIONS - {ATTACHMENT_ANNOTATION}
    return FORBIDDEN_ANNOTATIONS


def _annotation_problems(document: pymupdf.Document, level: Level) -> int:
    forbidden = _forbidden_annotations(level)
    count = 0
    for page in document:
        for xref, _kind, _name in page.annot_xrefs():
            subtype = _key(document, xref, "Subtype")[1]
            if subtype in forbidden:
                count += 1
                continue
            flags_kind, flags_value = _key(document, xref, "F")
            flags = int(flags_value) if flags_kind == "int" else 0
            pinned = FLAG_NO_ZOOM | FLAG_NO_ROTATE
            if (
                subtype != "/Popup"
                and (not flags & FLAG_PRINT or flags & (CONCEALING_FLAGS | FLAG_TOGGLE_NO_VIEW))
                or subtype == "/Text"
                and flags & pinned != pinned
                or subtype not in NO_APPEARANCE_NEEDED
                and _key(document, xref, "AP/N")[0] == "null"
            ):
                count += 1
    return count


def _fix_annotations(document: pymupdf.Document, level: Level) -> None:
    forbidden = _forbidden_annotations(level)
    for page in document:
        doomed: list[int] = []
        for xref, _kind, _name in page.annot_xrefs():
            subtype = _key(document, xref, "Subtype")[1]
            flags_kind, flags_value = _key(document, xref, "F")
            flags = int(flags_value) if flags_kind == "int" else 0
            if subtype in forbidden or (subtype != "/Popup" and flags & CONCEALING_FLAGS):
                doomed.append(xref)
                continue
            if subtype == "/Popup":
                continue
            flags = (flags | FLAG_PRINT) & ~FLAG_TOGGLE_NO_VIEW
            if subtype == "/Text":
                flags |= FLAG_NO_ZOOM | FLAG_NO_ROTATE
            _set(document, xref, "F", str(flags))
        for annotation in list(page.annots()):
            if annotation.xref in doomed:
                page.delete_annot(annotation)
            elif _key(document, annotation.xref, "AP/N")[0] == "null":
                annotation.update()
        for widget in list(page.widgets()):
            if widget.xref in doomed:
                page.delete_widget(widget)
            elif _key(document, widget.xref, "AP/N")[0] == "null":
                widget.update()


def _form_problems(document: pymupdf.Document) -> int:
    catalog = document.pdf_catalog()
    count = 0
    if _key(document, catalog, "AcroForm/NeedAppearances")[1] == "true":
        count += 1
    if _key(document, catalog, "AcroForm/XFA")[0] != "null":
        count += 1
    return count


def _fix_forms(document: pymupdf.Document) -> None:
    catalog = document.pdf_catalog()
    if _key(document, catalog, "AcroForm")[0] == "null":
        return
    _set(document, catalog, "AcroForm/NeedAppearances", "null")
    _set(document, catalog, "AcroForm/XFA", "null")
    for page in document:
        for widget in page.widgets():
            widget.update()


def _stream_xrefs(document: pymupdf.Document) -> list[int]:
    return [xref for xref in _object_xrefs(document) if document.xref_is_stream(xref)]


def _lzw_streams(document: pymupdf.Document) -> list[int]:
    return [
        xref for xref in _stream_xrefs(document) if "LZWDecode" in _key(document, xref, "Filter")[1]
    ]


def _reflate(document: pymupdf.Document, xrefs: list[int]) -> None:
    for xref in xrefs:
        data = document.xref_stream(xref)
        _set(document, xref, "DecodeParms", "null")
        _set(document, xref, "Filter", "null")
        document.update_stream(xref, data, compress=True)


def _interpolated_images(document: pymupdf.Document) -> list[int]:
    return [
        xref
        for xref in _stream_xrefs(document)
        if _key(document, xref, "Interpolate")[1] == "true"
        or _key(document, xref, "Alternates")[0] != "null"
        or _key(document, xref, "OPI")[0] != "null"
    ]


def _fix_images(document: pymupdf.Document, xrefs: list[int]) -> None:
    for xref in xrefs:
        _set(document, xref, "Interpolate", "null")
        _set(document, xref, "Alternates", "null")
        _set(document, xref, "OPI", "null")


def _layer_configs(document: pymupdf.Document) -> list[tuple[int, str]]:
    catalog = document.pdf_catalog()
    if _key(document, catalog, "OCProperties")[0] == "null":
        return []
    configs: list[tuple[int, str]] = [(catalog, "OCProperties/D/")]
    kind, value = _key(document, catalog, "OCProperties/Configs")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]), compressed=True)
        kind = "array"
    if kind == "array":
        configs.extend(
            (int(reference), "")
            for reference in REFERENCE.findall(value)
            if 0 < int(reference) < document.xref_length()
        )
    return configs


def _layer_problems(document: pymupdf.Document) -> int:
    count = 0
    for xref, prefix in _layer_configs(document):
        count += int(_key(document, xref, f"{prefix}Name")[0] == "null")
        count += int(_key(document, xref, f"{prefix}AS")[0] != "null")
    return count


def _fix_layers(document: pymupdf.Document) -> None:
    for position, (xref, prefix) in enumerate(_layer_configs(document)):
        if _key(document, xref, f"{prefix}Name")[0] == "null":
            name = "(Default)" if position == 0 else f"(Configuration {position})"
            _set(document, xref, f"{prefix}Name", name)
        _set(document, xref, f"{prefix}AS", "null")


def _xmp_date(value: str) -> str | None:
    match = PDF_DATE.match(value or "")
    if not match:
        return None
    year, month, day, hour, minute, second, zone = match.groups()
    stamp = f"{year}-{month or '01'}-{day or '01'}T{hour or '00'}:{minute or '00'}:{second or '00'}"
    if not zone or zone == "Z":
        return stamp + "Z"
    digits = zone.replace("'", "")
    return f"{stamp}{digits[:3]}:{digits[3:5] or '00'}"


def _pdf_date(moment: datetime) -> str:
    return moment.strftime("D:%Y%m%d%H%M%SZ")


def _kept_xmp_properties(xml: str) -> str:
    if not xml.strip():
        return ""
    try:
        root = ElementTree.fromstring(re.sub(r"<\?xpacket[^>]*\?>", "", xml).strip())
    except ElementTree.ParseError:
        return ""
    for namespace, prefix in XMP_PREFIXES.items():
        ElementTree.register_namespace(prefix, namespace)
    kept: list[str] = []
    for description in root.iter(f"{{{RDF_NS}}}Description"):
        for child in description:
            namespace, _, name = child.tag[1:].partition("}")
            allowed = KEPT_XMP_PROPERTIES.get(namespace, set())
            if allowed is not None and name not in allowed:
                continue
            text = ElementTree.tostring(child, encoding="unicode")
            kept.append(
                f'<rdf:Description rdf:about="" xmlns:{XMP_PREFIXES[namespace]}="{namespace}">'
                f"{text}</rdf:Description>"
            )
    return "".join(kept)


def _xmp(
    metadata: dict[str, str],
    created: str,
    modified: str,
    kept: str = "",
    level: Level = DEFAULT_LEVEL,
) -> str:
    def text(key: str) -> str:
        return escape(metadata.get(key) or "")

    title = text("title")
    author = text("author")
    subject = text("subject")
    parts = [
        f'<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">'
        f"<pdfaid:part>{part_of(level)}</pdfaid:part>"
        f"<pdfaid:conformance>{conformance_of(level)}</pdfaid:conformance></rdf:Description>",
        f'<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
        f"<xmp:CreateDate>{created}</xmp:CreateDate><xmp:ModifyDate>{modified}</xmp:ModifyDate>"
        f"<xmp:MetadataDate>{modified}</xmp:MetadataDate>"
        + (f"<xmp:CreatorTool>{text('creator')}</xmp:CreatorTool>" if text("creator") else "")
        + "</rdf:Description>",
        '<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">'
        + (f"<pdf:Producer>{text('producer')}</pdf:Producer>" if text("producer") else "")
        + (f"<pdf:Keywords>{text('keywords')}</pdf:Keywords>" if text("keywords") else "")
        + "</rdf:Description>",
    ]
    dublin: list[str] = []
    if title:
        dublin.append(
            f'<dc:title><rdf:Alt><rdf:li xml:lang="x-default">{title}</rdf:li></rdf:Alt></dc:title>'
        )
    if author:
        dublin.append(f"<dc:creator><rdf:Seq><rdf:li>{author}</rdf:li></rdf:Seq></dc:creator>")
    if subject:
        dublin.append(
            '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">'
            f"{subject}</rdf:li></rdf:Alt></dc:description>"
        )
    parts.append(
        '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">'
        "<dc:format>application/pdf</dc:format>" + "".join(dublin) + "</rdf:Description>"
    )
    parts.append(kept)
    return (
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        + "".join(parts)
        + "</rdf:RDF></x:xmpmeta>"
        + '<?xpacket end="w"?>'
    )


def _write_metadata(document: pymupdf.Document, level: Level) -> None:
    now = datetime.now(UTC).replace(microsecond=0)
    metadata = {key: value for key, value in (document.metadata or {}).items() if value}
    created = _xmp_date(metadata.get("creationDate", ""))
    if created is None:
        metadata["creationDate"] = _pdf_date(now)
        created = _xmp_date(metadata["creationDate"])
    metadata["modDate"] = _pdf_date(now)
    modified = _xmp_date(metadata["modDate"])
    document.set_metadata(
        {
            key: metadata.get(key, "")
            for key in (
                "title",
                "author",
                "subject",
                "keywords",
                "creator",
                "producer",
                "creationDate",
                "modDate",
            )
        }
    )
    kept = _kept_xmp_properties(document.get_xml_metadata() or "")
    document.set_xml_metadata(_xmp(metadata, created or "", modified or "", kept, level))


def _encrypted(document: pymupdf.Document) -> bool:
    return bool((document.metadata or {}).get("encryption"))


def _level_measures(
    document: pymupdf.Document, level: Level
) -> list[tuple[CheckId, int, str | None, bool]]:
    if part_of(level) == "1":
        blending, groups = transparency(document)
        layers, hidden = optional_content(document)
        return [
            ("layers", layers, None, not hidden),
            ("transparency", blending + len(groups), None, not blending),
            ("jpeg2000", len(jpx_images(document)), None, True),
            ("objectStreams", object_streams(document), None, True),
        ]
    measures: list[tuple[CheckId, int, str | None, bool]] = [
        ("layers", _layer_problems(document), None, True)
    ]
    if level == "2u":
        measures.append(("unicode", len(_font_facts(document).without_unicode), None, False))
    return measures


def build_report(
    document: pymupdf.Document, progress: Progress, level: Level = DEFAULT_LEVEL
) -> PdfaReport:
    require_pages(document)
    progress.report(0.1, "progress.analyzing", {"current": 1, "total": document.page_count})
    fonts = font_problems(document)
    cmyk = _colour_problem(document)
    intent_missing, intent_fixable, intent_value = _intent_problem(document, level)
    claimed = _claimed(document)
    attachments = (
        attachment_problems(document) if part_of(level) == "3" else document.embfile_count()
    )
    progress.check_cancelled()
    measured: list[tuple[CheckId, int, str | None, bool]] = [
        ("encryption", int(_encrypted(document)), None, True),
        ("actions", _action_problems(document), None, True),
        ("fonts", fonts.count, ", ".join(fonts.stuck) or None, not fonts.stuck),
        ("colour", int(cmyk), None, False),
        ("outputIntent", int(intent_missing), intent_value, intent_fixable),
        ("metadata", int(not claim_satisfies(claimed, level)), claimed, True),
        ("annotations", _annotation_problems(document, level), None, True),
        ("forms", _form_problems(document), None, True),
        ("attachments", attachments, None, True),
        ("compression", len(_lzw_streams(document)), None, True),
        ("images", len(_interpolated_images(document)), None, True),
        *_level_measures(document, level),
    ]
    checks = [
        PdfaCheck(
            id=check_id,
            status="fail" if count else "pass",
            fixable=fixable,
            count=count or None,
            value=value,
        )
        for check_id, count, value, fixable in measured
    ]
    failing = [check for check in checks if check.status == "fail"]
    return PdfaReport(
        level=level,
        page_count=document.page_count,
        claimed=claimed,
        checks=checks,
        ready=not failing,
        convertible=all(check.fixable for check in failing),
    )


@op("pdfa.check", PdfaCheckParams)
def check(params: PdfaCheckParams, progress: Progress) -> PdfaReport:
    with open_document(params.path, params.password) as document:
        return build_report(document, progress, params.level)


def _level_steps(document: pymupdf.Document, level: Level) -> list[tuple[CheckId, object]]:
    if part_of(level) == "1":
        return [
            ("layers", lambda: remove_optional_content(document)),
            ("transparency", lambda: remove_transparency_groups(document)),
            ("jpeg2000", lambda: reencode_jpx(document, jpx_images(document))),
        ]
    return [("layers", lambda: _fix_layers(document))]


def _remove_attachments(document: pymupdf.Document) -> None:
    for _ in range(document.embfile_count()):
        document.embfile_del(0)


def _apply_fixes(
    document: pymupdf.Document, report: PdfaReport, progress: Progress
) -> list[CheckId]:
    failing = {check.id for check in report.checks if check.status == "fail"}
    level = report.level
    keep_attachments = part_of(level) == "3"
    steps = [
        ("actions", lambda: _remove_actions(document)),
        ("outputIntent", lambda: _add_output_intent(document, level)),
        ("annotations", lambda: _fix_annotations(document, level)),
        ("forms", lambda: _fix_forms(document)),
        (
            "attachments",
            lambda: (
                associate_attachments(document)
                if keep_attachments
                else _remove_attachments(document)
            ),
        ),
        ("compression", lambda: _reflate(document, _lzw_streams(document))),
        ("images", lambda: _fix_images(document, _interpolated_images(document))),
        *_level_steps(document, level),
    ]
    fixed: list[CheckId] = []
    for position, (check_id, apply) in enumerate(steps):
        progress.check_cancelled()
        progress.report(0.2 + position / len(steps) * 0.6, "progress.repairing")
        if check_id in failing:
            apply()
            fixed.append(check_id)
    if font_problems(document).count:
        fix_fonts(document)
        fixed.append("fonts")
    for check_id in ("encryption", "objectStreams"):
        if check_id in failing:
            fixed.append(check_id)
    _write_metadata(document, level)
    if "metadata" in failing:
        fixed.append("metadata")
    return fixed


@op("pdfa.convert", PdfaConvertParams)
def convert(params: PdfaConvertParams, progress: Progress) -> PdfaConvertResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        before = build_report(document, progress, params.level)
        blocking = [
            check.id for check in before.checks if check.status == "fail" and not check.fixable
        ]
        if blocking:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "the document has problems that cannot be fixed automatically",
                {"reason": "pdfaUnfixable", "checks": blocking},
            )
        fixed = _apply_fixes(document, before, progress)
        progress.report(0.9, "progress.saving")
        saved = save_document(
            document,
            target,
            encryption=pymupdf.PDF_ENCRYPT_NONE,
            use_objstms=part_of(params.level) != "1",
        )
    with pymupdf.open(saved.output) as written:
        after = build_report(written, progress, params.level)
    return PdfaConvertResult(**saved.model_dump(), fixed=fixed, report=after)
