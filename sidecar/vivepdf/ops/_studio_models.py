from typing import Annotated, Any, Literal

from pydantic import Field

from vivepdf.ops._studio_graphics import StudioGraphic
from vivepdf.rpc.protocol import RpcModel

MAX_PAGES = 500
MAX_ITEMS = 2000
MAX_ROWS = 5000
MAX_OUTPUT_PAGES = 20000
MAX_PATHS = 5000
MAX_PATH_DATA = 400_000
MAX_ASSETS = 2000
MAX_IMAGE_DATA = 8_000_000

Colour = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Coordinate = Annotated[float, Field(ge=-100_000, le=100_000)]
Extent = Annotated[float, Field(gt=0, le=20_000)]
Unit = Annotated[float, Field(ge=0, le=1)]
TextAlign = Literal["left", "center", "right", "justify"]
VerticalAlign = Literal["top", "middle", "bottom"]
ErrorLevel = Literal["L", "M", "Q", "H"]
TextCase = Literal["none", "upper", "lower", "title"]
ListKind = Literal["none", "bullet", "dash", "check", "decimal", "alpha", "roman"]
Weight = Annotated[int, Field(ge=1, le=1000)]
FontId = Annotated[str, Field(max_length=1024)]
FilePath = Annotated[str, Field(min_length=1, max_length=4096)]


class StudioStop(RpcModel):
    offset: Unit
    color: Colour


class StudioSolid(RpcModel):
    type: Literal["solid"]
    color: Colour


class StudioLinear(RpcModel):
    type: Literal["linear"]
    x1: Coordinate
    y1: Coordinate
    x2: Coordinate
    y2: Coordinate
    stops: list[StudioStop] = Field(min_length=1, max_length=32)


class StudioRadial(RpcModel):
    type: Literal["radial"]
    cx: Coordinate
    cy: Coordinate
    r: Extent
    stops: list[StudioStop] = Field(min_length=1, max_length=32)


StudioFill = Annotated[StudioSolid | StudioLinear | StudioRadial, Field(discriminator="type")]


class StudioStroke(RpcModel):
    color: Colour
    width: float = Field(gt=0, le=500)
    dash: list[Annotated[float, Field(ge=0, le=2000)]] = Field(default_factory=list, max_length=8)
    cap: Literal["butt", "round", "square"] = "butt"
    join: Literal["miter", "round", "bevel"] = "miter"


class StudioPath(RpcModel):
    d: str = Field(min_length=1, max_length=MAX_PATH_DATA)
    fill: StudioFill | None = None
    stroke: StudioStroke | None = None
    even_odd: bool = False
    opacity: Unit = 1.0


class StudioBox(RpcModel):
    x: Coordinate
    y: Coordinate
    width: Extent
    height: Extent
    rotation: float = Field(default=0.0, ge=-3600, le=3600)
    opacity: Unit = 1.0
    flip_x: bool = False
    flip_y: bool = False


class StudioVectorItem(StudioBox):
    kind: Literal["vector"]
    paths: list[StudioPath] = Field(min_length=1, max_length=MAX_PATHS)
    view_width: Extent | None = None
    view_height: Extent | None = None


class StudioSvgItem(StudioBox):
    kind: Literal["svg"]
    svg: str = Field(min_length=1, max_length=4_000_000)
    graphic: StudioGraphic | None = None


class StudioCrop(RpcModel):
    x: Unit = 0.0
    y: Unit = 0.0
    width: Annotated[float, Field(gt=0, le=1)] = 1.0
    height: Annotated[float, Field(gt=0, le=1)] = 1.0


class StudioImageItem(StudioBox):
    kind: Literal["image"]
    path: str = Field(min_length=1, max_length=4096)
    fit: Literal["cover", "contain", "stretch"] = "cover"
    crop: StudioCrop | None = None
    mask: Literal["none", "rounded", "circle"] = "none"
    radius: float = Field(default=0.0, ge=0, le=10_000)
    filter: list[Annotated[float, Field(ge=-10, le=10)]] | None = Field(
        default=None, min_length=12, max_length=12
    )


class StudioQrItem(StudioBox):
    kind: Literal["qr"]
    value: str = Field(min_length=1, max_length=2000)
    color: Colour = "#000000"
    background: Colour | None = "#ffffff"
    error_level: ErrorLevel = "M"


class StudioRun(RpcModel):
    text: str = Field(max_length=20_000)
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    color: Colour = "#000000"
    font_id: FontId | None = None
    size: float | None = Field(default=None, gt=0, le=1000)
    weight: Weight | None = None


class StudioSegment(RpcModel):
    text: str = Field(min_length=1, max_length=5000)
    x: Coordinate
    y: Coordinate
    size: float = Field(gt=0, le=1000)
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    color: Colour = "#000000"
    letter_spacing: float = Field(default=0.0, ge=-100, le=1000)
    font_id: FontId | None = None
    weight: Weight | None = None


class StudioParagraph(RpcModel):
    list: ListKind = "none"
    level: int = Field(default=0, ge=0, le=8)


class StudioTextOutline(RpcModel):
    color: Colour
    width: float = Field(gt=0, le=50)


class StudioTextShadow(RpcModel):
    color: Colour
    x: float = Field(default=0.0, ge=-500, le=500)
    y: float = Field(default=0.0, ge=-500, le=500)
    opacity: Unit = 1.0


class StudioTextHighlight(RpcModel):
    color: Colour
    padding: float = Field(default=0.0, ge=0, le=200)


class StudioBand(RpcModel):
    x: Coordinate
    y: Coordinate
    width: float = Field(ge=0, le=100_000)
    height: float = Field(ge=0, le=100_000)


class StudioTextItem(StudioBox):
    kind: Literal["text"]
    runs: list[StudioRun] = Field(min_length=1, max_length=2000)
    font_id: str | None = Field(default=None, max_length=1024)
    font_size: float = Field(default=12.0, ge=1, le=1000)
    weight: Weight | None = None
    color: Colour = "#000000"
    align: TextAlign = "left"
    vertical_align: VerticalAlign = "top"
    line_height: float = Field(default=1.2, ge=0.5, le=5)
    letter_spacing: float = Field(default=0.0, ge=-100, le=1000)
    uppercase: bool = False
    text_case: TextCase = "none"
    shrink_to_fit: bool = False
    auto_width: bool = False
    paragraphs: list[StudioParagraph] = Field(default_factory=list, max_length=20_000)
    outline: StudioTextOutline | None = None
    shadow: StudioTextShadow | None = None
    highlight: StudioTextHighlight | None = None
    language: str | None = Field(default=None, max_length=20)
    segments: list[StudioSegment] | None = Field(default=None, max_length=20_000)
    bands: list[StudioBand] | None = Field(default=None, max_length=5000)

    @property
    def case(self) -> str:
        return "upper" if self.uppercase and self.text_case == "none" else self.text_case


class StudioDropShadow(RpcModel):
    color: Colour
    opacity: Unit = 0.35
    x: float = Field(default=0.0, ge=-500, le=500)
    y: float = Field(default=0.0, ge=-500, le=500)
    blur: float = Field(default=0.0, ge=0, le=200)


StudioShadowSource = Annotated[
    StudioVectorItem | StudioSvgItem | StudioImageItem | StudioQrItem,
    Field(discriminator="kind"),
]


class StudioShadowItem(StudioBox):
    kind: Literal["shadow"]
    shadow: StudioDropShadow
    items: list[StudioShadowSource] = Field(min_length=1, max_length=8)


StudioItem = Annotated[
    StudioVectorItem
    | StudioSvgItem
    | StudioImageItem
    | StudioQrItem
    | StudioTextItem
    | StudioShadowItem,
    Field(discriminator="kind"),
]


