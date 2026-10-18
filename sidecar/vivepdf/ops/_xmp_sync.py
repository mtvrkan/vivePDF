import re
from datetime import datetime
from typing import Literal
from xml.sax.saxutils import escape

import pymupdf

DC = "http://purl.org/dc/elements/1.1/"
PDF = "http://ns.adobe.com/pdf/1.3/"
XMP = "http://ns.adobe.com/xap/1.0/"
DEFAULT_PREFIXES = {DC: "dc", PDF: "pdf", XMP: "xmp"}
Shape = Literal["alt", "seq", "simple"]
PROPERTIES: dict[str, tuple[str, str, Shape]] = {
    "title": (DC, "title", "alt"),
    "author": (DC, "creator", "seq"),
    "subject": (DC, "description", "alt"),
    "keywords": (PDF, "Keywords", "simple"),
    "creator": (XMP, "CreatorTool", "simple"),
    "producer": (PDF, "Producer", "simple"),
}
DATES = ("ModifyDate", "MetadataDate")
RDF_END = "</rdf:RDF>"


def _prefix(xml: str, namespace: str) -> str:
    declared = re.search(rf'xmlns:([\w.-]+)\s*=\s*["\']{re.escape(namespace)}["\']', xml)
    return declared.group(1) if declared else DEFAULT_PREFIXES[namespace]


def _element(tag: str, shape: Shape, value: str) -> str:
    text = escape(value)
    if shape == "alt":
        return f'<{tag}><rdf:Alt><rdf:li xml:lang="x-default">{text}</rdf:li></rdf:Alt></{tag}>'
    if shape == "seq":
        return f"<{tag}><rdf:Seq><rdf:li>{text}</rdf:li></rdf:Seq></{tag}>"
    return f"<{tag}>{text}</{tag}>"


def _sync_property(xml: str, namespace: str, name: str, shape: Shape, value: str) -> str:
    prefix = _prefix(xml, namespace)
    tag = f"{prefix}:{name}"
    quoted = re.escape(tag)
    element = re.compile(rf"<{quoted}(?:\s[^>]*?)?(?:/>|>.*?</{quoted}>)", re.DOTALL)
    attribute = re.compile(rf"\s{quoted}\s*=\s*(\"[^\"]*\"|'[^']*')")
    found = bool(element.search(xml) or attribute.search(xml))
    replacement = _element(tag, shape, value) if value else ""
    xml = element.sub(lambda _match: replacement, xml, count=1)
    if shape == "simple":
        new_attribute = f' {tag}="{escape(value, {'"': "&quot;"})}"' if value else ""
        xml = attribute.sub(lambda _match: new_attribute, xml, count=1)
    if found or not value or RDF_END not in xml:
        return xml
    description = (
        f'<rdf:Description rdf:about="" xmlns:{prefix}="{namespace}">'
        f"{_element(tag, shape, value)}</rdf:Description>"
    )
    return xml.replace(RDF_END, description + RDF_END, 1)


def sync_xmp(
    document: pymupdf.Document, values: dict[str, str], modified: datetime | None = None
) -> bool:
    xml = document.get_xml_metadata() or ""
    if RDF_END not in xml:
        return False
    updated = xml
    for key, value in values.items():
        if key in PROPERTIES:
            namespace, name, shape = PROPERTIES[key]
            updated = _sync_property(updated, namespace, name, shape, value)
    if modified is not None:
        stamp = modified.strftime("%Y-%m-%dT%H:%M:%SZ")
        for name in DATES:
            updated = _sync_property(updated, XMP, name, "simple", stamp)
    if updated == xml:
        return False
    document.set_xml_metadata(updated)
    return True
