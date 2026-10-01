import json
import subprocess
import sys

from vivepdf.rpc.registry import operation_names
from vivepdf.rpc.schema import operation_schemas


def test_every_registered_operation_exports_params_and_result_by_alias():
    schemas = operation_schemas()
    assert set(schemas) == set(operation_names())
    missing_results = [name for name, entry in schemas.items() if entry["result"] is None]
    assert missing_results == []
    split = schemas["pages.split"]["params"]
    assert "outputDir" in split["properties"]
    assert "output_dir" not in split["properties"]
    assert "path" in split["required"]


def test_nested_models_are_exported_as_definitions():
    redact = schemas_for("security.redact")
    assert redact["$defs"]
    assert "searchText" in redact["properties"]


def test_module_prints_json_for_the_type_checker():
    completed = subprocess.run(
        [sys.executable, "-m", "vivepdf.rpc.schema"],
        capture_output=True,
        check=True,
    )
    payload = json.loads(completed.stdout.decode("utf-8"))
    assert "pages.merge" in payload
    assert payload["pages.merge"]["result"]["properties"]


def schemas_for(name: str) -> dict:
    return operation_schemas()[name]["params"]
