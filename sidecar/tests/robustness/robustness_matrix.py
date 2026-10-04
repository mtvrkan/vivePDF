import base64
import hashlib
import importlib
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import robustness_corpus
from pydantic import BaseModel

from vivepdf.rpc.errors import ErrorCode
from vivepdf.rpc.registry import get_operation, operation_names

SIDECAR_ROOT = Path(__file__).resolve().parents[2]
WORKER_SCRIPT = Path(__file__).resolve().parent / "robustness_worker.py"
DEFAULT_TIMEOUT = float(os.environ.get("VIVEPDF_ROBUSTNESS_TIMEOUT", "20"))
CANCEL_GRACE = float(os.environ.get("VIVEPDF_ROBUSTNESS_CANCEL_GRACE", "10"))
ALLOWED_CODES = {code.value for code in ErrorCode} - {
    ErrorCode.INTERNAL.value,
    ErrorCode.UNKNOWN_METHOD.value,
}

EXCLUDED_OPS = {
    "print.run": "sends the document to a real printer",
    "search.add_folder": "indexes a folder rather than reading a document",
    "search.remove_folder": "edits the search index only",
    "rename.apply": "renames the input file by design",
    "files.move_to_folder": "moves the input file into a folder by design",
    "convert.from_url": "downloads a URL instead of reading a file",
    "scanner.acquire": "drives scanner hardware",
    "codes.export_csv": "reads no file",
    "sign.create_certificate": "reads no file",
}

IN_PLACE_OPS = {
    "attachments.add",
    "attachments.remove",
    "bookmarks.add",
    "comments.delete",
    "comments.set_resolved",
    "comments.set_state",
    "comments.reply",
    "ocr.searchable",
    "pages.insert_from",
}

HUB_OPS = [
    "info.get",
    "viewer.prepare",
    "info.text",
    "info.thumbnail",
    "pages.rotate",
    "compress.run",
    "repair.run",
    "convert.to_images",
    "security.sanitize",
    "preflight.check",
]

OUTPUT_EXTENSIONS = {
    "convert.to_docx": ".docx",
    "convert.to_xlsx": ".xlsx",
    "convert.to_pptx": ".pptx",
    "convert.to_epub": ".epub",
    "convert.to_html": ".html",
    "convert.to_markdown": ".md",
    "convert.to_text": ".txt",
    "bookmarks.export": ".json",
    "comments.export": ".xfdf",
    "forms.export": ".xlsx",
    "forms.export_data": ".xfdf",
    "sign.export_certificate": ".cer",
    "images.save": ".png",
}

PRIMARY_PATH_FIELDS = ("path", "pathA", "paths", "inputs", "sources", "images", "image")


@dataclass(frozen=True)
class Case:
    op: str
    variant: str
    slot: str = "primary"
    with_password: bool = False

    @property
    def label(self) -> str:
        suffix = "" if self.slot == "primary" else f"@{self.slot}"
        password = "+password" if self.with_password else ""
        return f"{self.op}{suffix}[{self.variant}{password}]"


@dataclass
class Outcome:
    case: Case
    status: str
    code: str | None = None
    message: str = ""
    detail: str = ""
    seconds: float = 0.0
    slow: bool = False
    problems: list[str] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return bool(self.problems)

    def describe(self) -> str:
        head = f"{self.case.label}: {self.status}"
        if self.slow:
            head += " (cancelled after the time limit)"
        if self.code:
            head += f" {self.code}"
        lines = [head, *(f"  - {problem}" for problem in self.problems)]
        if self.message:
            lines.append(f"  message: {self.message[:300]}")
        if self.detail:
            lines.append("  " + self.detail[-1500:].replace("\n", "\n  "))
        return "\n".join(lines)


@dataclass
class Fixtures:
    root: Path
    good_pdf: Path
    text_file: Path
    bookmarks_json: Path
    comments_xfdf: Path
    form_xfdf: Path
    merge_csv: Path
    certificate: Path
    public_certificate: Path
    signature_png: str
    variants: dict[str, tuple[robustness_corpus.Variant, Path]]


