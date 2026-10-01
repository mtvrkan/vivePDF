import base64
import io
import shutil
import urllib.request
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.convert import ExtractImagesParams, extract_images
from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.letterhead import LetterheadParams, letterhead
from vivepdf.ops.links import (
    LinksAddParams,
    LinksListParams,
    LinksRemoveParams,
    add_links,
    list_links,
    remove_links,
)
from vivepdf.ops.merge_split import MergeInput, MergeParams, merge
from vivepdf.ops.metadata import SetMetadataParams, set_metadata
from vivepdf.ops.page_numbers import PageNumberParams, number_pages, render_page_label
from vivepdf.ops.pages import InsertFromParams, insert_from
from vivepdf.ops.rotate import AutoRotateParams, DetectRotationParams, auto_rotate, detect_rotation
from vivepdf.ops.textedit import FindReplaceParams, find_replace
from vivepdf.ops.tts import CATALOG, VoiceIdParams, VoicesParams, remove, split_sentences, voices
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

VOICE_DIR = Path(
    r"C:\Users\PC\AppData\Local\Temp\claude\C--Users-PC-Desktop-pdf\e21c4049-6faa-4092-8baa-b59375e0e380\scratchpad\piper"
)


def _png_base64(color=(200, 30, 30)) -> str:
    image = Image.new("RGBA", (120, 60), (*color, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_editor_places_text_and_image(sample_pdf: Path, tmp_path: Path) -> None:
    result = apply(
        EditorApplyParams(
            path=str(sample_pdf),
            output=str(tmp_path / "edited.pdf"),
            objects=[
                {
                    "kind": "text",
                    "page": 1,
                    "x0": 72,
                    "y0": 300,
                    "x1": 400,
                    "y1": 340,
                    "text": "Eklenen başlık",
                    "fontSize": 18,
                    "bold": True,
                },
                {
                    "kind": "image",
                    "page": 2,
                    "x0": 100,
                    "y0": 100,
                    "x1": 220,
                    "y1": 160,
                    "pngBase64": _png_base64(),
                },
            ],
        ),
        silent_progress(),
    )
    assert result.applied == 2
    with pymupdf.open(result.output) as document:
        assert "Eklenen başlık" in document[0].get_text()
        assert len(document[1].get_images()) == 1


def test_editor_in_place_rewrites_file(sample_pdf: Path) -> None:
    before = sample_pdf.stat().st_size
    result = apply(
        EditorApplyParams(
            path=str(sample_pdf),
            in_place=True,
            objects=[
                {
                    "kind": "text",
                    "page": 3,
                    "x0": 72,
                    "y0": 200,
                    "x1": 300,
                    "y1": 230,
                    "text": "Yerinde",
                }
            ],
        ),
        silent_progress(),
    )
    assert result.output == str(sample_pdf) and sample_pdf.stat().st_size != before
    with pymupdf.open(sample_pdf) as document:
        assert "Yerinde" in document[2].get_text()


def test_links_add_list_remove(sample_pdf: Path) -> None:
    added = add_links(
        LinksAddParams(
            path=str(sample_pdf),
            links=[
                {"page": 1, "x0": 72, "y0": 60, "x1": 200, "y1": 90, "uri": "https://vivepdf.test"},
                {"page": 1, "x0": 72, "y0": 100, "x1": 200, "y1": 130, "targetPage": 3},
            ],
        ),
        silent_progress(),
    )
    assert added.changed == 2
    listed = list_links(LinksListParams(path=str(sample_pdf)), silent_progress())
    kinds = sorted(item.kind for item in listed.items)
    assert kinds == ["page", "uri"]
    uri_item = next(item for item in listed.items if item.kind == "uri")
    assert uri_item.uri == "https://vivepdf.test" and uri_item.rect[0] == 72
    removed = remove_links(
        LinksRemoveParams(path=str(sample_pdf), items=[{"page": 1, "xref": uri_item.xref}]),
        silent_progress(),
    )
    assert removed.changed == 1
    assert list_links(LinksListParams(path=str(sample_pdf)), silent_progress()).count == 1


def test_set_metadata_in_place(sample_pdf: Path) -> None:
    result = set_metadata(
        SetMetadataParams(path=str(sample_pdf), title="Yeni Başlık", keywords="a, b", author=""),
        silent_progress(),
    )
    assert result.metadata["title"] == "Yeni Başlık" and result.metadata["author"] == ""
    with pymupdf.open(sample_pdf) as document:
        assert (
            document.metadata["title"] == "Yeni Başlık" and document.metadata["keywords"] == "a, b"
        )


def test_extract_images_writes_files(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    image = Image.new("RGB", (300, 200), (10, 120, 200))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    page.insert_image(pymupdf.Rect(50, 50, 350, 250), stream=buffer.getvalue())
    tiny = Image.new("RGB", (8, 8), (0, 0, 0))
    tiny_buffer = io.BytesIO()
    tiny.save(tiny_buffer, format="PNG")
    page.insert_image(pymupdf.Rect(400, 50, 408, 58), stream=tiny_buffer.getvalue())
    path = tmp_path / "imgs.pdf"
    document.save(path)
    document.close()
    result = extract_images(
        ExtractImagesParams(path=str(path), output_dir=str(tmp_path / "out")), silent_progress()
    )
    assert result.count == 1 and result.skipped == 1
    assert Path(result.outputs[0]).suffix in (".jpg", ".jpeg")
    with Image.open(result.outputs[0]) as saved:
        assert saved.size == (300, 200)


def test_detect_and_auto_rotate_text_pages(tmp_path: Path) -> None:
    document = pymupdf.open()
    for rotation in (0, 90, 180):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 100), "Bu sayfa metin yönü testi için yazılmıştır", fontname="helv")
        page.insert_text((72, 140), "İkinci satır burada devam ediyor", fontname="helv")
        page.insert_text((72, 180), "Üçüncü satır da burada", fontname="helv")
        page.set_rotation(rotation)
    path = tmp_path / "rot.pdf"
    document.save(path)
    document.close()
    detected = detect_rotation(DetectRotationParams(path=str(path), ocr=False), silent_progress())
    by_page = {item.page: item.rotation for item in detected.items}
    assert 1 not in by_page and by_page.get(2) in (90, 270) and by_page.get(3) == 180
    assert detected.upright == [1]
    fixed = auto_rotate(
        AutoRotateParams(path=str(path), output=str(tmp_path / "fixed.pdf"), ocr=False),
        silent_progress(),
    )
    assert fixed.rotated == 2
    again = detect_rotation(DetectRotationParams(path=fixed.output, ocr=False), silent_progress())
    assert again.items == []


def test_letterhead_overlay(sample_pdf: Path, tmp_path: Path) -> None:
    template = pymupdf.open()
    page = template.new_page(width=595, height=842)
    page.insert_text((72, 40), "vivePDF A.Ş. antet", fontname="helv")
    template_path = tmp_path / "antet.pdf"
    template.save(template_path)
    template.close()
    result = letterhead(
        LetterheadParams(
            path=str(sample_pdf),
            output=str(tmp_path / "antetli.pdf"),
            template_path=str(template_path),
            pages="2-3",
        ),
        silent_progress(),
    )
    assert result.applied == 2
    with pymupdf.open(result.output) as document:
        assert "antet" not in document[0].get_text()
        assert "antet" in document[1].get_text() and "Page 2" in document[1].get_text()


def test_find_replace_keeps_size_and_counts(sample_pdf: Path, tmp_path: Path) -> None:
    result = find_replace(
        FindReplaceParams(
            path=str(sample_pdf),
            output=str(tmp_path / "replaced.pdf"),
            find="Page",
            replace="Sayfa",
        ),
        silent_progress(),
    )
    assert result.replaced == 3 and result.pages_changed == 3
    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
        assert "Sayfa" in text and "Page" not in text
        spans = [
            span
            for block in document[0].get_text("dict")["blocks"]
            for line in block.get("lines", [])
            for span in line.get("spans", [])
            if "Sayfa" in span["text"]
        ]
        assert spans and 10 <= spans[0]["size"] <= 12


def test_insert_from_and_mixed_merge(sample_pdf: Path, tmp_path: Path) -> None:
    other = pymupdf.open()
    other.new_page().insert_text((72, 72), "Diger belge", fontname="helv")
    other_path = tmp_path / "other.pdf"
    other.save(other_path)
    other.close()
    inserted = insert_from(
        InsertFromParams(path=str(sample_pdf), source_path=str(other_path), source_pages=[1], at=2),
        silent_progress(),
    )
    assert inserted.inserted == 1 and inserted.page_count == 4
    with pymupdf.open(sample_pdf) as document:
        assert "Diger belge" in document[1].get_text()

    picture = tmp_path / "foto.png"
    Image.new("RGB", (400, 300), (30, 30, 30)).save(picture)
    merged = merge(
        MergeParams(
            inputs=[MergeInput(path=str(other_path)), MergeInput(path=str(picture))],
            output=str(tmp_path / "mixed.pdf"),
        ),
        silent_progress(),
    )
    assert merged.page_count == 2
    with pymupdf.open(merged.output) as document:
        assert len(document[1].get_images()) == 1


def test_bates_numbering(sample_pdf: Path, tmp_path: Path) -> None:
    assert render_page_label("{n}", 7, 9, "ABC-", 6) == "ABC-000007"
    result = number_pages(
        PageNumberParams(
            path=str(sample_pdf),
            output=str(tmp_path / "bates.pdf"),
            template="{n}",
            prefix="DAVA-",
            padding=5,
            start=41,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert "DAVA-00041" in document[0].get_text() and "DAVA-00043" in document[2].get_text()


def test_tts_catalog_lists_turkish_voices(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path))
    result = voices(VoicesParams(), silent_progress())
    ids = [item.id for item in result.voices]
    assert "tr_TR-fettah-medium" in ids and len(ids) == len(CATALOG)
    assert all(not item.installed for item in result.voices)


def test_tts_synthesize_with_local_voice(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    if not (VOICE_DIR / "tr.onnx").exists():
        pytest.skip("no local Piper voice available")
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path))
    from vivepdf.ops import tts

    target = tmp_path / "tts"
    target.mkdir()
    shutil.copy(VOICE_DIR / "tr.onnx", target / "tr_TR-fettah-medium.onnx")
    shutil.copy(VOICE_DIR / "tr.onnx.json", target / "tr_TR-fettah-medium.onnx.json")
    tts.clear_voice_cache()
    listed = voices(VoicesParams(), silent_progress())
    assert (
        next(item for item in listed.voices if item.id == "tr_TR-fettah-medium").installed is True
    )
    result = tts.synthesize(
        tts.SynthesizeParams(voice_id="tr_TR-fettah-medium", text="Merhaba dünya.", rate=1.2),
        silent_progress(),
    )
    assert result.sample_rate == 22050 and result.duration_ms > 300
    assert base64.b64decode(result.wav_base64)[:4] == b"RIFF"


def test_tts_catalog_includes_fahrettin_with_checksum() -> None:
    entry = next(item for item in CATALOG if item.id == "tr_TR-fahrettin-medium")
    assert entry.checksum_md5 == "3ab8730ec3a132c79c74a45c451372f8"


def test_tts_split_sentences_guards_abbreviations() -> None:
    result = split_sentences("Dr. Smith went home. He was tired!")
    assert result == ["Dr. Smith went home.", "He was tired!"]


def test_tts_split_sentences_handles_turkish_question() -> None:
    result = split_sentences("Merhaba dünya. Nasılsın?")
    assert result == ["Merhaba dünya.", "Nasılsın?"]


def test_tts_split_sentences_caps_long_sentence() -> None:
    long_sentence = " ".join(["kelime"] * 100) + "."
    result = split_sentences(long_sentence, max_chars=50)
    assert all(len(chunk) <= 50 for chunk in result)
    assert "".join(result).replace(" ", "") == long_sentence.replace(" ", "")


def test_tts_remove_rejects_unknown_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path))
    with pytest.raises(OpError) as excinfo:
        remove(VoiceIdParams(id="../../etc/passwd"), silent_progress())
    assert excinfo.value.code == ErrorCode.INVALID_PARAMS


