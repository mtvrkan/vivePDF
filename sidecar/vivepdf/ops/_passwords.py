import pymupdf


def saslprepped(value: str) -> str | None:
    if not value:
        return value
    from pyhanko.pdf_utils.crypt._saslprep import saslprep

    try:
        return saslprep(value)
    except ValueError:
        return None


def password_variants(value: str) -> list[str]:
    variants = [value]
    prepared = saslprepped(value)
    if prepared is not None and prepared != value:
        variants.append(prepared)
    return variants


def matching_password(document: pymupdf.Document, value: str | None) -> tuple[int, str | None]:
    if value is None:
        return 0, None
    for variant in password_variants(value):
        granted = int(document.authenticate(variant))
        if granted:
            return granted, variant
    return 0, None


def authenticate_password(document: pymupdf.Document, value: str | None) -> int:
    return matching_password(document, value)[0]
