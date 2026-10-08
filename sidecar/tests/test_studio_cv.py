from pathlib import Path

import pymupdf
import pytest

import vivepdf
from vivepdf.ops._studio_cv_models import StudioCvImportParams
from vivepdf.ops.studio_cv import cv_import_pdf
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

FONTS = Path(vivepdf.__file__).resolve().parent / "assets" / "fonts"
REGULAR = str(FONTS / "DejaVuSans.ttf")
BOLD = str(FONTS / "DejaVuSans-Bold.ttf")

ENGLISH = [
    (60, "Jane Doe", 24, True),
    (82, "Senior Software Engineer", 12, False),
    (100, "jane.doe@example.com | +1 555 123 4567 | https://janedoe.dev", 10, False),
    (130, "Summary", 14, True),
    (148, "Engineer with ten years of experience building document tools.", 10, False),
    (162, "Focused on reliable, fast pipelines.", 10, False),
    (190, "Experience", 14, True),
    (208, "Senior Software Engineer, Acme Corp", 11, True),
    (222, "Jan 2020 - Present | Istanbul, Turkey", 10, False),
    (236, "- Built a PDF rendering pipeline", 10, False),
    (250, "- Led a team of five engineers", 10, False),
    (268, "Software Engineer at Beta Ltd", 11, True),
    (282, "2017 – 2019", 10, False),
    (296, "- Maintained billing services", 10, False),
    (324, "Education", 14, True),
    (342, "BSc Computer Engineering", 11, True),
    (356, "Istanbul Technical University", 10, False),
    (370, "2013 - 2017", 10, False),
    (398, "Skills", 14, True),
    (416, "Python, TypeScript, PDF processing; Rust", 10, False),
    (444, "Languages", 14, True),
    (462, "English (Native)", 10, False),
    (476, "German - B2", 10, False),
    (490, "French: Elementary", 10, False),
]

TURKISH = [
    (60, "Ahmet Yılmaz", 22, True),
    (82, "Yazılım Mühendisi", 12, False),
    (100, "ahmet@ornek.com.tr · +90 532 123 45 67 · İstanbul, Türkiye", 10, False),
    (130, "DENEYİM", 13, True),
    (148, "Kıdemli Yazılım Mühendisi - Örnek A.Ş.", 11, True),
    (162, "2020 - Halen", 10, False),
    (176, "- Belge işleme servislerini geliştirdi", 10, False),
    (194, "Yazılım Geliştirici, Deneme Ltd. Şti.", 11, True),
    (208, "Ocak 2016 – Aralık 2019", 10, False),
    (236, "EĞİTİM", 13, True),
    (254, "Bilgisayar Mühendisliği Lisans", 11, True),
    (268, "Orta Doğu Teknik Üniversitesi", 10, False),
    (282, "2012 - 2016", 10, False),
    (310, "YETENEKLER", 13, True),
    (328, "Python, Go, Docker", 10, False),
    (356, "DİLLER", 13, True),
    (374, "Türkçe (Ana dil), İngilizce (C1), Almanca (B1)", 10, False),
]

SIDEBAR = [
    (60, "Contact", 13, False),
    (78, "jane.smith@example.com", 9, False),
    (92, "www.linkedin.com/in/jane-", 9, False),
    (106, "smith-1234 (LinkedIn)", 9, False),
    (134, "Top Skills", 13, False),
    (152, "Kubernetes", 9, False),
    (166, "Go", 9, False),
    (180, "Distributed Systems", 9, False),
    (208, "Languages", 13, False),
    (226, "English (Native or Bilingual)", 9, False),
    (240, "Turkish (Professional Working)", 9, False),
]

MAIN = [
    (60, "Jane Smith", 26, False),
    (84, "Staff Engineer at Cloudy", 12, False),
    (102, "Berlin, Germany", 10, False),
    (134, "Summary", 15.75, False),
    (154, "I build reliable platforms for large teams.", 10.5, False),
    (186, "Experience", 15.75, False),
    (206, "Cloudy GmbH", 12, True),
    (222, "Staff Engineer", 11.5, False),
    (238, "January 2021 - Present (2 years 3 months)", 10.5, False),
    (254, "Berlin, Germany", 10.5, False),
    (270, "Led the platform team.", 10.5, False),
    (292, "Old Corp", 12, True),
    (308, "Senior Engineer", 11.5, False),
    (324, "March 2017 - December 2020 (3 years 10 months)", 10.5, False),
    (340, "Munich Area", 10.5, False),
]

