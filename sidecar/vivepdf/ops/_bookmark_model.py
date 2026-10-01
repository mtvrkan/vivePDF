import math
import re
from typing import Literal

from pydantic import Field, model_validator

from vivepdf.ops._output import (
    OutputResult,
)
from vivepdf.rpc.protocol import RpcModel

OPEN_ALL_LEVELS = 99
MAX_LINK_LENGTH = 2048
WEB_SCHEMES = frozenset({"http", "https", "mailto", "ftp"})
FIT_ARITY = {"XYZ": 3, "Fit": 0, "FitB": 0, "FitH": 1, "FitBH": 1, "FitV": 1, "FitBV": 1, "FitR": 4}
DESTINATION = re.compile(r"\[\s*\d+\s+\d+\s+R\s*/([A-Za-z]+)([^\]/]*)\]")
ITALIC_FLAG = 1
BOLD_FLAG = 2

BookmarkTarget = Literal["page", "web", "file", "launch", "other"]
FitMode = Literal["XYZ", "Fit", "FitH", "FitV", "FitR", "FitB", "FitBH", "FitBV"]


class BookmarkItem(RpcModel):
    level: int = Field(ge=1)
    title: str
    page: int = Field(ge=0)
    left: float | None = None
    top: float | None = None
    zoom: float | None = Field(default=None, ge=0)
    collapsed: bool = False
    target: BookmarkTarget = "page"
    uri: str | None = Field(default=None, max_length=MAX_LINK_LENGTH)
    file: str | None = Field(default=None, max_length=MAX_LINK_LENGTH)
    fit: FitMode | None = None
    fit_args: list[float | None] | None = Field(default=None, max_length=4)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    bold: bool = False
    italic: bool = False
    source: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _fit_arguments(self) -> "BookmarkItem":
        if self.fit is None or self.fit == "XYZ" or self.fit_args is None:
            if self.fit == "FitR":
                raise ValueError("FitR needs four fitArgs")
            return self
        if len(self.fit_args) != FIT_ARITY[self.fit]:
            raise ValueError(f"{self.fit} takes {FIT_ARITY[self.fit]} fitArgs")
        if any(value is not None and not math.isfinite(value) for value in self.fit_args):
            raise ValueError("fitArgs must be finite")
        if self.fit == "FitR" and None in self.fit_args:
            raise ValueError("FitR needs four fitArgs")
        return self


class BookmarksGenerateParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    mode: Literal["headings", "everyPage"] = "headings"
    max_levels: int = Field(default=3, ge=1, le=6)
    min_font_size: float | None = None
    every: int = Field(default=1, ge=1, le=500)
    label: str = Field(default="{n}", min_length=1, max_length=60)


class BookmarksGenerateResult(OutputResult):
    items: list[BookmarkItem]


class BookmarksSuggestParams(RpcModel):
    path: str
    password: str | None = None
    mode: Literal["headings", "everyPage"] = "headings"
    max_levels: int = Field(default=3, ge=1, le=6)
    min_font_size: float | None = None
    every: int = Field(default=1, ge=1, le=500)
    label: str = Field(default="{n}", min_length=1, max_length=60)
