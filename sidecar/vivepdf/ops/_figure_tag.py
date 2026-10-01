import re

import pymupdf

REFERENCE = re.compile(r"(\d+)\s+0\s+R")
TOKEN = re.compile(r"<<|>>|\[|\]|\d+\s+\d+\s+R|/[^\s/\[\]<>()]+|\([^)]*\)|<[^<>]*>|[^\s\[\]<>/()]+")
MAX_ALT_CHARS = 2000


def _key(document: pymupdf.Document, xref: int, key: str) -> tuple[str, str]:
    try:
        return document.xref_get_key(xref, key)
    except (ValueError, RuntimeError, pymupdf.mupdf.FzErrorBase):
        return ("null", "null")


def _reference(value: str) -> int | None:
    match = REFERENCE.fullmatch(value.strip())
    return int(match.group(1)) if match else None


def _structure_root(document: pymupdf.Document) -> int | None:
    kind, value = _key(document, document.pdf_catalog(), "StructTreeRoot")
    return _reference(value) if kind == "xref" else None


def _is_array_object(document: pymupdf.Document, xref: int) -> bool:
    return document.xref_object(xref, compressed=True).lstrip().startswith("[")


def _array_items(text: str) -> list[str]:
    body = text.strip()[1:-1]
    items: list[str] = []
    depth = 0
    current = ""
    tokens = TOKEN.findall(body)
    for token in tokens:
        if token in ("<<", "["):
            depth += 1
        elif token in (">>", "]"):
            depth -= 1
        current = f"{current} {token}".strip()
        if depth == 0:
            items.append(current)
            current = ""
    return items


def _page_index_of(
    document: pymupdf.Document, element: int, pages: dict[int, int], depth: int = 0
) -> int | None:
    kind, value = _key(document, element, "Pg")
    if kind == "xref":
        page = _reference(value)
        if page in pages:
            return pages[page]
    if depth >= 2:
        return None
    kind, value = _key(document, element, "K")
    children = [value] if kind == "xref" else _array_items(value) if kind == "array" else []
    for child in children:
        child_xref = _reference(child)
        if child_xref is not None:
            found = _page_index_of(document, child_xref, pages, depth + 1)
            if found is not None:
                return found
    return None


def _insert_kid(document: pymupdf.Document, holder: int, element: int, page_index: int) -> None:
    kind, value = _key(document, holder, "K")
    array_xref = _reference(value) if kind == "xref" else None
    if array_xref is not None and _is_array_object(document, array_xref):
        items = _array_items(document.xref_object(array_xref, compressed=True))
    elif kind == "array":
        items = _array_items(value)
    elif kind in ("null", "none") or not value:
        items = []
    else:
        items = [value]
    pages = {document[index].xref: index for index in range(document.page_count)}
    position = len(items)
    last_known = None
    for index, item in enumerate(items):
        child = _reference(item)
        found = _page_index_of(document, child, pages) if child is not None else None
        if found is None:
            continue
        last_known = found
        if found > page_index:
            position = index
            break
    if last_known is None:
        position = len(items)
    items.insert(position, f"{element} 0 R")
    text = "[" + " ".join(items) + "]"
    if array_xref is not None and _is_array_object(document, array_xref):
        document.update_object(array_xref, text)
    else:
        document.xref_set_key(holder, "K", text)


def _figure_parent(document: pymupdf.Document, root: int) -> int:
    kind, value = _key(document, root, "K")
    single = _reference(value) if kind == "xref" else None
    if single is not None and not _is_array_object(document, single):
        type_kind, type_value = _key(document, single, "Type")
        if type_kind != "name" or type_value == "/StructElem":
            return single
    return root


def _parent_tree(document: pymupdf.Document, root: int) -> int:
    kind, value = _key(document, root, "ParentTree")
    tree = _reference(value) if kind == "xref" else None
    if tree is not None:
        return tree
    tree = document.get_new_xref()
    document.update_object(tree, value if kind == "dict" else "<</Nums[]>>")
    document.xref_set_key(root, "ParentTree", f"{tree} 0 R")
    return tree


def _largest_key(document: pymupdf.Document, node: int, depth: int = 0) -> int:
    kind, value = _key(document, node, "Nums")
    largest = -1
    if kind == "array":
        numbers = _array_items(value)[0::2]
        keys = [int(number) for number in numbers if number.lstrip("-").isdigit()]
        largest = max(keys, default=-1)
    if depth < 16:
        kind, value = _key(document, node, "Kids")
        if kind == "array":
            for kid in _array_items(value):
                kid_xref = _reference(kid)
                if kid_xref is not None:
                    largest = max(largest, _largest_key(document, kid_xref, depth + 1))
    return largest


def _append_entry(document: pymupdf.Document, node: int, key: int, entry: str) -> None:
    kind, value = _key(document, node, "Kids")
    kids = _array_items(value) if kind == "array" else []
    last = _reference(kids[-1]) if kids else None
    if last is not None:
        _append_entry(document, last, key, entry)
        limits_kind, limits = _key(document, node, "Limits")
        if limits_kind == "array":
            low = _array_items(limits)[0]
            document.xref_set_key(node, "Limits", f"[{low} {key}]")
        return
    kind, value = _key(document, node, "Nums")
    items = _array_items(value) if kind == "array" else []
    document.xref_set_key(node, "Nums", "[" + " ".join([*items, str(key), entry]) + "]")
    limits_kind, limits = _key(document, node, "Limits")
    if limits_kind == "array":
        low = _array_items(limits)[0]
        document.xref_set_key(node, "Limits", f"[{low} {key}]")


def _next_parent_key(document: pymupdf.Document, root: int, tree: int) -> int:
    kind, value = _key(document, root, "ParentTreeNextKey")
    declared = int(value) if kind == "int" else 0
    return max(declared, _largest_key(document, tree) + 1)


def _wrap_form(document: pymupdf.Document, form: int, opening: bytes) -> None:
    document.update_stream(form, opening + b"\n" + document.xref_stream(form) + b"\nEMC\n")


def is_tagged(document: pymupdf.Document) -> bool:
    return _structure_root(document) is not None


def clean_alt(alt: str | None) -> str:
    return " ".join((alt or "").split())[:MAX_ALT_CHARS]


def tag_placed_figure(page: pymupdf.Page, form: int, alt: str | None, box: pymupdf.Rect) -> None:
    document = page.parent
    root = _structure_root(document)
    if root is None or form <= 0:
        return
    text = clean_alt(alt)
    if not text:
        _wrap_form(document, form, b"/Artifact BMC")
        return
    tree = _parent_tree(document, root)
    key = _next_parent_key(document, root, tree)
    parent = _figure_parent(document, root)
    element = document.get_new_xref()
    placed = pymupdf.Rect(box) * ~page.transformation_matrix
    placed.normalize()
    bounds = " ".join(str(round(value, 2)) for value in tuple(placed))
    document.update_object(
        element,
        f"<</Type/StructElem/S/Figure/P {parent} 0 R/Pg {page.xref} 0 R"
        f"/K<</Type/MCR/Pg {page.xref} 0 R/Stm {form} 0 R/MCID 0>>"
        f"/Alt {pymupdf.get_pdf_str(text)}/A<</O/Layout/BBox[{bounds}]>>>>",
    )
    _wrap_form(document, form, b"/Figure <</MCID 0>> BDC")
    document.xref_set_key(form, "StructParents", str(key))
    _append_entry(document, tree, key, f"[{element} 0 R]")
    document.xref_set_key(root, "ParentTreeNextKey", str(key + 1))
    _insert_kid(document, parent, element, page.number)
