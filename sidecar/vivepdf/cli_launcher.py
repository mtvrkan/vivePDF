import os
import subprocess
import sys
from pathlib import Path

ENGINE_NAME = "vivepdf-sidecar"
CLI_FLAG = "--cli"


def engine_path(launcher: str) -> Path:
    suffix = ".exe" if sys.platform == "win32" else ""
    return Path(launcher).resolve().with_name(ENGINE_NAME + suffix)


def engine_command(launcher: str, arguments: list[str]) -> list[str]:
    return [str(engine_path(launcher)), CLI_FLAG, *arguments]


def main() -> None:
    command = engine_command(sys.executable, sys.argv[1:])
    if sys.platform == "win32":
        raise SystemExit(subprocess.call(command))
    os.execv(command[0], command)


if __name__ == "__main__":
    main()
