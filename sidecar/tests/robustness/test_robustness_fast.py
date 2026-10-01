import os

import pytest
import robustness_matrix
from robustness_matrix import Case

pytestmark = pytest.mark.robustness

WORKERS = int(os.environ.get("VIVEPDF_ROBUSTNESS_WORKERS", "4"))

FAST_CASES = [
    Case("attachments.add", "huge_object_number"),
    Case("comments.delete", "huge_object_number"),
    Case("comments.set_resolved", "lying_page_count"),
    Case("repair.run", "cyclic_self_pages"),
    Case("a11y.fix", "pattern_recursive"),
    Case("convert.to_images", "cyclic_kid_is_root"),
    Case("convert.to_docx", "image_jpx_garbage"),
    Case("sign.run", "stream_length_lies"),
    Case("convert.to_xlsx", "xobject_deep_chain"),
    Case("editor.blocks", "font_widths_wrong"),
    Case("forms.data_preview", "valid_rich_base"),
    Case("forms.data_preview", "decompression_bomb"),
    Case("forms.detect", "flip_raw_streams_14"),
    Case("forms.export_data", "annotation_javascript"),
    Case("pages.resize", "zero_width_page"),
    Case("codes.add_qr", "huge_user_unit"),
    Case("pages.crop", "crop_box_outside"),
    Case("attachments.extract", "truncated_rich_0041315"),
    Case("a11y.check", "deep_outline"),
    Case("bookmarks.get", "lying_page_count"),
    Case("compare.run", "huge_media_box"),
    Case("codes.read", "cyclic_kid_is_root"),
    Case("info.get", "empty_file"),
    Case("viewer.prepare", "png_renamed"),
    Case("info.thumbnail", "nul_bytes"),
    Case("pages.rotate", "truncated_raw_0001103"),
    Case("compress.run", "flip_raw_xref_03"),
    Case("security.sanitize", "flip_rich_trailer_04"),
    Case("repair.run", "truncated_rich_0206578"),
    Case("info.text", "flip_raw_streams_05"),
    Case("security.decrypt", "encrypted_aes_256_user_password"),
    Case("security.decrypt", "encrypted_rc4_40_owner_only"),
    Case("pages.extract", "encrypted_aes_128_user_password", with_password=True),
    Case("security.inspect", "encrypt_dictionary_broken"),
    Case("info.get", "encrypt_unknown_handler"),
    Case("security.sanitize", "javascript_open_action"),
    Case("links.list", "launch_action"),
    Case("pages.merge", "javascript_name_tree"),
    Case("convert.to_images", "image_jbig2_garbage"),
    Case("convert.to_images", "image_huge_image_dimensions"),
    Case("info.thumbnail", "image_cyclic_soft_mask"),
    Case("convert.to_text", "font_type3_recursive"),
    Case("textedit.spans", "font_type0_broken"),
    Case("info.thumbnail", "xobject_recursive_mutual"),
    Case("bookmarks.get", "outline_cycle_next"),
    Case("bookmarks.set", "outline_self_child"),
    Case("pages.split", "zero_pages"),
    Case("pages.number", "astronomic_media_box"),
    Case("pages.impose", "negative_media_box"),
    Case("compress.run", "name_emoji"),
    Case("convert.to_markdown", "name_arabic_rtl"),
    Case("pages.rotate", "name_long_150"),
    Case("security.watermark", "name_shell_characters"),
    Case("repair.run", "html_renamed"),
    Case("convert.file_to_pdf", "docx_renamed"),
    Case("pages.insert_from", "truncated_raw_0000809", slot="sourcePath"),
    Case("pages.letterhead", "png_renamed", slot="templatePath"),
    Case("compare.run", "missing_root", slot="pathB"),
    Case("forms.import_data", "random_bytes", slot="dataPath"),
    Case("pages.merge", "encrypted_aes_256_user_password", slot="second"),
    Case("info.get", "ten_thousand_pages"),
    Case("pages.rotate", "ten_thousand_pages"),
    Case("pages.delete", "ten_thousand_pages"),
    Case("pages.reverse", "ten_thousand_pages"),
    Case("compress.run", "ten_thousand_pages"),
    Case("repair.run", "ten_thousand_pages"),
    Case("compare.run", "ten_thousand_pages"),
    Case("security.sanitize", "ten_thousand_pages"),
    Case("pages.number", "ten_thousand_pages"),
    Case("info.thumbnail", "decompression_bomb"),
    Case("convert.to_images", "decompression_bomb"),
    Case("info.text", "decompression_bomb"),
    Case("compress.run", "dangling_object_stream_entry"),
    Case("security.sanitize", "dangling_object_stream_entry"),
]


@pytest.fixture(scope="module")
def fixtures(tmp_path_factory: pytest.TempPathFactory) -> robustness_matrix.Fixtures:
    names = {case.variant for case in FAST_CASES}
    return robustness_matrix.prepare_fixtures(tmp_path_factory.mktemp("fast"), names=names)


def test_the_fast_cases_name_existing_variants_and_operations(
    fixtures: robustness_matrix.Fixtures,
):
    operations = set(robustness_matrix.path_operations())
    assert {case.variant for case in FAST_CASES} <= set(fixtures.variants)
    assert {case.op for case in FAST_CASES} <= operations


def test_every_path_operation_gets_parameters_its_model_accepts(
    fixtures: robustness_matrix.Fixtures, tmp_path
):
    rejected = robustness_matrix.rejected_default_params(fixtures, tmp_path)
    assert not rejected, rejected


def test_hostile_inputs_never_crash_hang_or_leak(fixtures: robustness_matrix.Fixtures):
    outcomes = robustness_matrix.run_matrix(FAST_CASES, fixtures, workers=WORKERS)
    failures = [outcome for outcome in outcomes if outcome.failed]
    assert not failures, robustness_matrix.summarise(outcomes)
