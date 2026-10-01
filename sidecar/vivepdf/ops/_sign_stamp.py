import base64
import dataclasses
import functools
import io
from pathlib import Path

from vivepdf.ops._sign_params import SignParams
from vivepdf.rpc.errors import ErrorCode, OpError

STAMP_FONT = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "DejaVuSans.ttf"


DEFAULT_STAMP_TEXT = "{signer}\n{date}"
STAMP_ROTATION_MATRICES = {
    90: (0, 1, -1, 0, 0, 0),
    180: (-1, 0, 0, -1, 0, 0),
    270: (0, -1, 1, 0, 0, 0),
}


MAX_STAMP_IMAGE_BYTES = 8 * 1024 * 1024


@functools.lru_cache(maxsize=1)
def _page_stamp_style_class():
    from pyhanko.pdf_utils import generic, layout
    from pyhanko.stamp import TextStamp, TextStampStyle

    class PageTextStamp(TextStamp):
        def as_form_xobject(self):
            form = super().as_form_xobject()
            matrix = STAMP_ROTATION_MATRICES.get(self.style.rotation)
            if matrix:
                form["/Matrix"] = generic.ArrayObject(
                    [generic.NumberObject(value) for value in matrix]
                )
            return form

    @dataclasses.dataclass(frozen=True)
    class PageTextStampStyle(TextStampStyle):
        rotation: int = 0

        def create_stamp(self, writer, box, text_params):
            if self.rotation in (90, 270) and box.width_defined and box.height_defined:
                box = layout.BoxConstraints(width=box.height, height=box.width)
            style = self
            if self.background is not None and box.width_defined and box.height_defined:
                image_share = box.width * 0.4
                style = dataclasses.replace(
                    self,
                    background_layout=layout.SimpleBoxLayoutRule(
                        x_align=layout.AxisAlignment.ALIGN_MIN,
                        y_align=layout.AxisAlignment.ALIGN_MID,
                        margins=layout.Margins(4, box.width - image_share, 4, 4),
                        inner_content_scaling=layout.InnerScaling.SHRINK_TO_FIT,
                    ),
                    inner_content_layout=layout.SimpleBoxLayoutRule(
                        x_align=layout.AxisAlignment.ALIGN_MIN,
                        y_align=layout.AxisAlignment.ALIGN_MID,
                        margins=layout.Margins(image_share + 4, 4, 4, 4),
                        inner_content_scaling=layout.InnerScaling.SHRINK_TO_FIT,
                    ),
                )
            elif self.inner_content_layout is None:
                style = dataclasses.replace(
                    self,
                    inner_content_layout=layout.SimpleBoxLayoutRule(
                        x_align=layout.AxisAlignment.ALIGN_MIN,
                        y_align=layout.AxisAlignment.ALIGN_MID,
                        margins=layout.Margins.uniform(6),
                        inner_content_scaling=layout.InnerScaling.SHRINK_TO_FIT,
                    ),
                )
            return PageTextStamp(writer=writer, style=style, box=box, text_params=text_params)

    return PageTextStampStyle


def _stamp_image(params: "SignParams"):
    from PIL import Image

    if params.image_base64:
        raw = params.image_base64.split(",", 1)[-1]
        try:
            data = base64.b64decode(raw, validate=True)
        except ValueError as error:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "signature image is not valid base64", {"reason": "image"}
            ) from error
    elif params.image_path:
        source = Path(params.image_path)
        if not source.is_file():
            raise OpError(
                ErrorCode.FILE_NOT_FOUND,
                f"image not found: {source.name}",
                {"path": params.image_path},
            )
        data = source.read_bytes()
    else:
        return None
    if len(data) > MAX_STAMP_IMAGE_BYTES:
        raise OpError(ErrorCode.INVALID_PARAMS, "signature image is too large", {"reason": "image"})
    try:
        with Image.open(io.BytesIO(data)) as opened:
            return opened.convert("RGBA")
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "cannot read the signature image", {"reason": "image"}
        ) from error


@functools.lru_cache(maxsize=1)
def _stamp_font_path() -> str:
    from fontTools.ttLib import TTFont
    from fontTools.ttLib.scaleUpem import scale_upem

    from vivepdf.ops._appdata import user_data_dir

    try:
        target = user_data_dir() / "cache" / "DejaVuSans-upem1000.ttf"
        if not target.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            font = TTFont(str(STAMP_FONT))
            scale_upem(font, 1000)
            staging = target.with_suffix(".tmp")
            font.save(str(staging))
            font.close()
            staging.replace(target)
        return str(target)
    except Exception:  # noqa: BLE001
        return str(STAMP_FONT)


def _escape_template(value: str) -> str:
    return value.replace("%", "%%")


def _stamp_style(params: "SignParams", signer_name: str, rotation: int, image=None):
    from pyhanko.pdf_utils.font.opentype import GlyphAccumulatorFactory
    from pyhanko.pdf_utils.images import PdfImage
    from pyhanko.pdf_utils.text import TextBoxStyle

    template = params.stamp_text if params.stamp_text.strip() else DEFAULT_STAMP_TEXT
    stamp_text = (
        _escape_template(template)
        .replace("{signer}", _escape_template(signer_name))
        .replace("{reason}", _escape_template(params.reason))
        .replace("{location}", _escape_template(params.location))
        .replace("{date}", "%(ts)s")
    )
    box_style = TextBoxStyle(
        font=GlyphAccumulatorFactory(_stamp_font_path()), font_size=9, leading=11
    )
    return _page_stamp_style_class()(
        stamp_text=stamp_text,
        text_box_style=box_style,
        background=PdfImage(image) if image is not None else None,
        background_opacity=1.0 if image is not None else 0.15,
        border_width=1,
        rotation=rotation,
    )