def _signature_png() -> str:
    return base64.b64encode(robustness_corpus.png_bytes()).decode("ascii")


def _certificates(folder: Path) -> tuple[Path, Path]:
    sign = importlib.import_module("vivepdf.ops.sign_certificate")
    progress = importlib.import_module("vivepdf.rpc.progress").silent_progress
    signer = folder / "signer.p12"
    sign.create_certificate(
        sign.CreateCertificateParams(
            output=str(signer), password="pw-12345", common_name="Robustness", usage="both"
        ),
        progress(),
    )
    public = folder / "signer.cer"
    sign.export_certificate(
        sign.ExportCertificateParams(path=str(signer), password="pw-12345", output=str(public)),
        progress(),
    )
    return signer, public


def prepare_fixtures(
    root: Path, seed: int = robustness_corpus.DEFAULT_SEED, names: set[str] | None = None
) -> Fixtures:
    support = root / "support"
    support.mkdir(parents=True, exist_ok=True)
    good_pdf = support / "good.pdf"
    good_pdf.write_bytes(robustness_corpus.raw_base())
    text_file = support / "attachment.txt"
    text_file.write_text("robustness attachment", encoding="utf-8")
    bookmarks_json = support / "bookmarks.json"
    bookmarks_json.write_text(
        json.dumps({"bookmarks": [{"level": 1, "title": "Bir", "page": 1}]}), encoding="utf-8"
    )
    comments_xfdf = support / "comments.xfdf"
    comments_xfdf.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/">'
        '<annots><text page="0" rect="72,700,92,720" name="a1" subject="Note">'
        "<contents>Hello</contents></text></annots></xfdf>",
        encoding="utf-8",
    )
    form_xfdf = support / "form.xfdf"
    form_xfdf.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/">'
        '<fields><field name="name"><value>Robust</value></field></fields></xfdf>',
        encoding="utf-8",
    )
    merge_csv = support / "rows.csv"
    merge_csv.write_text("name\nAli\nVeli\n", encoding="utf-8")
    certificate, public_certificate = _certificates(support)
    variants = robustness_corpus.write_corpus(root / "corpus", seed, names)
    return Fixtures(
        root=root,
        good_pdf=good_pdf,
        text_file=text_file,
        bookmarks_json=bookmarks_json,
        comments_xfdf=comments_xfdf,
        form_xfdf=form_xfdf,
        merge_csv=merge_csv,
        certificate=certificate,
        public_certificate=public_certificate,
        signature_png=_signature_png(),
        variants=variants,
    )


Overrides = Callable[[Fixtures, dict[str, Any]], dict[str, Any]]


def _box() -> dict[str, float]:
    return {"x0": 72.0, "y0": 72.0, "x1": 200.0, "y1": 140.0}


