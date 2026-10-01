from pathlib import Path

from vivepdf.external import verapdf
from vivepdf.ops._pdfa_levels import DEFAULT_LEVEL, Level
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

_versions: dict[tuple[str, float], str | None] = {}


class PdfaValidatorParams(RpcModel):
    pass


class PdfaValidatorResult(RpcModel):
    available: bool
    version: str | None = None


class PdfaValidateParams(RpcModel):
    path: str
    level: Level = DEFAULT_LEVEL


class PdfaRule(RpcModel):
    specification: str
    clause: str
    test_number: str
    description: str
    failed_checks: int


class PdfaValidateResult(RpcModel):
    level: Level
    compliant: bool
    version: str | None
    failed_rules: int
    failed_checks: int
    rules: list[PdfaRule]
    truncated: bool


def _require_launcher() -> Path:
    launcher = verapdf.find_verapdf()
    if launcher is None:
        raise OpError(
            ErrorCode.UNSUPPORTED, "veraPDF is not installed", {"reason": "veraPdfMissing"}
        )
    return launcher


def _version(launcher: Path) -> str | None:
    key = (str(launcher), launcher.stat().st_mtime)
    if key not in _versions:
        _versions[key] = verapdf.version(launcher)
    return _versions[key]


@op("pdfa.validator", PdfaValidatorParams)
def validator(_params: PdfaValidatorParams, _progress: Progress) -> PdfaValidatorResult:
    launcher = verapdf.find_verapdf()
    if launcher is None:
        return PdfaValidatorResult(available=False)
    try:
        return PdfaValidatorResult(available=True, version=_version(launcher))
    except OpError:
        return PdfaValidatorResult(available=False)


@op("pdfa.validate", PdfaValidateParams)
def validate(params: PdfaValidateParams, progress: Progress) -> PdfaValidateResult:
    source = Path(params.path)
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}")
    launcher = _require_launcher()
    progress.report(0.1, "progress.validating")
    report = verapdf.validate(launcher, source, params.level, progress.check_cancelled)
    rules = [
        PdfaRule(
            specification=rule.specification,
            clause=rule.clause,
            test_number=rule.test_number,
            description=rule.description,
            failed_checks=rule.failed_checks,
        )
        for rule in report.rules[: verapdf.MAX_RULES]
    ]
    return PdfaValidateResult(
        level=params.level,
        compliant=report.compliant,
        version=_versions.get((str(launcher), launcher.stat().st_mtime)),
        failed_rules=report.failed_rules,
        failed_checks=report.failed_checks,
        rules=rules,
        truncated=len(report.rules) > verapdf.MAX_RULES,
    )
