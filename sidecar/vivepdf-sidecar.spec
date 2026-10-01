import sys

from PyInstaller.utils.hooks import collect_all

sys.path.insert(0, SPECPATH)
from vivepdf.ops._catalog import MODULE_OPERATIONS  # noqa: E402

EXCLUDED_MODULES = [
    "cv2",
    "tkinter",
    "_tkinter",
    "pdf2docx.gui",
    "piper.train",
    "onnxruntime.datasets",
    "onnxruntime.quantization",
    "onnxruntime.tools",
    "onnxruntime.transformers",
    "ctranslate2.converters",
    "ctranslate2.specs",
    "pytest",
    "_pytest",
]
LAYOUT_MODEL_DIR = "pymupdf/layout/resources/onnx/"
KEPT_LAYOUT_MODELS = {
    "layout_rf2.4.1+imf1.onnx",
    "feature_imf1.onnx",
    "table_grid_model_v4_ep.onnx",
}
PRUNED_PREFIXES = (
    "cv2/",
    "pymupdf/mupdf-devel/",
    "piper/train/",
    "onnxruntime/datasets/",
    "onnxruntime/quantization/",
    "onnxruntime/tools/",
    "onnxruntime/transformers/",
    "ctranslate2/converters/",
    "ctranslate2/specs/",
)
PRUNED_FILES = {
    "onnxruntime/capi/onnxruntime.dll",
    "piper/hebrew/nakdimon.onnx",
    "piper/tashkeel/model.onnx",
}


def shipped(entry):
    destination = entry[0].replace("\\", "/")
    if destination in PRUNED_FILES or destination.startswith(PRUNED_PREFIXES):
        return False
    if destination.startswith(LAYOUT_MODEL_DIR) and destination.endswith(".onnx"):
        return destination[len(LAYOUT_MODEL_DIR) :] in KEPT_LAYOUT_MODELS
    return True


def pruned(entries):
    return [entry for entry in entries if shipped(entry)]


def wanted(name):
    return not any(name == module or name.startswith(module + ".") for module in EXCLUDED_MODULES)


datas, binaries, hiddenimports = collect_all("pymupdf")
for package in ("piper", "onnxruntime", "pikepdf", "pi_heif", "ctranslate2", "sentencepiece"):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports
datas += [("vivepdf/assets", "vivepdf/assets")]
hiddenimports = [name for name in hiddenimports if wanted(name)]

analysis = Analysis(
    ["vivepdf/__main__.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports + [f"vivepdf.ops.{module}" for module in MODULE_OPERATIONS],
    excludes=EXCLUDED_MODULES,
    noarchive=False,
)
analysis.binaries = pruned(analysis.binaries)
analysis.datas = pruned(analysis.datas)
pyz = PYZ(analysis.pure)
exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="vivepdf-sidecar",
    console=True,
    upx=False,
    strip=False,
)

cli_analysis = Analysis(
    ["vivepdf/cli_launcher.py"],
    pathex=["."],
    excludes=EXCLUDED_MODULES,
    noarchive=False,
)
cli_pyz = PYZ(cli_analysis.pure)
cli_exe = EXE(
    cli_pyz,
    cli_analysis.scripts,
    [],
    exclude_binaries=True,
    name="vivepdf-cli",
    console=True,
    upx=False,
    strip=False,
)

engine = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    cli_exe,
    cli_analysis.binaries,
    cli_analysis.datas,
    name="vivepdf-engine",
    upx=False,
    strip=False,
)