OVERRIDES: dict[str, Overrides] = {
    "attachments.add": lambda f, c: {"files": [str(f.text_file)]},
    "attachments.extract": lambda f, c: {"names": ["notes.txt"]},
    "attachments.remove": lambda f, c: {"names": ["notes.txt"]},
    "bookmarks.import": lambda f, c: {"dataPath": str(f.bookmarks_json)},
    "bookmarks.parse": lambda f, c: {"dataPath": str(f.bookmarks_json)},
    "bookmarks.set": lambda f, c: {"items": [{"level": 1, "title": "Bir", "page": 1}]},
    "comments.delete": lambda f, c: {"xrefs": [11]},
    "comments.set_resolved": lambda f, c: {"xrefs": [11]},
    "comments.set_state": lambda f, c: {"xrefs": [11], "state": "Accepted"},
    "comments.reply": lambda f, c: {"xref": 11, "content": "Robust"},
    "comments.import": lambda f, c: {"source": str(f.comments_xfdf)},
    "editor.apply": lambda f, c: {
        "objects": [{"kind": "text", "page": 1, **_box(), "text": "Robust"}]
    },
    "editor.font": lambda f, c: {"xref": 4},
    "editor.font_plan": lambda f, c: {"page": 0, "text": "Robust şğ"},
    "forms.import_data": lambda f, c: {"dataPath": str(f.form_xfdf)},
    "forms.merge": lambda f, c: {"dataPath": str(f.merge_csv), "limit": 2},
    "images.at": lambda f, c: {"page": 1, "x": 120.0, "y": 240.0},
    "images.save": lambda f, c: {"page": 1, "x": 120.0, "y": 240.0},
    "codes.add_qr": lambda f, c: {"text": "https://example.org"},
    "pages.header_footer": lambda f, c: {"footerCenter": "{page}"},
    "pages.resize": lambda f, c: {"width": 595.0, "height": 842.0},
    "links.add": lambda f, c: {"links": [{"page": 1, **_box(), "uri": "https://example.org"}]},
    "links.remove": lambda f, c: {"items": [{"page": 1, "xref": 11}]},
    "ocr.area": lambda f, c: {"page": 0, "rect": [0.0, 0.0, 200.0, 200.0]},
    "pages.delete": lambda f, c: {"pages": [1]},
    "pages.extract": lambda f, c: {"pages": [1]},
    "pages.assemble_parts": lambda f, c: {"pages": c["pages"] * 2, "cuts": [1]},
    "pages.impose": lambda f, c: {"layout": "2up"},
    "pages.insert_blank": lambda f, c: {"at": 1},
    "pages.insert_from": lambda f, c: {"sourcePath": str(f.good_pdf), "sourcePages": [1]},
    "pages.letterhead": lambda f, c: {"templatePath": str(f.good_pdf)},
    "pages.rotate": lambda f, c: {"degrees": 90},
    "pages.split": lambda f, c: {"mode": "odd_even"},
    "security.decrypt_certificate": lambda f, c: {
        "certificatePath": str(f.certificate),
        "certificatePassword": "pw-12345",
    },
    "security.encrypt": lambda f, c: {"userPassword": "u", "ownerPassword": "o"},
    "security.encrypt_certificate": lambda f, c: {"certificates": [str(f.public_certificate)]},
    "security.stamp": lambda f, c: {"text": "ONAYLANDI"},
    "security.stamp_preview": lambda f, c: {"text": "ONAYLANDI"},
    "security.watermark": lambda f, c: {"text": "TASLAK"},
    "security.watermark_preview": lambda f, c: {"text": "TASLAK"},
    "security.redact": lambda f, c: {"searchText": ["Robustness"]},
    "security.redact_preview": lambda f, c: {"searchText": ["Robustness"]},
    "sign.run": lambda f, c: {
        "certificatePath": str(f.certificate),
        "certificatePassword": "pw-12345",
    },
    "sign.export_certificate": lambda f, c: {"password": "pw-12345"},
    "signature.place": lambda f, c: {
        "placements": [{"page": 1, **_box(), "pngBase64": f.signature_png}]
    },
    "textedit.code_blocks": lambda f, c: {"page": 0},
    "textedit.find_preview": lambda f, c: {"find": "Robustness"},
    "textedit.find_replace": lambda f, c: {"find": "Robustness", "replace": "Sağlamlık"},
    "textedit.replace": lambda f, c: {
        "page": 0,
        "edits": [
            {"bbox": [72.0, 60.0, 300.0, 80.0], "text": "Robust", "size": 12.0, "color": "#000000"}
        ],
    },
    "textedit.spans": lambda f, c: {"page": 0},
    "editor.blocks": lambda f, c: {"page": 0},
    "info.set_metadata": lambda f, c: {"title": "Robust"},
}

