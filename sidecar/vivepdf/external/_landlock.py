import ctypes
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

from vivepdf.external._process import system_environment

CONTAIN_FLAG = "--contain"
SYS_CREATE_RULESET = 444
SYS_ADD_RULE = 445
SYS_RESTRICT_SELF = 446
CREATE_RULESET_VERSION = 1
RULE_PATH_BENEATH = 1
PR_SET_NO_NEW_PRIVS = 38

EXECUTE = 1 << 0
WRITE_FILE = 1 << 1
READ_FILE = 1 << 2
READ_DIR = 1 << 3
REMOVE_DIR = 1 << 4
REMOVE_FILE = 1 << 5
MAKE_CHAR = 1 << 6
MAKE_DIR = 1 << 7
MAKE_REG = 1 << 8
MAKE_SOCK = 1 << 9
MAKE_FIFO = 1 << 10
MAKE_BLOCK = 1 << 11
MAKE_SYM = 1 << 12
REFER = 1 << 13
TRUNCATE = 1 << 14
IOCTL_DEV = 1 << 15
NET_BIND_TCP = 1 << 0
NET_CONNECT_TCP = 1 << 1
SCOPE_ABSTRACT_UNIX_SOCKET = 1 << 0
SCOPE_SIGNAL = 1 << 1

FILE_ACCESS = EXECUTE | WRITE_FILE | READ_FILE | TRUNCATE | IOCTL_DEV
READ_ACCESS = EXECUTE | READ_FILE | READ_DIR
SOCKET_ACCESS = MAKE_SOCK | REMOVE_FILE

SYSTEM_READ = (
    "/usr",
    "/lib",
    "/lib32",
    "/lib64",
    "/bin",
    "/sbin",
    "/etc",
    "/opt",
    "/proc",
    "/sys",
    "/dev",
    "/var/cache/fontconfig",
    "/var/lib/fontconfig",
)
SYSTEM_WRITE = ("/dev/null", "/dev/zero", "/dev/shm")
USER_FONT_FOLDERS = (".local/share/fonts", ".fonts", ".config/fontconfig", ".cache/fontconfig")


class RulesetAttributes(ctypes.Structure):
    _fields_ = (
        ("handled_access_fs", ctypes.c_uint64),
        ("handled_access_net", ctypes.c_uint64),
        ("scoped", ctypes.c_uint64),
    )


class PathBeneath(ctypes.Structure):
    _pack_ = 1
    _fields_ = (("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32))


@dataclass(frozen=True)
class Containment:
    read: list[str] = field(default_factory=list)
    write: list[str] = field(default_factory=list)
    sockets: list[str] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, text: str) -> "Containment":
        data = json.loads(text)
        return cls(
            read=[str(item) for item in data.get("read", [])],
            write=[str(item) for item in data.get("write", [])],
            sockets=[str(item) for item in data.get("sockets", [])],
        )


def _libc() -> ctypes.CDLL:
    return ctypes.CDLL(None, use_errno=True)


def abi_version() -> int:
    if not sys.platform.startswith("linux"):
        return 0
    try:
        version = _libc().syscall(
            SYS_CREATE_RULESET, None, ctypes.c_size_t(0), CREATE_RULESET_VERSION
        )
    except (OSError, AttributeError, TypeError):
        return 0
    return max(0, int(version))


def handled_file_access(abi: int) -> int:
    handled = (1 << 13) - 1
    if abi >= 2:
        handled |= REFER
    if abi >= 3:
        handled |= TRUNCATE
    if abi >= 5:
        handled |= IOCTL_DEV
    return handled


def ruleset_attributes(abi: int) -> tuple[RulesetAttributes, int]:
    attributes = RulesetAttributes(handled_access_fs=handled_file_access(abi))
    size = RulesetAttributes.handled_access_net.offset
    if abi >= 4:
        attributes.handled_access_net = NET_BIND_TCP | NET_CONNECT_TCP
        size = RulesetAttributes.scoped.offset
    if abi >= 6:
        attributes.scoped = SCOPE_ABSTRACT_UNIX_SOCKET | SCOPE_SIGNAL
        size = ctypes.sizeof(RulesetAttributes)
    return attributes, size


def office_containment(install_root: Path, private: list[Path], home: Path) -> Containment:
    read = [*SYSTEM_READ, str(install_root)]
    read.extend(str(home / folder) for folder in USER_FONT_FOLDERS)
    write = [*SYSTEM_WRITE, *(str(folder) for folder in private)]
    return Containment(read=read, write=write, sockets=["/tmp"])


def _failed(what: str) -> OSError:
    number = ctypes.get_errno()
    return OSError(number, f"{what}: {os.strerror(number)}")


def _allow(libc: ctypes.CDLL, ruleset: int, path: str, access: int, handled: int) -> None:
    try:
        descriptor = os.open(path, os.O_PATH | os.O_CLOEXEC)
    except OSError:
        return
    try:
        allowed = access & handled
        if not os.path.isdir(path):
            allowed &= FILE_ACCESS
        if not allowed:
            return
        rule = PathBeneath(allowed_access=allowed, parent_fd=descriptor)
        if libc.syscall(SYS_ADD_RULE, ruleset, RULE_PATH_BENEATH, ctypes.byref(rule), 0) != 0:
            raise _failed(f"landlock_add_rule {path}")
    finally:
        os.close(descriptor)


def restrict(containment: Containment) -> int:
    abi = abi_version()
    if abi < 1:
        raise OSError("Landlock is not available")
    libc = _libc()
    attributes, size = ruleset_attributes(abi)
    handled = attributes.handled_access_fs
    ruleset = libc.syscall(SYS_CREATE_RULESET, ctypes.byref(attributes), ctypes.c_size_t(size), 0)
    if ruleset < 0:
        raise _failed("landlock_create_ruleset")
    try:
        for path in containment.read:
            _allow(libc, ruleset, path, READ_ACCESS | IOCTL_DEV, handled)
        for path in containment.write:
            _allow(libc, ruleset, path, handled, handled)
        for path in containment.sockets:
            _allow(libc, ruleset, path, READ_ACCESS | SOCKET_ACCESS, handled)
        if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
            raise _failed("prctl no_new_privs")
        if libc.syscall(SYS_RESTRICT_SELF, ruleset, 0) != 0:
            raise _failed("landlock_restrict_self")
    finally:
        os.close(ruleset)
    return abi


def launcher_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, CONTAIN_FLAG]
    return [sys.executable, "-m", "vivepdf", CONTAIN_FLAG]


def contained_arguments(containment: Containment, arguments: list[str]) -> list[str]:
    return [*launcher_command(), containment.to_json(), "--", *arguments]


def contain_main(arguments: list[str]) -> None:
    if len(arguments) < 3 or arguments[1] != "--":
        print("usage: --contain <containment> -- <program> [arguments]", file=sys.stderr)
        raise SystemExit(2)
    containment = Containment.from_json(arguments[0])
    command = arguments[2:]
    try:
        restrict(containment)
    except OSError as error:
        print(f"[contain] {error}", file=sys.stderr)
        raise SystemExit(126) from error
    os.execve(command[0], command, system_environment())
