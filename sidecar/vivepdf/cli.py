import argparse
import io
import json
import multiprocessing
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from vivepdf.ops._watermark_style import WatermarkParams
from vivepdf.ops.compress import CompressParams
from vivepdf.ops.convert import PdfSourceParams
from vivepdf.ops.convert_images import ImagesParams
from vivepdf.ops.convert_to_pdf import FileToPdfParams
from vivepdf.ops.info import InfoGetParams
from vivepdf.ops.merge_split import MergeInput, MergeParams, SplitParams
from vivepdf.ops.ocr import OcrParams, OcrTextParams
from vivepdf.ops.pages import InsertBlankParams, PagesParams, RotateParams, SourceParams
from vivepdf.ops.security import DecryptParams, EncryptParams
from vivepdf.ops.sign import SignaturesPresentParams
from vivepdf.ops.watermark_removal import RemoveWatermarkParams
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.loader import load_operation
from vivepdf.rpc.progress import Progress

CONVERT_OPERATIONS: dict[str, str] = {
    "docx": "convert.to_docx",
    "xlsx": "convert.to_xlsx",
    "pptx": "convert.to_pptx",
    "png": "convert.to_images",
    "jpg": "convert.to_images",
    "txt": "convert.to_text",
    "md": "convert.to_markdown",
    "html": "convert.to_html",
    "pdf": "convert.file_to_pdf",
}


def _console_progress() -> Progress:
    def sink(value: float, message: str | None, _detail: dict[str, Any] | None) -> None:
        print(f"\r{int(value * 100):3d}% {message or ''}", end="", file=sys.stderr, flush=True)

    return Progress(sink, threading.Event())


def _run_op(name: str, params: BaseModel, json_mode: bool) -> None:
    operation = load_operation(name)
    if operation is None:
        raise SystemExit(f"unknown operation: {name}")
    progress = _console_progress()
    try:
        result = operation.handler(params, progress)
    except OpError as error:
        print(file=sys.stderr)
        print(json.dumps(error.to_payload(), ensure_ascii=False), file=sys.stdout)
        raise SystemExit(1) from None
    print(file=sys.stderr)
    payload = result.model_dump(by_alias=True, mode="json")
    print(json.dumps(payload, ensure_ascii=False))


def cmd_merge(args: argparse.Namespace) -> None:
    inputs = [MergeInput(path=path, password=args.password) for path in args.inputs]
    params = MergeParams(
        inputs=inputs, output=args.output, overwrite=args.overwrite, add_bookmarks=args.bookmarks
    )
    _run_op("pages.merge", params, args.json)


def cmd_split(args: argparse.Namespace) -> None:
    if args.every is not None:
        params = SplitParams(
            path=args.input,
            password=args.password,
            mode="every",
            every=args.every,
            output_dir=args.output,
            overwrite=args.overwrite,
        )
    else:
        params = SplitParams(
            path=args.input,
            password=args.password,
            mode="ranges",
            ranges=args.ranges,
            output_dir=args.output,
            overwrite=args.overwrite,
        )
    _run_op("pages.split", params, args.json)


def cmd_compress(args: argparse.Namespace) -> None:
    params = CompressParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        profile=args.profile,
    )
    _run_op("compress.run", params, args.json)


def cmd_ocr(args: argparse.Namespace) -> None:
    languages = args.lang.split("+") if args.lang else ["tur", "eng"]
    params = OcrParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        languages=languages,
    )
    _run_op("ocr.run", params, args.json)


def cmd_convert(args: argparse.Namespace) -> None:
    target = args.to
    if target == "pdf":
        params: BaseModel = FileToPdfParams(
            path=args.input, output=args.output, overwrite=args.overwrite
        )
    elif target in ("png", "jpg"):
        output_path = Path(args.output)
        params = ImagesParams(
            path=args.input,
            password=args.password,
            output_dir=str(output_path.parent),
            format=target,
            base_name=output_path.stem,
            overwrite=args.overwrite,
        )
    else:
        operation = load_operation(CONVERT_OPERATIONS[target])
        model = operation.params_model if operation is not None else PdfSourceParams
        params = model(
            path=args.input, password=args.password, output=args.output, overwrite=args.overwrite
        )
    _run_op(CONVERT_OPERATIONS[target], params, args.json)


def cmd_watermark(args: argparse.Namespace) -> None:
    params = WatermarkParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        text=args.text,
        opacity=args.opacity,
    )
    _run_op("security.watermark", params, args.json)


def cmd_remove_watermark(args: argparse.Namespace) -> None:
    params = RemoveWatermarkParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        text=args.text,
    )
    _run_op("security.remove_watermark", params, args.json)


def cmd_encrypt(args: argparse.Namespace) -> None:
    params = EncryptParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        user_password=args.user,
        owner_password=args.owner or "",
    )
    _run_op("security.encrypt", params, args.json)