SECONDARY_SLOTS: dict[str, dict[str, Callable[[str, str], dict[str, Any]]]] = {
    "compare.run": {"pathB": lambda primary, hostile: {"pathA": primary, "pathB": hostile}},
    "pages.merge": {
        "second": lambda primary, hostile: {"inputs": [{"path": primary}, {"path": hostile}]}
    },
    "pages.insert_from": {"sourcePath": lambda primary, hostile: {"sourcePath": hostile}},
    "pages.letterhead": {"templatePath": lambda primary, hostile: {"templatePath": hostile}},
    "attachments.add": {"files": lambda primary, hostile: {"files": [hostile]}},
    "bookmarks.import": {"dataPath": lambda primary, hostile: {"dataPath": hostile}},
    "bookmarks.parse": {"dataPath": lambda primary, hostile: {"dataPath": hostile}},
    "forms.import_data": {"dataPath": lambda primary, hostile: {"dataPath": hostile}},
    "forms.merge": {"dataPath": lambda primary, hostile: {"dataPath": hostile}},
    "comments.import": {"source": lambda primary, hostile: {"source": hostile}},
    "sign.run": {"certificatePath": lambda primary, hostile: {"certificatePath": hostile}},
    "security.decrypt_certificate": {
        "certificatePath": lambda primary, hostile: {"certificatePath": hostile}
    },
    "security.encrypt_certificate": {
        "certificates": lambda primary, hostile: {"certificates": [hostile]}
    },
}

TIMEOUT_SCALE = {"ten_thousand_pages": 3.0}
OPERATION_TIMEOUT_SCALE = {"convert.to_markdown": 3.0}
EVERY_OP = "*"
KNOWN_SLOW: dict[str, dict[str, str]] = {}

DAMAGE_REASONS = {"damaged", "tooDeep", "documentTooLarge"}
PRISTINE_VARIANTS = {"valid_raw_base", "valid_rich_base", "single_page"} | {
    name for name in robustness_corpus.NAME_VARIANTS
}

VARIANT_PASSWORDS = {"user_password": "secret", "owner_only": "owner", "same": "same"}


def _aliases(model: type[BaseModel]) -> dict[str, Any]:
    return {(info.alias or name): info for name, info in model.model_fields.items()}


def path_operations() -> list[str]:
    importlib.import_module("vivepdf.rpc.loader").load_all()
    names = []
    for name in operation_names():
        operation = get_operation(name)
        if operation is None or name in EXCLUDED_OPS:
            continue
        if set(_aliases(operation.params_model)) & set(PRIMARY_PATH_FIELDS):
            names.append(name)
    return names


def _generic_value(info: Any) -> Any:
    annotation = str(info.annotation)
    minimum = next(
        (getattr(item, "ge", None) for item in info.metadata if hasattr(item, "ge")), None
    )
    if "int" in annotation:
        return minimum if minimum is not None else 1
    if "float" in annotation:
        return float(minimum) if minimum is not None else 1.0
    if "list" in annotation:
        return ["x"]
    return "x"


def _primary_fields(op_name: str, target: str, fixtures: Fixtures) -> dict[str, Any]:
    fields = _aliases(get_operation(op_name).params_model)
    good = str(fixtures.good_pdf)
    if "path" in fields:
        return {"path": target}
    if "pathA" in fields:
        return {"pathA": target, "pathB": good}
    if "inputs" in fields:
        return {"inputs": [{"path": target}, {"path": good}]}
    if "sources" in fields and "pages" not in fields:
        return {"sources": [{"path": target}]}
    if "sources" in fields:
        return {
            "sources": [{"id": "a", "path": target}],
            "pages": [{"kind": "page", "source": "a", "index": 1}],
        }
    for name in ("paths", "images"):
        if name in fields:
            return {name: [target]}
    return {"image": target}


def build_params(
    op_name: str, fixtures: Fixtures, case_dir: Path, primary: str, stem: str
) -> dict[str, Any]:
    operation = get_operation(op_name)
    fields = _aliases(operation.params_model)
    params: dict[str, Any] = {}
    out = case_dir / "out"
    for alias, info in fields.items():
        if alias == "output":
            params[alias] = str(out / f"{stem}-out{OUTPUT_EXTENSIONS.get(op_name, '.pdf')}")
        elif alias == "outputDir":
            params[alias] = str(out / "parts")
        elif alias == "inPlace":
            params[alias] = False
        elif info.is_required() and alias not in PRIMARY_PATH_FIELDS:
            params[alias] = _generic_value(info)
    params.update(_primary_fields(op_name, primary, fixtures))
    override = OVERRIDES.get(op_name)
    if override is not None:
        params.update(override(fixtures, params))
    return params


