import ast
import importlib
import json
import pkgutil
import subprocess
import sys
from pathlib import Path

import pytest

import vivepdf
import vivepdf.ops
from vivepdf.ops._catalog import MODULE_OPERATIONS, OPERATION_MODULES
from vivepdf.rpc import loader
from vivepdf.rpc.registry import _OPERATIONS, get_operation

PACKAGE_ROOT = Path(vivepdf.__file__).resolve().parent
HEAVY_MODULES = ("numpy", "pikepdf", "pi_heif", "PIL", "lxml", "fontTools", "zxingcpp")


def _run_python(code: str) -> str:
    completed = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True, timeout=120
    )
    return completed.stdout


def _module_name(path: Path) -> str:
    parts = path.relative_to(PACKAGE_ROOT.parent).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def _top_level_imports(path: Path, known: set[str]) -> set[str]:
    found: set[str] = set()
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Import):
            targets = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            targets = [node.module] + [f"{node.module}.{alias.name}" for alias in node.names]
        else:
            continue
        for target in targets:
            while target and target not in known:
                target = target.rpartition(".")[0]
            if target:
                found.add(target)
    return found


def test_the_catalogue_names_every_registered_operation_and_its_module():
    for module in pkgutil.iter_modules(vivepdf.ops.__path__):
        if not module.name.startswith("_"):
            importlib.import_module(f"vivepdf.ops.{module.name}")

    registered = {
        name: operation.handler.__module__.removeprefix("vivepdf.ops.")
        for name, operation in _OPERATIONS.items()
    }

    assert registered == OPERATION_MODULES
    assert all(names for names in MODULE_OPERATIONS.values())


def test_package_modules_have_no_import_cycle_at_module_level():
    paths = {_module_name(path): path for path in PACKAGE_ROOT.rglob("*.py")}
    graph = {name: _top_level_imports(path, set(paths)) - {name} for name, path in paths.items()}
    visiting: set[str] = set()
    done: set[str] = set()
    cycles: list[list[str]] = []

    def visit(name: str, trail: list[str]) -> None:
        if name in done:
            return
        if name in visiting:
            cycles.append(trail[trail.index(name) :] + [name])
            return
        visiting.add(name)
        for target in sorted(graph.get(name, ())):
            visit(target, trail + [name])
        visiting.discard(name)
        done.add(name)

    for name in sorted(graph):
        visit(name, [])

    assert cycles == []


def test_starting_the_server_loads_no_operation_module_or_heavy_library():
    loaded = json.loads(
        _run_python(
            "import json, sys\n"
            "import vivepdf.rpc.server\n"
            "print(json.dumps(sorted(m for m in sys.modules if m.startswith('vivepdf.ops.')"
            f" and m.split('.')[2] in {sorted(MODULE_OPERATIONS)!r}"
            f" or m in {list(HEAVY_MODULES)!r})))\n"
        )
    )

    assert loaded == []


def test_loading_one_operation_imports_only_what_its_module_needs():
    loaded = json.loads(
        _run_python(
            "import json, sys\n"
            "from vivepdf.rpc.loader import load_operation\n"
            "operation = load_operation('system.ping')\n"
            "print(json.dumps([operation.name, 'vivepdf.ops.translate' in sys.modules]))\n"
        )
    )

    assert loaded == ["system.ping", False]


def test_an_unknown_operation_is_none_after_every_module_was_tried():
    assert loader.load_operation("nothing.here") is None
    assert get_operation("pages.rotate") is not None


def test_warm_up_keeps_loading_after_a_module_fails(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(
        loader, "MODULE_OPERATIONS", {"_missing_for_test": ("x.y",), "rotate": ("pages.rotate",)}
    )

    loader.start_warm_up().join(timeout=60)

    assert get_operation("pages.rotate") is not None
    assert "vivepdf.ops._missing_for_test failed to load" in capsys.readouterr().err