def cmd_decrypt(args: argparse.Namespace) -> None:
    params = DecryptParams(
        path=args.input, password=args.password, output=args.output, overwrite=args.overwrite
    )
    _run_op("security.decrypt", params, args.json)


def cmd_info(args: argparse.Namespace) -> None:
    params = InfoGetParams(path=args.input, password=args.password)
    _run_op("info.get", params, args.json)


def page_numbers(spec: str) -> list[int]:
    numbers: list[int] = []
    for part in spec.split(","):
        piece = part.strip()
        if not piece:
            continue
        first, dash, last = piece.partition("-")
        try:
            start = int(first)
            end = int(last) if dash else start
        except ValueError:
            raise argparse.ArgumentTypeError(f"not a page list: {spec}") from None
        if start < 1 or end < start:
            raise argparse.ArgumentTypeError(f"not a page list: {spec}")
        numbers.extend(range(start, end + 1))
    if not numbers:
        raise argparse.ArgumentTypeError("no pages given")
    return list(dict.fromkeys(numbers))


def cmd_text(args: argparse.Namespace) -> None:
    languages = args.lang.split("+") if args.lang else ["tur", "eng"]
    params = OcrTextParams(
        path=args.input,
        password=args.password,
        languages=languages,
        dpi=args.dpi,
        pages=args.pages,
    )
    _run_op("ocr.text", params, args.json)


def cmd_sign_count(args: argparse.Namespace) -> None:
    params = SignaturesPresentParams(path=args.input, password=args.password)
    _run_op("sign.count", params, args.json)


def cmd_rotate(args: argparse.Namespace) -> None:
    params = RotateParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        pages=args.pages,
        degrees=args.degrees,
    )
    _run_op("pages.rotate", params, args.json)


def cmd_delete(args: argparse.Namespace) -> None:
    params = PagesParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        pages=args.pages,
    )
    _run_op("pages.delete", params, args.json)


def cmd_extract(args: argparse.Namespace) -> None:
    params = PagesParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        pages=args.pages,
    )
    _run_op("pages.extract", params, args.json)


def cmd_reverse(args: argparse.Namespace) -> None:
    params = SourceParams(
        path=args.input, password=args.password, output=args.output, overwrite=args.overwrite
    )
    _run_op("pages.reverse", params, args.json)


def cmd_insert_blank(args: argparse.Namespace) -> None:
    params = InsertBlankParams(
        path=args.input,
        password=args.password,
        output=args.output,
        overwrite=args.overwrite,
        at=args.at,
        count=args.count,
    )
    _run_op("pages.insert_blank", params, args.json)


def _pymupdf_version() -> str:
    import pymupdf

    return str(pymupdf.VersionBind)


def _pikepdf_version() -> str:
    import pikepdf

    buffer = io.BytesIO()
    with pikepdf.new() as document:
        document.add_blank_page()
        document.save(buffer, linearize=True)
    return f"{pikepdf.__version__} (qpdf {pikepdf.__libqpdf_version__})"


def _onnxruntime_version() -> str:
    import onnxruntime

    return str(onnxruntime.__version__)


def _pyhanko_version() -> str:
    from pyhanko.sign.signers import PdfSigner
    from pyhanko.version import __version__

    return f"{__version__} ({PdfSigner.__name__})"


SELFTEST_CHECKS: dict[str, Callable[[], str]] = {
    "pymupdf": _pymupdf_version,
    "pikepdf": _pikepdf_version,
    "onnxruntime": _onnxruntime_version,
    "pyhanko": _pyhanko_version,
}


def cmd_selftest(_args: argparse.Namespace) -> None:
    versions: dict[str, str] = {}
    failures: dict[str, str] = {}
    for name, check in SELFTEST_CHECKS.items():
        try:
            versions[name] = check()
        except Exception as error:
            failures[name] = f"{type(error).__name__}: {error}"
    print(json.dumps({"ok": not failures, "versions": versions, "failures": failures}))
    if failures:
        raise SystemExit(1)