def rejected_default_params(fixtures: Fixtures, folder: Path) -> dict[str, str]:
    from pydantic import ValidationError

    rejected = {}
    for op_name in path_operations():
        params = build_params(op_name, fixtures, folder, str(fixtures.good_pdf), "good")
        try:
            get_operation(op_name).params_model.model_validate(params)
        except ValidationError as error:
            rejected[op_name] = str(error)[:300]
    return rejected


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _files_under(folder: Path) -> set[Path]:
    return {item for item in folder.rglob("*") if item.is_file()}


class WorkerProcess:
    def __init__(self, data_dir: Path, log_path: Path):
        self._data_dir = data_dir
        self._log_path = log_path
        self._process: subprocess.Popen | None = None
        self._lines: queue.Queue = queue.Queue()

    def _start(self) -> None:
        environment = dict(os.environ)
        environment["VIVEPDF_DATA_DIR"] = str(self._data_dir)
        environment["PYTHONPATH"] = str(SIDECAR_ROOT)
        environment["PYTHONIOENCODING"] = "utf-8"
        self._data_dir.mkdir(parents=True, exist_ok=True)
        log = self._log_path.open("ab")
        self._process = subprocess.Popen(
            [sys.executable, str(WORKER_SCRIPT)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=log,
            cwd=str(SIDECAR_ROOT),
            env=environment,
        )
        log.close()
        self._lines = queue.Queue()
        threading.Thread(target=self._pump, args=(self._process, self._lines), daemon=True).start()
        ready = self._lines.get(timeout=120)
        if ready is None:
            raise RuntimeError("robustness worker failed to start")

    @staticmethod
    def _pump(process: subprocess.Popen, lines: queue.Queue) -> None:
        for line in process.stdout:
            lines.put(line)
        lines.put(None)

    def _kill(self) -> None:
        if self._process is not None:
            self._process.kill()
            self._process.wait()
            self._process = None

    def _send(self, payload: dict[str, Any]) -> bool:
        try:
            self._process.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
            self._process.stdin.flush()
        except OSError:
            return False
        return True

    def run(self, request: dict[str, Any], timeout: float) -> dict[str, Any]:
        if self._process is None or self._process.poll() is not None:
            self._start()
        if not self._send(request):
            self._kill()
            return {"status": "crash", "message": "worker pipe closed"}
        deadline = time.monotonic() + timeout
        cancel_sent = False
        progress_lines = 0
        while True:
            try:
                line = self._lines.get(timeout=max(0.01, deadline - time.monotonic()))
            except queue.Empty:
                if cancel_sent or not self._send({"cancel": True}):
                    self._kill()
                    return {
                        "status": "timeout",
                        "message": f"no answer within {timeout:.0f} s and cancel was ignored",
                        "progress": progress_lines,
                    }
                cancel_sent = True
                deadline = time.monotonic() + CANCEL_GRACE
                continue
            if line is None:
                code = self._process.wait()
                self._process = None
                return {"status": "crash", "message": f"worker exited with code {code}"}
            message = json.loads(line)
            if message.get("status") == "progress":
                progress_lines += 1
                continue
            message["slow"] = cancel_sent
            message["progress"] = progress_lines
            return message

    def close(self) -> None:
        if self._process is not None:
            try:
                self._process.stdin.close()
                self._process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                self._kill()
            self._process = None


def _stage_case(
    case: Case, fixtures: Fixtures, case_dir: Path
) -> tuple[dict[str, Any], list[Path]]:
    variant, source = fixtures.variants[case.variant]
    case_dir.mkdir(parents=True, exist_ok=True)
    hostile = case_dir / source.name
    shutil.copyfile(source, hostile)
    staged = [hostile]
    if case.slot == "primary":
        params = build_params(case.op, fixtures, case_dir, str(hostile), Path(source.name).stem)
    else:
        primary = case_dir / "primary.pdf"
        shutil.copyfile(fixtures.good_pdf, primary)
        staged.append(primary)
        params = build_params(case.op, fixtures, case_dir, str(primary), "primary")
        params.update(SECONDARY_SLOTS[case.op][case.slot](str(primary), str(hostile)))
    if case.with_password:
        password = next(
            (value for key, value in VARIANT_PASSWORDS.items() if key in case.variant), None
        )
        fields = _aliases(get_operation(case.op).params_model)
        if password and "password" in fields:
            params["password"] = password
    (case_dir / "out").mkdir(exist_ok=True)
    return params, staged


def known_slow_reason(case: Case) -> str | None:
    reasons = KNOWN_SLOW.get(case.variant, {})
    return reasons.get(case.op) or reasons.get(EVERY_OP)


def evaluate(
    case: Case,
    response: dict[str, Any],
    before: dict[Path, str],
    preexisting: set[Path],
    case_dir: Path,
    seconds: float,
) -> Outcome:
    status = response.get("status", "crash")
    outcome = Outcome(
        case=case,
        status=status,
        code=response.get("code"),
        message=response.get("message", ""),
        detail=response.get("traceback", ""),
        seconds=seconds,
        slow=bool(response.get("slow")),
    )
    if status == "exception":
        outcome.problems.append(f"unhandled {response.get('type')} leaked as INTERNAL")
    elif status == "timeout" and known_slow_reason(case):
        outcome.status = "known_slow"
    elif status in {"timeout", "crash"}:
        outcome.problems.append(status)
    elif status == "error":
        if outcome.code not in ALLOWED_CODES:
            outcome.problems.append(f"undocumented error code {outcome.code}")
        if "Traceback" in outcome.message:
            outcome.problems.append("traceback text in the error message")
        if response.get("validation"):
            outcome.problems.append("harness parameters rejected by the model")
        reason = (response.get("data") or {}).get("reason")
        if reason in DAMAGE_REASONS and (
            case.variant in PRISTINE_VARIANTS or case.variant.startswith("real_")
        ):
            outcome.problems.append(f"pristine document reported as damaged ({reason})")
    elif status != "ok":
        outcome.problems.append(f"unexpected worker status {status}")
    in_place_success = status == "ok" and case.op in IN_PLACE_OPS
    for path, digest in before.items():
        if not path.exists():
            outcome.problems.append(f"input removed: {path.name}")
        elif not in_place_success and _digest(path) != digest:
            outcome.problems.append(f"input modified: {path.name}")
    if status != "ok":
        leftovers = sorted(
            str(item.relative_to(case_dir)) for item in _files_under(case_dir) - preexisting
        )
        if leftovers:
            outcome.problems.append(f"files left behind on failure: {leftovers[:5]}")
    return outcome


def run_case(
    case: Case, fixtures: Fixtures, case_dir: Path, worker: WorkerProcess, timeout: float
) -> Outcome:
    try:
        params, staged = _stage_case(case, fixtures, case_dir)
    except OSError as error:
        return Outcome(case=case, status="setup_skipped", message=str(error))
    before = {path: _digest(path) for path in staged}
    preexisting = _files_under(case_dir)
    started = time.perf_counter()
    response = worker.run(
        {"op": case.op, "params": params},
        timeout * TIMEOUT_SCALE.get(case.variant, 1.0) * OPERATION_TIMEOUT_SCALE.get(case.op, 1.0),
    )
    seconds = time.perf_counter() - started
    outcome = evaluate(case, response, before, preexisting, case_dir, seconds)
    if not outcome.failed:
        shutil.rmtree(case_dir, ignore_errors=True)
    return outcome


def run_matrix(
    cases: Iterable[Case],
    fixtures: Fixtures,
    workers: int = 4,
    timeout: float = DEFAULT_TIMEOUT,
    on_outcome: Callable[[Outcome], None] | None = None,
) -> list[Outcome]:
    case_list = list(cases)
    local = threading.local()
    created: list[WorkerProcess] = []
    lock = threading.Lock()

    def execute(indexed: tuple[int, Case]) -> Outcome:
        index, case = indexed
        worker = getattr(local, "worker", None)
        if worker is None:
            with lock:
                number = len(created)
                worker = WorkerProcess(
                    fixtures.root / "appdata" / f"w{number}", fixtures.root / f"worker{number}.log"
                )
                created.append(worker)
            local.worker = worker
        outcome = run_case(
            case, fixtures, fixtures.root / "cases" / f"c{index:05d}", worker, timeout
        )
        if on_outcome is not None:
            on_outcome(outcome)
        return outcome

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(execute, enumerate(case_list)))
    finally:
        for worker in created:
            worker.close()


