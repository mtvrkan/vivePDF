from vivepdf.ops._marked_content import scrub_marked_content, text_strings


def _texts(data: bytes) -> list[str]:
    return [text for _start, _end, text in text_strings(data)]


def _mask(text: str) -> str:
    return text.replace("gizli", "#####")


def test_literal_escapes_octal_and_line_continuations_are_decoded() -> None:
    data = b"/Span << /ActualText (a\\(b\\) \\101\\102 c\\\nd \\\\ e) >> BDC EMC"
    assert _texts(data) == ["a(b) AB cd \\ e"]


def test_utf16_hex_and_bom_strings_are_decoded() -> None:
    word = "şifre".encode("utf-16-be").hex()
    assert _texts(f"<< /Alt <FEFF{word}> >> BDC".encode("ascii")) == ["şifre"]


def test_text_operators_comments_and_other_keys_are_left_alone() -> None:
    data = (
        b"% /Alt (gizli) comment\n"
        b"BT (/Alt \\(gizli\\)) Tj [(gizli)] TJ ET\n"
        b"/Span << /Lang (gizli) /MCID 3 >> BDC EMC\n"
        b"/Alt (gizli) Tj\n"
    )
    assert _texts(data) == []
    assert scrub_marked_content(data, _mask) == (data, 0)


def test_inline_image_data_is_skipped() -> None:
    data = b"BI /W 1 /H 1 ID << /Alt (gizli) >> EI\n/P << /E (gizli) >> BDC EMC"
    cleaned, count = scrub_marked_content(data, _mask)
    assert count == 1
    assert cleaned.startswith(b"BI /W 1 /H 1 ID << /Alt (gizli) >> EI\n")
    assert _texts(cleaned[cleaned.index(b"/P") :]) == ["#####"]


def test_only_changed_strings_are_rewritten_and_the_rest_is_byte_identical() -> None:
    data = b"q /P << /Alt (tamam) >> BDC EMC\n/P << /ActualText (bu gizli) >> BDC EMC Q"
    cleaned, count = scrub_marked_content(data, _mask)
    assert count == 1
    assert cleaned.startswith(b"q /P << /Alt (tamam) >> BDC EMC\n/P << /ActualText <FEFF")
    assert cleaned.endswith(b"> >> BDC EMC Q")
    assert _texts(cleaned) == ["tamam", "bu #####"]


def test_truncated_streams_do_not_raise() -> None:
    for data in (b"<< /Alt (gizli", b"<< /Alt <FEFF00", b"BI ID \x00\x01", b"<< /Alt", b"/"):
        text_strings(data)
        scrub_marked_content(data, _mask)
