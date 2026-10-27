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
MAX_BIBLIOGRAPHY_CHARS = 16 * 1024 * 1024
DOCUMENT_EXTENSION = "vivedoc"
DOCUMENT_VERSION = 6
MAX_EQUATIONS = 1000
MAX_EQUATION_CHARS = 400_000

DocumentPaper = Literal["a4", "a5", "b5", "letter", "legal"]
PageNumbers = Literal["none", "center", "right", "outside"]
FurnitureAlign = Literal["left", "center", "right"]
CoverLook = Literal["classic", "band", "frame", "minimal"]
GutterSide = Literal["left", "top"]
FontId = Annotated[NotAPath, Field(min_length=1, max_length=300)]
MAX_FOOTNOTES = 500
MAX_FOOTNOTE_CHARS = 2000
MAX_FOOTNOTE_HTML_CHARS = 20000
ShortText = Annotated[str, Field(max_length=300)]
MAX_COMMENTS = 500
MAX_REPLIES = 100
MAX_COMMENT_TEXT = 4000
MAX_COMMENT_AUTHOR = 80
CommentText = Annotated[NotAPath, Field(max_length=MAX_COMMENT_TEXT)]
CommentAuthor = Annotated[NotAPath, Field(max_length=MAX_COMMENT_AUTHOR)]
CommentDate = Annotated[NotAPath, Field(max_length=40)]


class StudioDocumentSettings(RpcModel):
    paper: DocumentPaper = "a4"
    landscape: bool = False
    margin_top_mm: float = Field(default=20, ge=5, le=60)
    margin_bottom_mm: float = Field(default=20, ge=5, le=60)
    margin_left_mm: float = Field(default=20, ge=5, le=60)
    margin_right_mm: float = Field(default=20, ge=5, le=60)
    gutter_mm: float = Field(default=0, ge=0, le=30)
    gutter_side: GutterSide = "left"
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
    page_number_start: int = Field(default=1, ge=1, le=9999)
    furniture_on_first: bool = True
    toc: bool = False
    toc_title: str = Field(default="Contents", max_length=100)
    toc_depth: int = Field(default=2, ge=1, le=3)
    figure_list: bool = False
    figure_list_title: str = Field(default="List of figures", max_length=100)
    table_list: bool = False
    table_list_title: str = Field(default="List of tables", max_length=100)
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
    equations: list[Annotated[NotAPath, Field(max_length=MAX_EQUATION_CHARS)]] = Field(
        default_factory=list, max_length=MAX_EQUATIONS
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


class StudioDocumentMarkdownParams(StudioDocumentContent):
    output: WriteFile
    overwrite: bool = False


class StudioDocumentReply(RpcModel):
    id: Annotated[NotAPath, Field(pattern=r"^c-[A-Za-z0-9]{1,40}$")]
    author: CommentAuthor = ""
    created_at: CommentDate = ""
    text: CommentText = ""


class StudioDocumentThread(StudioDocumentReply):
    resolved: bool = False
    replies: list[StudioDocumentReply] = Field(default_factory=list, max_length=MAX_REPLIES)


class StudioDocumentDocxParams(StudioDocumentContent):
    output: WriteFile
    overwrite: bool = False
    comments: list[StudioDocumentThread] = Field(default_factory=list, max_length=MAX_COMMENTS)


class StudioDocumentPreviewParams(StudioDocumentContent):
    pass


class StudioDocumentBlockStart(RpcModel):
    id: str
    page: int
    top: float


class StudioDocumentPageStart(RpcModel):
    page: int
    top: float
    words: list[str]


class StudioDocumentPreviewResult(RpcModel):
    token: str
    page_count: int
    width: float
    height: float
    block_starts: list[StudioDocumentBlockStart] = Field(default_factory=list)
    page_starts: list[StudioDocumentPageStart] = Field(default_factory=list)
    page_labels: list[str] = Field(default_factory=list)


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
    encoding: str = "utf-8"
    hash: str = ""
    lossy: bool = False


class StudioBibliographyWriteParams(RpcModel):
    text: str = Field(max_length=MAX_BIBLIOGRAPHY_CHARS)
    output: WriteFile
    encoding: str = Field(default="utf-8", max_length=40)
    expected_hash: str | None = Field(default=None, max_length=64)
    overwrite: bool = False


class StudioBibliographyWriteResult(RpcModel):
    output: str
    bytes: int
    hash: str


class StudioDocumentImageResult(RpcModel):
    src: str
    width: int
    height: int
