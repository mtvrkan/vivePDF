from typing import Annotated, Any, Literal

from pydantic import Field

from vivepdf.ops._studio_models import Colour, ReadFile, WriteFile
from vivepdf.rpc.paths import NotAPath
from vivepdf.rpc.protocol import RpcModel

MAX_HTML_CHARS = 20_000_000
MAX_IMAGES = 300
MAX_IMAGE_CHARS = 30_000_000
MAX_FONTS = 16
MAX_DOCUMENT_BYTES = 120 * 1024 * 1024
DOCUMENT_EXTENSION = "vivedoc"
DOCUMENT_VERSION = 2

DocumentPaper = Literal["a4", "a5", "b5", "letter", "legal"]
PageNumbers = Literal["none", "center", "right", "outside"]
FurnitureAlign = Literal["left", "center", "right"]
CoverLook = Literal["classic", "band", "frame", "minimal"]
FontId = Annotated[NotAPath, Field(min_length=1, max_length=300)]
MAX_FOOTNOTES = 500
MAX_FOOTNOTE_CHARS = 2000
MAX_FOOTNOTE_HTML_CHARS = 20000
ShortText = Annotated[str, Field(max_length=300)]


class StudioDocumentSettings(RpcModel):
    paper: DocumentPaper = "a4"
    landscape: bool = False
    margin_mm: float = Field(default=20, ge=5, le=50)
    columns: int = Field(default=1, ge=1, le=3)
    column_gap_mm: float = Field(default=8, ge=4, le=20)
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
    images: list[Annotated[NotAPath, Field(max_length=MAX_IMAGE_CHARS)]] = Field(
        default_factory=list, max_length=MAX_IMAGES
    )
    fonts: list[FontId] = Field(default_factory=list, max_length=MAX_FONTS)
    settings: StudioDocumentSettings = Field(default_factory=StudioDocumentSettings)
    title: ShortText = ""
    language: str = Field(default="", max_length=35)
    footnotes: list[Annotated[NotAPath, Field(max_length=MAX_FOOTNOTE_CHARS)]] = Field(
        default_factory=list, max_length=MAX_FOOTNOTES
    )
    footnote_html: list[Annotated[NotAPath, Field(max_length=MAX_FOOTNOTE_HTML_CHARS)]] = Field(
        default_factory=list, max_length=MAX_FOOTNOTES
    )
    notes_title: ShortText = "Notes"


class StudioDocumentRenderParams(StudioDocumentContent):
    output: WriteFile
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
    output: WriteFile
    overwrite: bool = False


class StudioDocumentSaveResult(RpcModel):
    output: str
    bytes: int


class StudioDocumentOpenParams(RpcModel):
    path: ReadFile


class StudioDocumentOpenResult(RpcModel):
    document: dict[str, Any]


class StudioDocumentImportResult(RpcModel):
    html: str
    title: str
    author: str = ""
    date: str = ""
    references_title: str = ""
    bibliography: str = ""


class StudioBibliographyResult(RpcModel):
    text: str
    name: str


class StudioDocumentImageResult(RpcModel):
    src: str
    width: int
    height: int