def full_cases(variant_names: list[str], variant_categories: dict[str, str]) -> list[Case]:
    operations = path_operations()
    sampled = [
        name for name in variant_names if variant_categories[name] in {"truncated", "flipped"}
    ]
    structural = [name for name in variant_names if name not in sampled]
    cases: list[Case] = []
    for index, op_name in enumerate(operations):
        chosen = list(structural)
        if op_name in HUB_OPS:
            chosen += sampled
        else:
            chosen += [sampled[(index * 7 + step * 11) % len(sampled)] for step in range(20)]
        for variant in dict.fromkeys(chosen):
            cases.append(Case(op_name, variant))
            if variant_categories[variant] == "encrypted" and any(
                key in variant for key in VARIANT_PASSWORDS
            ):
                cases.append(Case(op_name, variant, with_password=True))
    secondary_variants = [
        name
        for name in structural
        if variant_categories[name] in {"not_pdf", "encrypted", "structure", "names"}
    ] + sampled[::10]
    for op_name, slots in SECONDARY_SLOTS.items():
        if op_name not in operations:
            continue
        for slot in slots:
            for variant in secondary_variants:
                cases.append(Case(op_name, variant, slot=slot))
    return cases


SLOW_OPS = {
    "ocr.run",
    "ocr.searchable",
    "ocr.text",
    "convert.to_docx",
    "convert.to_pptx",
    "convert.to_xlsx",
    "convert.to_markdown",
    "convert.to_html",
    "convert.to_epub",
    "scan.enhance",
    "scan.split",
    "compare.run",
    "codes.read",
    "codes.add_qr",
    "pages.auto_rotate",
    "pages.detect_rotation",
    "security.flatten",
    "a11y.fix",
    "bookmarks.generate",
    "bookmarks.suggest",
    "security.detect_watermark",
    "security.remove_watermark",
    "forms.detect",
}
SLOW_OPS_PAGE_LIMIT = 30


