import argparse
import base64
import contextlib
import functools
import http.server
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pymupdf
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "sidecar" / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
TURKISH_LINE = "Çağdaş Türkçe öğretim şöyle ilerler"
LONG_DOCUMENT_PAGES = 24
OP_TIMEOUT_SECONDS = 600


class EngineError(RuntimeError):
    pass


class Engine:
    def __init__(self, executable: Path):
        started = time.perf_counter()
        creation = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        self.process = subprocess.Popen(
            [str(executable)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creation,
        )
        self.stderr: list[bytes] = []
        self.noise: list[str] = []
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        self.counter = 0
        self.call("system.ping", {})
        self.cold_start = time.perf_counter() - started

    def _drain_stderr(self) -> None:
        for line in self.process.stderr:
            self.stderr.append(line)

    def call(self, method: str, params: dict[str, Any]) -> tuple[dict[str, Any], int]:
        self.counter += 1
        request_id = f"smoke-{self.counter}"
        line = json.dumps({"id": request_id, "method": method, "params": params})
        self.process.stdin.write(line.encode("utf-8") + b"\n")
        self.process.stdin.flush()
        progress_lines = 0
        deadline = time.monotonic() + OP_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            raw = self.process.stdout.readline()
            if not raw:
                tail = b"".join(self.stderr[-20:]).decode("utf-8", "replace")
                raise EngineError(f"engine exited during {method}: {tail}")
            try:
                message = json.loads(raw)
            except ValueError:
                self.noise.append(raw.decode("utf-8", "replace").strip())
                continue
            if message.get("id") != request_id:
                continue
            if "progress" in message:
                progress_lines += 1
                continue
            if "error" in message:
                raise EngineError(f"{method}: {message['error']}")
            return message["result"], progress_lines
        raise EngineError(f"{method} timed out")

    def close(self) -> float:
        started = time.perf_counter()
        with contextlib.suppress(OSError):
            self.process.stdin.close()
        self.process.wait(timeout=120)
        return time.perf_counter() - started


def _font() -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), 34)


def text_document(path: Path, pages: int) -> Path:
    document = pymupdf.open()
    for number in range(pages):
        page = document.new_page(width=595, height=842)
        page.insert_text(
            (72, 90), f"Bölüm {number + 1}: {TURKISH_LINE}", fontname="dejavu", fontfile=str(FONT)
        )
        for x in (72, 222, 372, 522):
            page.draw_line((x, 160), (x, 280))
        for y in (160, 200, 240, 280):
            page.draw_line((72, y), (522, y))
        for row, label in enumerate(("Ürün", "Kalem", "Defter")):
            page.insert_text((80, 185 + row * 40), label, fontname="dejavu", fontfile=str(FONT))
            page.insert_text(
                (230, 185 + row * 40), str(row * 7 + number), fontname="dejavu", fontfile=str(FONT)
            )
        page.draw_circle((300, 420), 50, color=(0, 0, 1), fill=(0.85, 0.9, 1))
        page.draw_line((80, 520), (500, 600), color=(1, 0, 0), width=2)
        page.insert_text((72, 700), "Ad Soyad: ____________________", fontsize=12)
    document.set_metadata({"title": "Duman testi", "author": "vivePDF"})
    document.save(path)
    document.close()
    return path


def scanned_document(path: Path) -> Path:
    image = Image.new("RGB", (1654, 2339), "white")
    draw = ImageDraw.Draw(image)
    for row, text in enumerate((TURKISH_LINE, "Güneşli bir günde çocuklar", "ığüşöç İĞÜŞÖÇ")):
        draw.text((150, 250 + row * 90), text, fill="black", font=_font())
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=85)
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=buffer.getvalue())
    document.save(path)
    document.close()
    return path