def test_tts_remove_rejects_path_escaping_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path))
    with pytest.raises(OpError) as excinfo:
        remove(VoiceIdParams(id="tr_TR-fettah-medium/../../evil"), silent_progress())
    assert excinfo.value.code == ErrorCode.INVALID_PARAMS


def test_tts_assert_trusted_url_blocks_untrusted_host() -> None:
    from vivepdf.ops.tts import _assert_trusted_url

    with pytest.raises(OpError) as excinfo:
        _assert_trusted_url("https://evil.example.com/voice.onnx")
    assert excinfo.value.data["reason"] == "untrustedHost"


def test_tts_assert_trusted_url_blocks_http_scheme() -> None:
    from vivepdf.ops.tts import _assert_trusted_url

    with pytest.raises(OpError):
        _assert_trusted_url("http://huggingface.co/voice.onnx")


def test_tts_assert_trusted_url_allows_hf_cdn_hosts() -> None:
    from vivepdf.ops.tts import _assert_trusted_url

    _assert_trusted_url("https://cdn-lfs-us-1.huggingface.co/voice.onnx")
    _assert_trusted_url("https://huggingface.co/voice.onnx")


def test_tts_redirect_handler_blocks_untrusted_redirect() -> None:
    from vivepdf.ops.tts import _AllowlistRedirectHandler

    handler = _AllowlistRedirectHandler()
    with pytest.raises(OpError):
        handler.redirect_request(
            urllib.request.Request("https://huggingface.co/a"),
            None,
            302,
            "Found",
            {},
            "https://malicious.example.com/voice.onnx",
        )