SECOND_PAGE = [
    (60, "Education", 15.75, False),
    (80, "Technical University of Munich", 12, True),
    (96, "Master of Science - MS, Computer Science · (2014 - 2016)", 10.5, False),
]


def _write(page: pymupdf.Page, x: float, rows: list[tuple]) -> None:
    for y, text, size, bold in rows:
        page.insert_text(
            (x, y),
            text,
            fontsize=size,
            fontfile=BOLD if bold else REGULAR,
            fontname="dvb" if bold else "dv",
        )


def _save(document: pymupdf.Document, path: Path, **options) -> Path:
    document.save(path, **options)
    document.close()
    return path


def _single(path: Path, rows: list[tuple], **options) -> Path:
    document = pymupdf.open()
    _write(document.new_page(width=595, height=842), 56, rows)
    return _save(document, path, **options)


def _linkedin(path: Path) -> Path:
    document = pymupdf.open()
    for number, (left, right) in enumerate(((SIDEBAR, MAIN), ([], SECOND_PAGE)), start=1):
        page = document.new_page(width=612, height=792)
        _write(page, 24, left)
        _write(page, 220, right)
        page.insert_text((270, 770), f"Page {number} of 2", fontsize=9, fontname="helv")
    return _save(document, path)


def _run(path: Path, password: str | None = None):
    params = StudioCvImportParams(path=str(path), password=password)
    return cv_import_pdf(params, silent_progress())


def _kinds(result) -> dict[str, str]:
    return {contact.kind: contact.value for contact in result.profile.contacts}


def test_english_cv(tmp_path: Path) -> None:
    result = _run(_single(tmp_path / "english.pdf", ENGLISH))
    profile = result.profile
    assert result.source == "generic"
    assert result.pages == 1
    assert profile.name == "Jane Doe"
    assert profile.headline == "Senior Software Engineer"
    contacts = _kinds(result)
    assert contacts["email"] == "jane.doe@example.com"
    assert contacts["phone"] == "+1 555 123 4567"
    assert contacts["website"] == "https://janedoe.dev"
    assert "ten years" in profile.summary and "fast pipelines" in profile.summary
    first, second = profile.experience
    assert (first.role, first.organisation) == ("Senior Software Engineer", "Acme Corp")
    assert (first.start, first.end, first.current) == ("Jan 2020", "Present", True)
    assert first.location == "Istanbul, Turkey"
    assert first.details.splitlines() == [
        "- Built a PDF rendering pipeline",
        "- Led a team of five engineers",
    ]
    assert (second.role, second.organisation) == ("Software Engineer", "Beta Ltd")
    assert (second.start, second.end, second.current) == ("2017", "2019", False)
    assert second.details == "- Maintained billing services"
    school = profile.education[0]
    assert (school.degree, school.school) == (
        "BSc Computer Engineering",
        "Istanbul Technical University",
    )
    assert (school.start, school.end) == ("2013", "2017")
    assert [skill.name for skill in profile.skills] == [
        "Python",
        "TypeScript",
        "PDF processing",
        "Rust",
    ]
    assert [(item.name, item.level) for item in profile.languages] == [
        ("English", 5),
        ("German", 3),
        ("French", 1),
    ]
    sections = {section.key: section for section in result.sections}
    assert sections["experience"].count == 2
    assert sections["experience"].confidence == pytest.approx(0.9)
    assert sections["personal"].confidence == pytest.approx(0.4)
    assert "references" not in sections