class StudioPage(RpcModel):
    width: float = Field(ge=18, le=14_400)
    height: float = Field(ge=18, le=14_400)
    items: list[StudioItem] = Field(default_factory=list, max_length=MAX_ITEMS)


class StudioEmbed(RpcModel):
    design: dict[str, Any]
    assets: list[FilePath] = Field(default_factory=list, max_length=MAX_ASSETS)


class StudioSignOptions(RpcModel):
    certificate_path: str = Field(min_length=1, max_length=4096)
    certificate_password: str = Field(default="", max_length=1024, repr=False)
    reason: str = Field(default="", max_length=500)
    location: str = Field(default="", max_length=500)


class StudioRenderParams(RpcModel):
    pages: list[StudioPage] = Field(min_length=1, max_length=MAX_PAGES)
    rows: list[dict[str, Annotated[str, Field(max_length=5000)]]] = Field(
        default_factory=list, max_length=MAX_ROWS
    )
    date: str = Field(default="", max_length=100)
    language: str = Field(default="en", max_length=20)
    title: str = Field(default="", max_length=500)
    format: Literal["pdf", "png", "jpg"] = "pdf"
    dpi: int = Field(default=150, ge=36, le=600)
    quality: int = Field(default=92, ge=10, le=100)
    transparent: bool = False
    page_numbers: list[Annotated[int, Field(ge=1, le=MAX_PAGES)]] | None = Field(
        default=None, max_length=MAX_PAGES
    )
    embed: StudioEmbed | None = None
    output: str = Field(default="", max_length=4096)
    overwrite: bool = False
    data_path: str | None = Field(default=None, max_length=4096)
    sheet: str | None = Field(default=None, max_length=200)
    split: bool = False
    output_dir: str | None = Field(default=None, max_length=4096)
    pattern: str = Field(default="{n}", min_length=1, max_length=120)
    sign: StudioSignOptions | None = None


class StudioRenderResult(RpcModel):
    output: str
    outputs: list[str] = Field(default_factory=list)
    page_count: int
    bytes: int
    missing_glyphs: str = ""


class StudioImageInfoParams(RpcModel):
    path: str = Field(min_length=1, max_length=4096)
    max_side: int = Field(default=1600, ge=16, le=4096)


class StudioImageInfoResult(RpcModel):
    width: int
    height: int
    mime: str
    base64: str


class StudioSaveImageParams(RpcModel):
    data: str = Field(min_length=4, max_length=MAX_IMAGE_DATA)


class StudioSaveImageResult(RpcModel):
    path: str
    width: int
    height: int


class StudioQrParams(RpcModel):
    value: str = Field(min_length=1, max_length=2000)
    error_level: ErrorLevel = "M"


class StudioQrResult(RpcModel):
    size: int
    modules: str


class StudioSvgParams(RpcModel):
    path: str = Field(min_length=1, max_length=4096)


class StudioSvgResult(RpcModel):
    svg: str
    width: float
    height: float


class StudioProjectSaveParams(RpcModel):
    design: dict[str, Any]
    assets: list[FilePath] = Field(default_factory=list, max_length=MAX_ASSETS)
    preview: StudioPage | None = None
    language: str = Field(default="en", max_length=20)
    output: str
    overwrite: bool = False


class StudioProjectSaveResult(RpcModel):
    output: str
    bytes: int
    thumbnail: str = ""


class StudioThumbnailParams(RpcModel):
    page: StudioPage
    language: str = Field(default="en", max_length=20)
    side: int = Field(default=320, ge=32, le=800)


class StudioThumbnailResult(RpcModel):
    image: str
    width: int
    height: int


class StudioProjectOpenParams(RpcModel):
    path: FilePath
    password: str | None = None


class StudioProjectOpenResult(RpcModel):
    design: dict[str, Any]
    thumbnail: str = ""
    source: Literal["project", "pdf"]


class StudioDesignOfResult(RpcModel):
    found: bool