def _build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--password", default=None)
    common.add_argument("--overwrite", action="store_true")
    common.add_argument("--json", action="store_true")

    parser = argparse.ArgumentParser(prog="vivepdf-cli", parents=[common])
    subparsers = parser.add_subparsers(dest="command", required=True)

    merge = subparsers.add_parser("merge", parents=[common])
    merge.add_argument("inputs", nargs="+")
    merge.add_argument("-o", "--output", required=True)
    merge.add_argument("--bookmarks", action="store_true")
    merge.set_defaults(func=cmd_merge)

    split = subparsers.add_parser("split", parents=[common])
    split.add_argument("input")
    split.add_argument("-o", "--output", required=True)
    split_mode = split.add_mutually_exclusive_group(required=True)
    split_mode.add_argument("--every", type=int)
    split_mode.add_argument("--ranges")
    split.set_defaults(func=cmd_split)

    compress = subparsers.add_parser("compress", parents=[common])
    compress.add_argument("input")
    compress.add_argument("-o", "--output", required=True)
    compress.add_argument(
        "--profile", choices=["light", "balanced", "strong", "extreme"], default="balanced"
    )
    compress.set_defaults(func=cmd_compress)

    ocr = subparsers.add_parser("ocr", parents=[common])
    ocr.add_argument("input")
    ocr.add_argument("-o", "--output", required=True)
    ocr.add_argument("--lang", default="tur+eng")
    ocr.set_defaults(func=cmd_ocr)

    convert = subparsers.add_parser("convert", parents=[common])
    convert.add_argument("input")
    convert.add_argument("-o", "--output", required=True)
    convert.add_argument("--to", required=True, choices=list(CONVERT_OPERATIONS))
    convert.set_defaults(func=cmd_convert)

    watermark = subparsers.add_parser("watermark", parents=[common])
    watermark.add_argument("input")
    watermark.add_argument("-o", "--output", required=True)
    watermark.add_argument("--text", required=True)
    watermark.add_argument("--opacity", type=float, default=0.3)
    watermark.set_defaults(func=cmd_watermark)

    remove_watermark = subparsers.add_parser("remove-watermark", parents=[common])
    remove_watermark.add_argument("input")
    remove_watermark.add_argument("-o", "--output", required=True)
    remove_watermark.add_argument("--text", default=None)
    remove_watermark.set_defaults(func=cmd_remove_watermark)

    encrypt = subparsers.add_parser("encrypt", parents=[common])
    encrypt.add_argument("input")
    encrypt.add_argument("-o", "--output", required=True)
    encrypt.add_argument("--user", required=True)
    encrypt.add_argument("--owner", default=None)
    encrypt.set_defaults(func=cmd_encrypt)

    decrypt = subparsers.add_parser("decrypt")
    decrypt.add_argument("input")
    decrypt.add_argument("-o", "--output", required=True)
    decrypt.add_argument("--password", required=True)
    decrypt.add_argument("--overwrite", action="store_true")
    decrypt.add_argument("--json", action="store_true")
    decrypt.set_defaults(func=cmd_decrypt)

    info = subparsers.add_parser("info", parents=[common])
    info.add_argument("input")
    info.set_defaults(func=cmd_info)

    text = subparsers.add_parser("text", parents=[common])
    text.add_argument("input")
    text.add_argument("--lang", default="tur+eng")
    text.add_argument("--dpi", type=int, default=200)
    text.add_argument("--pages", default=None)
    text.set_defaults(func=cmd_text)

    sign_count = subparsers.add_parser("sign-count", parents=[common])
    sign_count.add_argument("input")
    sign_count.set_defaults(func=cmd_sign_count)

    rotate = subparsers.add_parser("rotate", parents=[common])
    rotate.add_argument("input")
    rotate.add_argument("-o", "--output", required=True)
    rotate.add_argument("--degrees", type=int, choices=[90, 180, 270], required=True)
    rotate.add_argument("--pages", default=None)
    rotate.set_defaults(func=cmd_rotate)

    delete = subparsers.add_parser("delete", parents=[common])
    delete.add_argument("input")
    delete.add_argument("-o", "--output", required=True)
    delete.add_argument("--pages", type=page_numbers, required=True)
    delete.set_defaults(func=cmd_delete)

    extract = subparsers.add_parser("extract", parents=[common])
    extract.add_argument("input")
    extract.add_argument("-o", "--output", required=True)
    extract.add_argument("--pages", type=page_numbers, required=True)
    extract.set_defaults(func=cmd_extract)

    reverse = subparsers.add_parser("reverse", parents=[common])
    reverse.add_argument("input")
    reverse.add_argument("-o", "--output", required=True)
    reverse.set_defaults(func=cmd_reverse)

    insert_blank = subparsers.add_parser("insert-blank", parents=[common])
    insert_blank.add_argument("input")
    insert_blank.add_argument("-o", "--output", required=True)
    insert_blank.add_argument("--at", type=int, required=True)
    insert_blank.add_argument("--count", type=int, default=1)
    insert_blank.set_defaults(func=cmd_insert_blank)

    selftest = subparsers.add_parser("selftest")
    selftest.set_defaults(func=cmd_selftest)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except ValidationError as error:
        invalid = OpError(
            ErrorCode.INVALID_PARAMS, "invalid parameters", {"errors": json.loads(error.json())}
        )
        print(json.dumps(invalid.to_payload(), ensure_ascii=False))
        raise SystemExit(1) from None


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