def picture_files(folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    picture = Image.new("RGB", (320, 200), (200, 60, 40))
    ImageDraw.Draw(picture).ellipse((40, 30, 280, 170), fill=(20, 90, 200))
    names = []
    for extension in ("png", "jpg", "webp", "avif"):
        target = folder / f"resim ş {extension}.{extension}"
        picture.save(target)
        names.append(str(target))
    return names


def web_folder(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (120, 80), (30, 160, 90)).save(folder / "logo.png")
    (folder / "index.html").write_text(
        "<!doctype html><html><head><meta charset='utf-8'><title>Yerel sayfa</title></head>"
        f"<body><article><h1>Yerel sayfa</h1><p>{TURKISH_LINE}. "
        * 8
        + "</p><img src='logo.png' alt='logo'></article></body></html>",
        encoding="utf-8",
    )
    return folder


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:
        return


def serve(folder: Path) -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools.partial(QuietHandler, directory=str(folder))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/index.html"


def pdf_text(path: str) -> str:
    with pymupdf.open(path) as document:
        return "".join(page.get_text() for page in document)


def docx_text(path: str) -> str:
    with zipfile.ZipFile(path) as archive:
        return archive.read("word/document.xml").decode("utf-8")


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise EngineError(message)


class Smoke:
    def __init__(self, engine: Engine, work: Path):
        self.engine = engine
        self.work = work
        self.rows: list[tuple[str, str, float, str]] = []

    def out(self, name: str) -> str:
        return str(self.work / "out" / name)

    def step(self, name: str, action: Callable[[], str]) -> None:
        started = time.perf_counter()
        try:
            detail = action()
            status = "ok"
        except Exception as error:
            detail = str(error)[:300]
            status = "FAIL"
        self.rows.append((name, status, time.perf_counter() - started, detail))
        print(f"{status:4} {time.perf_counter() - started:7.2f}s  {name}  {detail}", flush=True)

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        return self.engine.call(method, params)[0]

    def run(self, documents: list[Path]) -> None:
        inputs = self.work / "in"
        inputs.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(self.work / "out", ignore_errors=True)
        (self.work / "out").mkdir(parents=True)
        short = text_document(inputs / "kısa belge.pdf", 3)
        long = text_document(inputs / "uzun belge.pdf", LONG_DOCUMENT_PAGES)
        scan = scanned_document(inputs / "tarama ş.pdf")
        pictures = picture_files(inputs / "resimler")
        server, url = serve(web_folder(inputs / "web"))
        try:
            self._core(short, long, scan, pictures, url)
            self._security(short)
            self._speech()
            self._translation()
            for document in documents:
                self._real_document(document)
        finally:
            server.shutdown()

    def _core(self, short: Path, long: Path, scan: Path, pictures: list[str], url: str) -> None:
        def info() -> str:
            result = self.call("info.get", {"path": str(long)})
            expect(result["pageCount"] == LONG_DOCUMENT_PAGES, f"page count {result['pageCount']}")
            return f"{result['pageCount']} pages"

        def compress() -> str:
            result = self.call("compress.run", {"path": str(long), "output": self.out("c.pdf")})
            return f"{os.path.getsize(result['output'])} bytes"

        def ocr() -> str:
            result = self.call(
                "ocr.run", {"path": str(scan), "output": self.out("ocr.pdf"), "languages": ["tur"]}
            )
            text = pdf_text(result["output"])
            expect("Türkçe" in text or "Güneşli" in text, f"ocr text: {text[:80]!r}")
            return text.split("\n")[0][:40]

        def docx() -> str:
            result, progress = self.engine.call(
                "convert.to_docx", {"path": str(long), "output": self.out("uzun.docx")}
            )
            body = docx_text(result["output"])
            expect("Bölüm 1:" in body and f"Bölüm {LONG_DOCUMENT_PAGES}:" in body, "docx text")
            return f"{progress} progress lines"

        def docx_short() -> str:
            params = {"path": str(short), "output": self.out("k.docx")}
            result = self.call("convert.to_docx", params)
            expect("Bölüm 3:" in docx_text(result["output"]), "short docx text")
            return "sequential"

        def xlsx() -> str:
            params = {"path": str(short), "output": self.out("t.xlsx")}
            result = self.call("convert.to_xlsx", params)
            expect(result["tableCount"] >= 1, "no tables")
            return f"{result['tableCount']} tables"

        def pptx() -> str:
            params = {"path": str(short), "output": self.out("s.pptx")}
            result = self.call("convert.to_pptx", params)
            return f"{os.path.getsize(result['output'])} bytes"

        def images() -> str:
            self.call("convert.to_images", {"path": str(short), "outputDir": self.out("png")})
            return f"{len(os.listdir(self.out('png')))} files"

        def markdown() -> str:
            result = self.call(
                "convert.to_markdown", {"path": str(short), "output": self.out("m.md")}
            )
            text = Path(result["output"]).read_text(encoding="utf-8")
            expect("Bölüm 1" in text, "markdown text")
            return f"{len(text)} chars"

        def epub() -> str:
            params = {"path": str(short), "output": self.out("e.epub")}
            result = self.call("convert.to_epub", params)
            return f"{os.path.getsize(result['output'])} bytes"

        def images_to_pdf() -> str:
            result = self.call(
                "convert.images_to_pdf", {"images": pictures, "output": self.out("resimler.pdf")}
            )
            with pymupdf.open(result["output"]) as document:
                expect(document.page_count == len(pictures), f"{document.page_count} pages")
            return f"{len(pictures)} pictures incl. webp/avif"

        def forms() -> str:
            detected = self.call("forms.detect", {"path": str(short), "output": self.out("f.pdf")})
            fields = self.call("forms.fields", {"path": detected["output"]})["fields"]
            expect(bool(fields), "no fields detected")
            values = {fields[0]["name"]: "Ayşe Öztürk"}
            filled = self.call(
                "forms.fill",
                {"path": detected["output"], "output": self.out("ff.pdf"), "values": values},
            )
            again = self.call("forms.fields", {"path": filled["output"]})["fields"]
            expect(any(field["value"] == "Ayşe Öztürk" for field in again), "value not kept")
            return f"{len(fields)} fields"

        def codes() -> str:
            added = self.call(
                "codes.add_qr",
                {"path": str(short), "output": self.out("qr.pdf"), "text": "vivePDF ğüşiöç"},
            )
            found = self.call("codes.read", {"path": added["output"]})["codes"]
            expect(any(code["text"] == "vivePDF ğüşiöç" for code in found), f"codes {found}")
            return f"{len(found)} codes"

        def enhance() -> str:
            result = self.call(
                "scan.enhance",
                {"path": str(scan), "output": self.out("enh.pdf"), "languages": ["tur"]},
            )
            return f"{os.path.getsize(result['output'])} bytes"

        def web() -> str:
            result = self.call("convert.from_url", {"url": url, "output": self.out("web.pdf")})
            expect("Yerel sayfa" in pdf_text(result["output"]), "web text")
            return "local page"

        def merge() -> str:
            result = self.call(
                "pages.merge",
                {
                    "inputs": [{"path": str(short)}, {"path": str(scan)}],
                    "output": self.out("merge.pdf"),
                },
            )
            with pymupdf.open(result["output"]) as document:
                expect(document.page_count == 4, "merged page count")
            return "4 pages"

        for name, action in (
            ("info.get", info),
            ("compress.run", compress),
            ("ocr.run tur", ocr),
            (f"convert.to_docx {LONG_DOCUMENT_PAGES} pages", docx),
            ("convert.to_docx 3 pages", docx_short),
            ("convert.to_xlsx", xlsx),
            ("convert.to_pptx", pptx),
            ("convert.to_images", images),
            ("convert.to_markdown", markdown),
            ("convert.to_epub", epub),
            ("convert.images_to_pdf", images_to_pdf),
            ("forms detect/fill", forms),
            ("codes add/read", codes),
            ("scan.enhance", enhance),
            ("convert.from_url", web),
            ("pages.merge", merge),
        ):
            self.step(name, action)

    def _security(self, short: Path) -> None:
        def sign() -> str:
            certificate = self.call(
                "sign.create_certificate",
                {
                    "output": self.out("kimlik.p12"),
                    "password": "Duman-123",
                    "commonName": "Duman Testi",
                },
            )
            signed = self.call(
                "sign.run",
                {
                    "path": str(short),
                    "output": self.out("imzali.pdf"),
                    "certificatePath": certificate["output"],
                    "certificatePassword": "Duman-123",
                },
            )
            signatures = self.call("sign.verify", {"path": signed["output"]})["signatures"]
            expect(len(signatures) == 1 and signatures[0]["intact"], f"verify {signatures}")
            return signatures[0]["summary"][:60]

        self.step("sign create/run/verify", sign)

    def _speech(self) -> None:
        voices = [voice for voice in self.call("tts.voices", {})["voices"] if voice["installed"]]
        if not voices:
            self.rows.append(("tts.synthesize", "skip", 0.0, "no installed voice"))
            print("skip tts.synthesize (no installed voice)")
            return
        voice = next((item for item in voices if item["language"] == "tr"), voices[0])

        def synthesize() -> str:
            result = self.call(
                "tts.synthesize", {"voiceId": voice["id"], "text": "Merhaba, bu bir duman testi."}
            )
            audio = base64.b64decode(result["wavBase64"])
            expect(audio[:4] == b"RIFF" and len(audio) > 10000, "no audio")
            return f"{voice['id']} {result['durationMs']} ms"

        self.step("tts.synthesize", synthesize)

    def _translation(self) -> None:
        models = self.call("translate.models", {})["models"]
        installed = {model["id"] for model in models if model["installed"]}
        pair = next(
            ((a, b) for a, b in (("en", "tr"), ("tr", "en")) if f"{a}_{b}" in installed),
            None,
        )
        if pair is None:
            self.rows.append(
                ("translate.text", "skip", 0.0, f"{len(models)} models, none installed")
            )
            print("skip translate.text (no installed model)")
            return
        source, target = pair
        sample = {"en": "This is a smoke test.", "tr": "Bu bir duman testi."}[source]

        def translate() -> str:
            result = self.call(
                "translate.text", {"text": sample, "source": source, "target": target}
            )
            expect(bool(result["text"].strip()) and result["text"] != sample, "no translation")
            return result["text"][:60]

        self.step("translate.text", translate)

    def _real_document(self, document: Path) -> None:
        def info() -> str:
            return f"{self.call('info.get', {'path': str(document)})['pageCount']} pages"

        def docx() -> str:
            result, progress = self.engine.call(
                "convert.to_docx",
                {"path": str(document), "output": self.out(document.stem + ".docx")},
            )
            return f"{progress} progress lines"

        self.step(f"info.get {document.name}", info)
        self.step(f"convert.to_docx {document.name}", docx)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("engine", type=Path)
    parser.add_argument("--document", type=Path, action="append", default=[])
    parser.add_argument("--work", type=Path)
    arguments = parser.parse_args()
    suffix = ".exe" if sys.platform == "win32" else ""
    executable = arguments.engine / f"vivepdf-sidecar{suffix}"
    with tempfile.TemporaryDirectory(prefix="vivepdf-smoke-") as temporary:
        work = arguments.work or Path(temporary)
        engine = Engine(executable)
        print(f"cold start (spawn to first ping answer): {engine.cold_start:.2f}s", flush=True)
        smoke = Smoke(engine, work)
        try:
            smoke.run(arguments.document)
        finally:
            print(f"engine exit after stdin closed: {engine.close():.2f}s")
            for line in engine.noise:
                print(f"non-protocol stdout line: {line[:200]}")
    failed = [row for row in smoke.rows if row[1] == "FAIL"]
    print(f"{len(smoke.rows) - len(failed)} of {len(smoke.rows)} engine smoke steps passed")
    if failed or engine.noise:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
