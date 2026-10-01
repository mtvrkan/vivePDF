NAME_DELIMITERS = b"()<>[]{}/%#"


def pdf_name(text: str) -> str:
    encoded = []
    for byte in text.encode("utf-8"):
        if byte < 0x21 or byte > 0x7E or byte in NAME_DELIMITERS:
            encoded.append(f"#{byte:02X}")
        else:
            encoded.append(chr(byte))
    return "/" + "".join(encoded)
