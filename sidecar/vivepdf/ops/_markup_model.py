from collections import Counter
from dataclasses import dataclass


@dataclass(slots=True)
class MarkupBlock:
    kind: str
    body: str
    size: float = 0.0
    characters: int = 0


@dataclass(slots=True)
class PageMarkup:
    blocks: list[MarkupBlock]
    sizes: Counter[float]


@dataclass(slots=True)
class MarkupLine:
    pieces: list[tuple[str, tuple[str, ...], str | None]]
    weighted: float
    characters: int

    @property
    def text(self) -> str:
        return "".join(piece[0] for piece in self.pieces)
