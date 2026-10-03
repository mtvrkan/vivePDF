from typing import Annotated, Any, Literal

from pydantic import Field

from vivepdf.ops._studio_models import Colour, FilePath
from vivepdf.rpc.protocol import RpcModel

MAX_HTML_CHARS = 20_000_000
MAX_IMAGES = 300
MAX_IMAGE_CHARS = 30_000_000
MAX_FONTS = 16
MAX_DOCUMENT_BYTES = 120 * 1024 * 1024
DOCUMENT_EXTENSION = "vivedoc"
DOCUMENT_VERSION = 1

DocumentPaper = Literal["a4", "a5", "b5", "letter", "legal"]
PageNumbers = Literal["none", "center", "right", "outside"]
FurnitureAlign = Literal["left", "center", "right"]
CoverLook = Literal["classic", "band", "frame", "minimal"]
FontId = Annotated[str, Field(min_length=1, max_length=300)]
ShortText = Annotated[str, Field(max_length=300)]


class StudioDocumentSettings(RpcModel):
    paper: DocumentPaper = "a4"
    landscape: bool = False
    margin_mm: float = Field(default=20, ge=5, le=50)
    font_size: float = Field(default=11, ge=6, le=28)
    line_height: float = Field(default=1.4, ge=1, le=3)
    accent: Colour = "#1f4e79"
    header: str = Field(default="", max_length=200)
    header_align: FurnitureAlign = "right"
    footer: str = Field(default="", max_length=200)
    footer_align: FurnitureAlign = "left"
    page_numbers: PageNumbers = "center"
    page_number_format: str = Field(default="{n}", min_length=1, max_length=40)
    furniture_on_first: bool = True
    toc: bool = False
    toc_title: str = Field(default="Contents", max_length=100)
    toc_depth: int = Field(default=2, ge=1, le=3)
    cover: bool = False
    cover_style: CoverLook = "classic"
    title: ShortText = ""
    subtitle: ShortText = ""
    author: ShortText = ""
    date: str = Field(default="", max_length=80)


class StudioDocumentContent(RpcModel):
    html: str = Field(max_length=MAX_HTML_CHARS)
    images: list[Annotated[str, Field(max_length=MAX_IMAGE_CHARS)]] = Field(
        default_factory=list, max_length=MAX_IMAGES
    )
    fonts: list[FontId] = Field(default_factory=list, max_length=MAX_FONTS)
    settings: StudioDocumentSettings = Field(default_factory=StudioDocumentSettings)
    title: ShortText = ""
    language: str = Field(default="", max_length=35)


class StudioDocumentRenderParams(StudioDocumentContent):
    output: FilePath
    overwrite: bool = False


class StudioDocumentPreviewParams(StudioDocumentContent):
    pass


class StudioDocumentPreviewResult(RpcModel):
    token: str
    page_count: int
    width: float
    height: float


class StudioDocumentPageParams(RpcModel):
    token: str = Field(min_length=1, max_length=80)
    page: int = Field(ge=0)
    width: int = Field(default=480, ge=60, le=2000)


class StudioDocumentPageResult(RpcModel):
    image: str
    width: int
    height: int


class StudioDocumentSaveParams(RpcModel):
    document: dict[str, Any]
    output: FilePath
    overwrite: bool = False


class StudioDocumentSaveResult(RpcModel):
    output: str
    bytes: int


class StudioDocumentOpenParams(RpcModel):
    path: FilePath


class StudioDocumentOpenResult(RpcModel):
    document: dict[str, Any]


class StudioDocumentImportResult(RpcModel):
    html: str
    title: str


class StudioDocumentImageResult(RpcModel):
    src: str
    width: int
    height: int
