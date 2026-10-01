from vivepdf.ops.fonts import SystemFontsParams, system_fonts
from vivepdf.rpc.progress import silent_progress


def test_system_fonts_shape_and_dedupe():
    result = system_fonts(SystemFontsParams(), silent_progress())
    assert isinstance(result.families, list)
    seen = set()
    for entry in result.families:
        assert entry.family
        assert isinstance(entry.styles, list)
        assert entry.styles == sorted(entry.styles)
        assert entry.family not in seen
        seen.add(entry.family)


def test_system_fonts_styles_are_known_labels():
    result = system_fonts(SystemFontsParams(), silent_progress())
    allowed = {"Regular", "Bold", "Italic", "Bold Italic"}
    for entry in result.families:
        assert set(entry.styles) <= allowed


def test_system_fonts_sorted_by_family():
    result = system_fonts(SystemFontsParams(), silent_progress())
    names = [entry.family.lower() for entry in result.families]
    assert names == sorted(names)
