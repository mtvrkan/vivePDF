import io

import pikepdf

ObjectKey = tuple[int, int]


def _key(value: object) -> ObjectKey | None:
    if isinstance(value, pikepdf.Object) and value.is_indirect:
        return value.objgen
    return None


def _page_kept(page: object, kept: set[ObjectKey]) -> bool:
    key = _key(page)
    return key is None or key in kept


class _StructurePruner:
    def __init__(self, kept: set[ObjectKey]) -> None:
        self.kept = kept
        self.visiting: set[ObjectKey] = set()
        self.identified: list[tuple[pikepdf.Object, pikepdf.Object]] = []

    def keep(self, item: pikepdf.Object, page: object) -> bool:
        if not isinstance(item, pikepdf.Dictionary):
            return _page_kept(page, self.kept)
        own_page = item.get("/Pg", page)
        kind = item.get("/Type")
        if kind in (pikepdf.Name.MCR, pikepdf.Name.OBJR):
            return _page_kept(own_page, self.kept)
        key = _key(item)
        if key is not None:
            if key in self.visiting:
                return True
            self.visiting.add(key)
        if "/K" in item and not self.keep_kids(item, own_page):
            return False
        if "/K" not in item and "/Pg" in item and not _page_kept(own_page, self.kept):
            return False
        if "/ID" in item:
            self.identified.append((item.ID, item))
        return True

    def keep_kids(self, holder: pikepdf.Dictionary, page: object) -> bool:
        kids = holder.K
        if isinstance(kids, pikepdf.Array):
            survivors = [kid for kid in list(kids) if self.keep(kid, page)]
            if not survivors:
                return False
            if len(survivors) != len(kids):
                holder.K = pikepdf.Array(survivors)
            return True
        return self.keep(kids, page)


def _struct_parent_keys(pdf: pikepdf.Pdf) -> set[int]:
    keys: set[int] = set()
    for page in pdf.pages:
        if "/StructParents" in page.obj:
            keys.add(int(page.obj.StructParents))
        for annotation in page.obj.get("/Annots", pikepdf.Array()):
            if isinstance(annotation, pikepdf.Dictionary) and "/StructParent" in annotation:
                keys.add(int(annotation.StructParent))
    return keys


def _number_tree_entries(node: pikepdf.Object, seen: set[ObjectKey]) -> list[tuple[int, object]]:
    key = _key(node)
    if key is not None:
        if key in seen:
            return []
        seen.add(key)
    entries: list[tuple[int, object]] = []
    numbers = node.get("/Nums")
    if isinstance(numbers, pikepdf.Array):
        values = list(numbers)
        for position in range(0, len(values) - 1, 2):
            entries.append((int(values[position]), values[position + 1]))
    for kid in node.get("/Kids", pikepdf.Array()):
        entries.extend(_number_tree_entries(kid, seen))
    return entries


def _prune_structure(pdf: pikepdf.Pdf, kept: set[ObjectKey]) -> None:
    root = pdf.Root.get("/StructTreeRoot")
    if not isinstance(root, pikepdf.Dictionary):
        return
    pruner = _StructurePruner(kept)
    if "/K" in root and not pruner.keep_kids(root, None):
        del pdf.Root.StructTreeRoot
        if "/MarkInfo" in pdf.Root:
            del pdf.Root.MarkInfo
        return
    parent_tree = root.get("/ParentTree")
    if parent_tree is not None:
        wanted = _struct_parent_keys(pdf)
        entries = sorted(
            (number, value)
            for number, value in _number_tree_entries(parent_tree, set())
            if number in wanted
        )
        flat: list[object] = []
        for number, value in entries:
            flat.extend((number, value))
        root.ParentTree = pdf.make_indirect(pikepdf.Dictionary(Nums=pikepdf.Array(flat)))
    if "/IDTree" in root:
        names: list[object] = []
        for identifier, element in sorted(pruner.identified, key=lambda entry: bytes(entry[0])):
            names.extend((identifier, element))
        if names:
            root.IDTree = pdf.make_indirect(pikepdf.Dictionary(Names=pikepdf.Array(names)))
        else:
            del root.IDTree


def _kept_annotations(pdf: pikepdf.Pdf) -> set[ObjectKey]:
    found: set[ObjectKey] = set()
    for page in pdf.pages:
        for annotation in page.obj.get("/Annots", pikepdf.Array()):
            key = _key(annotation)
            if key is not None:
                found.add(key)
    return found


