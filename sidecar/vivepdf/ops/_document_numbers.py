from dataclasses import dataclass

ROMAN = (
    (1000, "m"),
    (900, "cm"),
    (500, "d"),
    (400, "cd"),
    (100, "c"),
    (90, "xc"),
    (50, "l"),
    (40, "xl"),
    (10, "x"),
    (9, "ix"),
    (5, "v"),
    (4, "iv"),
    (1, "i"),
)


def roman(number: int) -> str:
    digits = []
    for value, letters in ROMAN:
        count, number = divmod(number, value)
        digits.append(letters * count)
    return "".join(digits)


@dataclass(frozen=True)
class PageNumbering:
    start: int = 1
    main: int | None = None

    def label(self, index: int) -> str:
        if self.main is None:
            return str(self.start + index)
        if index < self.main:
            return roman(index + 1)
        return str(self.start + index - self.main)

    def last(self, total: int) -> str:
        return str(self.start + total - 1 - (self.main or 0))

    def pdf_labels(self) -> list[dict]:
        if self.main is None:
            if self.start == 1:
                return []
            return [{"startpage": 0, "prefix": "", "style": "D", "firstpagenum": self.start}]
        rules = []
        if self.main > 0:
            rules.append({"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1})
        rules.append(
            {"startpage": self.main, "prefix": "", "style": "D", "firstpagenum": self.start}
        )
        return rules


def numbering(start: int, main_page: int | None, offset: int) -> PageNumbering:
    return PageNumbering(start, None if main_page is None else main_page - 1 + offset)
