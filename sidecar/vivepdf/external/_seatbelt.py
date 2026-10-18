import os
from pathlib import Path

SANDBOX_EXEC = Path("/usr/bin/sandbox-exec")
SETUP_FAILED_EXITS = (65, 71)
SETUP_FAILED_MARKER = "sandbox-exec:"
USER_FONT_FOLDER = "/Library/Fonts"

BASE_PROFILE = (
    "(version 1)",
    "(allow default)",
    "(deny network-outbound (remote ip))",
    "(deny network-inbound (local ip))",
    "(deny network-bind (local ip))",
    "(deny appleevent-send)",
    '(deny file-read-data (subpath (param "HOME")))',
    f'(allow file-read-data (subpath (string-append (param "HOME") "{USER_FONT_FOLDER}")))',
    '(allow file-read-data (subpath (param "INSTALL")))',
    "(deny file-write*)",
    '(allow file-write* (subpath "/dev"))',
    '(allow file-write-data (literal "/private/tmp"))',
    '(allow file-write* (regex #"^/private/tmp/OSL_PIPE_[^/]*$"))',
)


def available() -> bool:
    return SANDBOX_EXEC.is_file()


def _real(path: Path) -> str:
    return os.path.realpath(path)


def _private_rules(index: int) -> tuple[str, str]:
    name = f"PRIVATE_{index}"
    return (
        f'(allow file-read-data (subpath (param "{name}")))',
        f'(allow file-write* (subpath (param "{name}")))',
    )


def office_profile(private_count: int) -> str:
    rules = [rule for index in range(private_count) for rule in _private_rules(index)]
    return "\n".join((*BASE_PROFILE, *rules)) + "\n"


def bundle_root(soffice: Path) -> Path:
    resolved = soffice.resolve()
    for parent in resolved.parents:
        if parent.suffix == ".app":
            return parent
    for parent in resolved.parents:
        if parent.name == "program":
            return parent.parent
    return resolved.parent


def contained_arguments(
    soffice: Path, private: list[Path], home: Path, arguments: list[str]
) -> list[str]:
    parameters = [
        f"HOME={_real(home)}",
        f"INSTALL={_real(bundle_root(soffice))}",
        *(f"PRIVATE_{index}={_real(folder)}" for index, folder in enumerate(private)),
    ]
    defined = [item for parameter in parameters for item in ("-D", parameter)]
    return [str(SANDBOX_EXEC), "-p", office_profile(len(private)), *defined, *arguments]


def setup_failed(exit_code: object, detail: str) -> bool:
    return exit_code in SETUP_FAILED_EXITS and SETUP_FAILED_MARKER in detail