def _keep_field(field: pikepdf.Object, widgets: set[ObjectKey], seen: set[ObjectKey]) -> bool:
    if not isinstance(field, pikepdf.Dictionary):
        return False
    key = _key(field)
    if key is not None:
        if key in seen:
            return False
        seen.add(key)
    if "/Kids" in field:
        survivors = [kid for kid in list(field.Kids) if _keep_field(kid, widgets, seen)]
        if not survivors:
            return False
        if len(survivors) != len(field.Kids):
            field.Kids = pikepdf.Array(survivors)
        return True
    if field.get("/Subtype") == pikepdf.Name.Widget:
        return key in widgets
    return True


def _prune_fields(pdf: pikepdf.Pdf) -> None:
    form = pdf.Root.get("/AcroForm")
    if not isinstance(form, pikepdf.Dictionary) or "/Fields" not in form:
        return
    widgets = _kept_annotations(pdf)
    seen: set[ObjectKey] = set()
    fields = [field for field in list(form.Fields) if _keep_field(field, widgets, seen)]
    if not fields:
        del pdf.Root.AcroForm
        return
    form.Fields = pikepdf.Array(fields)
    if "/CO" in form:
        present = _field_keys(fields)
        form.CO = pikepdf.Array([item for item in list(form.CO) if _key(item) in present])


def _field_keys(fields: list[pikepdf.Object]) -> set[ObjectKey]:
    found: set[ObjectKey] = set()
    pending = list(fields)
    while pending:
        field = pending.pop()
        key = _key(field)
        if key is None or key in found:
            continue
        found.add(key)
        if isinstance(field, pikepdf.Dictionary) and "/Kids" in field:
            pending.extend(field.Kids)
    return found


def _destination_page(value: object) -> object:
    if isinstance(value, pikepdf.Dictionary):
        value = value.get("/D")
    if isinstance(value, pikepdf.Array) and len(value) > 0:
        return value[0]
    return None


def _destination_kept(value: object, kept: set[ObjectKey]) -> bool:
    page = _destination_page(value)
    if page is None or isinstance(page, int):
        return True
    return _page_kept(page, kept)


def _name_tree_entries(node: pikepdf.Object, seen: set[ObjectKey]) -> list[tuple[object, object]]:
    key = _key(node)
    if key is not None:
        if key in seen:
            return []
        seen.add(key)
    entries: list[tuple[object, object]] = []
    names = node.get("/Names")
    if isinstance(names, pikepdf.Array):
        values = list(names)
        for position in range(0, len(values) - 1, 2):
            entries.append((values[position], values[position + 1]))
    for kid in node.get("/Kids", pikepdf.Array()):
        entries.extend(_name_tree_entries(kid, seen))
    return entries


def _prune_destinations(pdf: pikepdf.Pdf, kept: set[ObjectKey]) -> None:
    names = pdf.Root.get("/Names")
    if isinstance(names, pikepdf.Dictionary) and "/Dests" in names:
        entries = [
            (name, value)
            for name, value in _name_tree_entries(names.Dests, set())
            if _destination_kept(value, kept)
        ]
        entries.sort(key=lambda entry: bytes(entry[0]))
        flat: list[object] = []
        for name, value in entries:
            flat.extend((name, value))
        names.Dests = pdf.make_indirect(pikepdf.Dictionary(Names=pikepdf.Array(flat)))
    old_style = pdf.Root.get("/Dests")
    if isinstance(old_style, pikepdf.Dictionary):
        for name in list(old_style.keys()):
            if not _destination_kept(old_style[name], kept):
                del old_style[name]
    action = pdf.Root.get("/OpenAction")
    if action is not None and not _destination_kept(action, kept):
        del pdf.Root.OpenAction


def _prune_links(pdf: pikepdf.Pdf, kept: set[ObjectKey]) -> None:
    for page in pdf.pages:
        annotations = page.obj.get("/Annots")
        if not isinstance(annotations, pikepdf.Array):
            continue
        survivors = []
        for annotation in list(annotations):
            if isinstance(annotation, pikepdf.Dictionary) and annotation.get("/Subtype") == (
                pikepdf.Name.Link
            ):
                target = annotation.get("/Dest")
                action = annotation.get("/A")
                if isinstance(action, pikepdf.Dictionary) and action.get("/S") == pikepdf.Name.GoTo:
                    target = action.get("/D")
                if target is not None and not _destination_kept(target, kept):
                    continue
            survivors.append(annotation)
        if len(survivors) != len(annotations):
            page.obj.Annots = pikepdf.Array(survivors)


def keep_only_present_pages(data: bytes) -> bytes:
    with pikepdf.open(io.BytesIO(data)) as pdf:
        kept = {page.obj.objgen for page in pdf.pages}
        _prune_links(pdf, kept)
        _prune_structure(pdf, kept)
        _prune_fields(pdf)
        _prune_destinations(pdf, kept)
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()