def add_real_documents(fixtures: Fixtures, folder: Path) -> dict[str, int]:
    import pymupdf

    documents: dict[str, int] = {}
    for index, source in enumerate(sorted(folder.rglob("*.pdf"))):
        name = f"real_{index:04d}"
        try:
            with pymupdf.open(source) as document:
                pages = document.page_count
        except Exception:
            pages = 0
        variant = robustness_corpus.Variant(name, "real", source.name, source.read_bytes)
        fixtures.variants[name] = (variant, source)
        documents[name] = pages
    return documents


def real_cases(documents: dict[str, int]) -> list[Case]:
    cases = []
    for op_name in path_operations():
        for name, pages in documents.items():
            if op_name in SLOW_OPS and pages > SLOW_OPS_PAGE_LIMIT:
                continue
            cases.append(Case(op_name, name))
    return cases


def summarise(outcomes: list[Outcome]) -> str:
    failures = [outcome for outcome in outcomes if outcome.failed]
    skipped = [outcome for outcome in outcomes if outcome.status == "setup_skipped"]
    statuses: dict[str, int] = {}
    for outcome in outcomes:
        statuses[outcome.status] = statuses.get(outcome.status, 0) + 1
    slow = [outcome.case.label for outcome in outcomes if outcome.slow and not outcome.failed]
    lines = [
        f"cases={len(outcomes)} failures={len(failures)} skipped={len(skipped)} "
        f"slow_but_cancelled={len(slow)} statuses={statuses}"
    ]
    if slow:
        lines.append("slow but cancellable: " + ", ".join(slow[:40]))
    known = [outcome.case.label for outcome in outcomes if outcome.status == "known_slow"]
    if known:
        lines.append("known slow (not cancellable, see KNOWN_SLOW): " + ", ".join(known[:40]))
    lines.extend(outcome.describe() for outcome in failures)
    return "\n".join(lines)