def test_turkish_cv(tmp_path: Path) -> None:
    profile = _run(_single(tmp_path / "turkish.pdf", TURKISH)).profile
    assert profile.name == "Ahmet Yılmaz"
    assert profile.headline == "Yazılım Mühendisi"
    contacts = {contact.kind: contact.value for contact in profile.contacts}
    assert contacts["email"] == "ahmet@ornek.com.tr"
    assert contacts["location"] == "İstanbul, Türkiye"
    first, second = profile.experience
    assert (first.role, first.organisation) == ("Kıdemli Yazılım Mühendisi", "Örnek A.Ş.")
    assert (first.start, first.end, first.current) == ("2020", "Halen", True)
    assert (second.start, second.end, second.current) == ("Ocak 2016", "Aralık 2019", False)
    assert second.organisation == "Deneme Ltd. Şti."
    assert profile.education[0].school == "Orta Doğu Teknik Üniversitesi"
    assert [skill.name for skill in profile.skills] == ["Python", "Go", "Docker"]
    assert [(item.name, item.level) for item in profile.languages] == [
        ("Türkçe", 5),
        ("İngilizce", 4),
        ("Almanca", 2),
    ]


def test_linkedin_export(tmp_path: Path) -> None:
    result = _run(_linkedin(tmp_path / "Profile.pdf"))
    profile = result.profile
    assert result.source == "linkedin"
    assert result.pages == 2
    assert profile.name == "Jane Smith"
    assert profile.headline == "Staff Engineer at Cloudy"
    contacts = _kinds(result)
    assert contacts["linkedin"] == "www.linkedin.com/in/jane-smith-1234"
    assert contacts["email"] == "jane.smith@example.com"
    assert contacts["location"] == "Berlin, Germany"
    assert profile.summary == "I build reliable platforms for large teams."
    first, second = profile.experience
    assert (first.role, first.organisation) == ("Staff Engineer", "Cloudy GmbH")
    assert (first.start, first.end, first.current) == ("January 2021", "Present", True)
    assert first.location == "Berlin, Germany"
    assert first.details == "Led the platform team."
    assert (second.role, second.organisation, second.location) == (
        "Senior Engineer",
        "Old Corp",
        "Munich Area",
    )
    assert second.end == "December 2020"
    school = profile.education[0]
    assert school.school == "Technical University of Munich"
    assert school.degree == "Master of Science - MS, Computer Science"
    assert (school.start, school.end) == ("2014", "2016")
    assert [skill.name for skill in profile.skills] == ["Kubernetes", "Go", "Distributed Systems"]
    assert [(item.name, item.level) for item in profile.languages] == [
        ("English", 5),
        ("Turkish", 3),
    ]
    every = " ".join(
        [profile.summary, *(item.details for item in profile.experience)]
        + [item.school + item.degree for item in profile.education]
    )
    assert "Page" not in every


def test_soft_hyphens_and_no_break_spaces_read_as_plain_text(tmp_path: Path) -> None:
    rows = [
        (60, "Jordan Rivera", 24, True),
        (90, "Experience", 14, True),
        (110, "Lead Designer, Northwind", 11, True),
        (126, "Mar 2021 ­ Present", 10, False),
        (142, "­ Shipped a design sys­tem", 10, False),
    ]

    result = _run(_single(tmp_path / "soft.pdf", rows))

    entry = result.profile.experience[0]
    assert result.profile.name == "Jordan Rivera"
    assert entry.start == "Mar 2021"
    assert entry.current is True
    assert "Shipped a design system" in entry.details
    assert "­" not in entry.details


def test_image_only_pdf_has_no_text(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    pixmap.clear_with(200)
    page.insert_image(pymupdf.Rect(50, 50, 250, 250), pixmap=pixmap)
    path = _save(document, tmp_path / "scan.pdf")
    with pytest.raises(OpError) as caught:
        _run(path)
    assert caught.value.code == ErrorCode.UNSUPPORTED
    assert caught.value.data == {"reason": "noText"}


def test_encrypted_pdf_needs_password(tmp_path: Path) -> None:
    path = _single(
        tmp_path / "locked.pdf",
        ENGLISH,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw="owner-secret",
        user_pw="secret",
    )
    with pytest.raises(OpError) as caught:
        _run(path)
    assert caught.value.code == ErrorCode.NEEDS_PASSWORD
    assert _run(path, "secret").profile.name == "Jane Doe"


def test_not_a_pdf(tmp_path: Path) -> None:
    path = tmp_path / "cv.pdf"
    path.write_bytes(b"this is not a pdf at all")
    with pytest.raises(OpError) as caught:
        _run(path)
    assert caught.value.code == ErrorCode.INVALID_PDF


def test_missing_file(tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        _run(tmp_path / "absent.pdf")
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND
