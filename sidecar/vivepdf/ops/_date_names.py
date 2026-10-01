import re
from dataclasses import dataclass, field

ENGLISH_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
ENGLISH_DAYS = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")


def _numbered(suffix: str) -> tuple[str, ...]:
    return tuple(f"{number}{suffix}" for number in range(1, 13))


def _options(*groups: tuple[str, ...]) -> tuple[tuple[str, int], ...]:
    options = {}
    for group in groups:
        for index, name in enumerate(group):
            for form in (name, name.rstrip(".")):
                options.setdefault(form.casefold(), index)
    return tuple(sorted(options.items(), key=lambda option: -len(option[0])))


@dataclass(frozen=True)
class DateNames:
    months: tuple[str, ...]
    short_months: tuple[str, ...]
    days: tuple[str, ...]
    short_days: tuple[str, ...]
    acrobat: str
    months_with_day: tuple[str, ...] | None = None
    month_options: tuple[tuple[str, int], ...] = field(init=False)
    day_options: tuple[tuple[str, int], ...] = field(init=False)

    def __post_init__(self) -> None:
        english_short = tuple(name[:3] for name in ENGLISH_MONTHS)
        months = (self.months, self.months_with_day or (), self.short_months)
        object.__setattr__(self, "month_options", _options(*months, ENGLISH_MONTHS, english_short))
        object.__setattr__(
            self,
            "day_options",
            _options(
                self.days, self.short_days, ENGLISH_DAYS, tuple(day[:3] for day in ENGLISH_DAYS)
            ),
        )

    def month(self, index: int, with_day: bool) -> str:
        if with_day and self.months_with_day is not None:
            return self.months_with_day[index]
        return self.months[index]

    def find_month(self, text: str) -> int | None:
        folded = text.casefold()
        for name, index in self.month_options:
            if name[0].isdigit():
                continue
            if re.search(rf"(?<![^\W\d]){re.escape(name)}(?![^\W\d])", folded):
                return index
        return None


ENGLISH = DateNames(
    ENGLISH_MONTHS,
    tuple(name[:3] for name in ENGLISH_MONTHS),
    ENGLISH_DAYS,
    tuple(day[:3] for day in ENGLISH_DAYS),
    "ENU",
)

LANGUAGES = {
    "en": ENGLISH,
    "tr": DateNames(
        (
            "Ocak",
            "Şubat",
            "Mart",
            "Nisan",
            "Mayıs",
            "Haziran",
            "Temmuz",
            "Ağustos",
            "Eylül",
            "Ekim",
            "Kasım",
            "Aralık",
        ),
        ("Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"),
        ("Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"),
        ("Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"),
        "TUR",
    ),
    "de": DateNames(
        (
            "Januar",
            "Februar",
            "März",
            "April",
            "Mai",
            "Juni",
            "Juli",
            "August",
            "September",
            "Oktober",
            "November",
            "Dezember",
        ),
        ("Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"),
        ("Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"),
        ("So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"),
        "DEU",
    ),
    "fr": DateNames(
        (
            "janvier",
            "février",
            "mars",
            "avril",
            "mai",
            "juin",
            "juillet",
            "août",
            "septembre",
            "octobre",
            "novembre",
            "décembre",
        ),
        (
            "janv.",
            "févr.",
            "mars",
            "avr.",
            "mai",
            "juin",
            "juil.",
            "août",
            "sept.",
            "oct.",
            "nov.",
            "déc.",
        ),
        ("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"),
        ("dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."),
        "FRA",
    ),
    "es": DateNames(
        (
            "enero",
            "febrero",
            "marzo",
            "abril",
            "mayo",
            "junio",
            "julio",
            "agosto",
            "septiembre",
            "octubre",
            "noviembre",
            "diciembre",
        ),
        ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"),
        ("domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"),
        ("dom", "lun", "mar", "mié", "jue", "vie", "sáb"),
        "ESP",
    ),
    "it": DateNames(
        (
            "gennaio",
            "febbraio",
            "marzo",
            "aprile",
            "maggio",
            "giugno",
            "luglio",
            "agosto",
            "settembre",
            "ottobre",
            "novembre",
            "dicembre",
        ),
        ("gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"),
        ("domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"),
        ("dom", "lun", "mar", "mer", "gio", "ven", "sab"),
        "ITA",
    ),
    "pt": DateNames(
        (
            "janeiro",
            "fevereiro",
            "março",
            "abril",
            "maio",
            "junho",
            "julho",
            "agosto",
            "setembro",
            "outubro",
            "novembro",
            "dezembro",
        ),
        ("jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"),
        (
            "domingo",
            "segunda-feira",
            "terça-feira",
            "quarta-feira",
            "quinta-feira",
            "sexta-feira",
            "sábado",
        ),
        ("dom", "seg", "ter", "qua", "qui", "sex", "sáb"),
        "PTB",
    ),
    "ru": DateNames(
        (
            "январь",
            "февраль",
            "март",
            "апрель",
            "май",
            "июнь",
            "июль",
            "август",
            "сентябрь",
            "октябрь",
            "ноябрь",
            "декабрь",
        ),
        ("янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"),
        ("воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"),
        ("вс", "пн", "вт", "ср", "чт", "пт", "сб"),
        "RUS",
        (
            "января",
            "февраля",
            "марта",
            "апреля",
            "мая",
            "июня",
            "июля",
            "августа",
            "сентября",
            "октября",
            "ноября",
            "декабря",
        ),
    ),
    "ar": DateNames(
        (
            "يناير",
            "فبراير",
            "مارس",
            "أبريل",
            "مايو",
            "يونيو",
            "يوليو",
            "أغسطس",
            "سبتمبر",
            "أكتوبر",
            "نوفمبر",
            "ديسمبر",
        ),
        (
            "يناير",
            "فبراير",
            "مارس",
            "أبريل",
            "مايو",
            "يونيو",
            "يوليو",
            "أغسطس",
            "سبتمبر",
            "أكتوبر",
            "نوفمبر",
            "ديسمبر",
        ),
        ("الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"),
        ("الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"),
        "ARA",
    ),
    "ja": DateNames(
        _numbered("月"),
        _numbered("月"),
        ("日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"),
        ("日", "月", "火", "水", "木", "金", "土"),
        "JPN",
    ),
    "ko": DateNames(
        _numbered("월"),
        _numbered("월"),
        ("일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"),
        ("일", "월", "화", "수", "목", "금", "토"),
        "KOR",
    ),
    "zh": DateNames(
        (
            "一月",
            "二月",
            "三月",
            "四月",
            "五月",
            "六月",
            "七月",
            "八月",
            "九月",
            "十月",
            "十一月",
            "十二月",
        ),
        _numbered("月"),
        ("星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"),
        ("周日", "周一", "周二", "周三", "周四", "周五", "周六"),
        "CHS",
    ),
}


def date_names(language: str | None) -> DateNames:
    if not language:
        return ENGLISH
    base = language.replace("_", "-").split("-")[0].lower()
    return LANGUAGES.get(base, ENGLISH)
