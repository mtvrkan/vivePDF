from pathlib import Path

from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._naming import sanitize_file_name
from vivepdf.ops._page_image_files import refuse_existing
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.rpc.paths import ReadPath, WriteDir
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class SvgParams(RpcModel):
    path: ReadPath
    password: str | None = None
    output_dir: WriteDir
    pages: str | None = None
    base_name: str | None = None
    overwrite: bool = False
    text_as_text: bool = False


class SvgResult(RpcModel):
    outputs: list[str]
    bytes: int
    page_count: int = Field(default=0)


def svg_names(base_name: str, indices: list[int], page_count: int) -> list[str]:
    width = len(str(page_count))
    return [f"{base_name}-{index + 1:0{width}d}.svg" for index in indices]


@op("convert.to_svg", SvgParams)
def to_svg(params: SvgParams, progress: Progress) -> SvgResult:
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    base_name = sanitize_file_name(params.base_name or Path(params.path).stem)
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        targets = [output_dir / name for name in svg_names(base_name, indices, document.page_count)]
        if not params.overwrite:
            refuse_existing(targets)
        drafts = [target.with_name(f".{target.name}.part") for target in targets]
        try:
            for position, (index, draft) in enumerate(zip(indices, drafts, strict=True)):
                progress.report(
                    position / len(indices),
                    "progress.rendering",
                    {"current": position + 1, "total": len(indices)},
                )
                progress.check_cancelled()
                svg = document[index].get_svg_image(text_as_path=not params.text_as_text)
                draft.write_text(svg, encoding="utf-8")
        except BaseException:
            for draft in drafts:
                draft.unlink(missing_ok=True)
            raise
    written = 0
    for draft, target in zip(drafts, targets, strict=True):
        draft.replace(target)
        written += target.stat().st_size
    return SvgResult(
        outputs=[str(target) for target in targets], bytes=written, page_count=len(indices)
    )
