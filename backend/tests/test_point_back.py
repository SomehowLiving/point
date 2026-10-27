"""Point back: splitting the answer from its highlight list, and locating quoted text on screen."""
from point_back import DELIMITER, StreamSplitter, locate, parse_block, resolve, strip_unmatched_markers


def word(text, x, y, w=None, h=20, conf=0.9):
    return {"text": text, "confidence": conf, "box": {"x": x, "y": y, "width": w or 12 * len(text), "height": h}}


def test_splitter_never_shows_the_delimiter_even_when_split_across_chunks():
    splitter = StreamSplitter()
    answer = "The bug is in the return line ⟦1⟧."
    payload = '{"highlights": [{"id": 1, "text": "return total / len(nums)"}]}'
    stream = answer + "\n" + DELIMITER + payload
    shown = "".join(splitter.feed(stream[i:i + 3]) for i in range(0, len(stream), 3))
    rest, block = splitter.finish()
    shown += rest
    assert DELIMITER not in shown and "<<<" not in shown
    assert shown.strip() == answer
    assert parse_block(block) == [{"id": 1, "text": "return total / len(nums)"}]


def test_splitter_passes_text_through_when_there_is_no_list():
    splitter = StreamSplitter()
    shown = splitter.feed("Plain answer with < and << in it.")
    rest, block = splitter.finish()
    assert shown + rest == "Plain answer with < and << in it."
    assert block == ""


def test_parse_block_tolerates_fences_and_junk():
    assert parse_block('```json\n{"highlights": [{"id": "2", "text": " Save "}]}\n```') == [{"id": 2, "text": "Save"}]
    assert parse_block("not json") == []
    assert parse_block('{"highlights": [{"id": "x", "text": "a"}, {"id": 3}]}') == []


def test_locate_matches_a_phrase_along_a_line_despite_ocr_errors():
    words = [word("def", 40, 10), word("average(nums):", 90, 10),
             word("return", 70, 130), word("tota1", 150, 130), word("/", 216, 130, w=8), word("len(nums)", 232, 130)]
    box = locate("return total / len(nums)", words, (1000, 500))
    assert box is not None and box["score"] == 1.0
    assert abs(box["y"] - 130 / 500) < 1e-6
    assert abs(box["x"] - 70 / 1000) < 1e-6 and abs((box["x"] + box["width"]) - (232 + 108) / 1000) < 1e-6


def test_locate_prefers_the_match_inside_the_users_selection():
    words = [word("Save", 50, 20), word("Save", 600, 400)]
    selection = [{"x": 0.5, "y": 0.7, "width": 0.3, "height": 0.2}]
    box = locate("Save", words, (1000, 500), selection)
    assert abs(box["x"] - 0.6) < 1e-6


def test_locate_rejects_text_that_is_not_on_screen():
    assert locate("Export as PDF", [word("Save", 50, 20), word("Cancel", 120, 20)], (1000, 500)) is None


def test_resolve_and_strip_unmatched_markers():
    ocr = {"image": {"width": 1000, "height": 500}, "words": [word("Save", 50, 20)]}
    found = resolve([{"id": 1, "text": "Save"}, {"id": 2, "text": "Delete forever"}], ocr, [])
    assert [h["id"] for h in found] == [1]
    assert strip_unmatched_markers("Click Save ⟦1⟧, not Delete ⟦2⟧.", [1]) == "Click Save ⟦1⟧, not Delete ."


def test_echoed_reference_lists_are_removed_from_the_answer():
    from point_back import clean_answer
    answer = 'Change the return line \u27e61\u27e7.\n\n\u27e61\u27e7: "return total / len(nums)"\n- [2] = "Save"'
    assert clean_answer(answer) == "Change the return line \u27e61\u27e7."
    assert clean_answer("Keep [1] mid-sentence references and lists:\n- item one") == "Keep [1] mid-sentence references and lists:\n- item one"


def test_ocr_running_words_together_still_matches():
    words = [word("Save", 40, 300), word("draft", 95, 300), word("sendinvoice", 300, 300, w=110)]
    box = locate("Send invoice", words, (1000, 500))
    assert box is not None and abs(box["x"] - 0.3) < 1e-6


def test_screen_words_reads_small_button_text():
    import base64, io
    from PIL import Image, ImageDraw, ImageFont
    from point_back import screen_words
    image = Image.new("RGB", (900, 200), (243, 243, 243)); draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("arial.ttf", 13)
    for x, label in [(40, "Save draft"), (200, "Preview PDF")]:
        draw.rectangle([x - 12, 80, x + 100, 110], fill=(255, 255, 255), outline=(170, 170, 170))
        draw.text((x, 88), label, font=font, fill=(30, 30, 30))
    buffer = io.BytesIO(); image.save(buffer, "PNG")
    ocr = screen_words(buffer.getvalue())
    assert ocr["image"] == {"width": 900, "height": 200}
    assert locate("Preview PDF", ocr["words"], (900, 200)) is not None


def test_icons_without_text_fall_back_to_an_approximate_box():
    items = parse_block('{"highlights": [{"id": 1, "text": "Save"}, {"id": 2, "box": [0.9, 0.02, 0.03, 0.04]}, {"id": 3, "box": [0, 0, 0.9, 0.9]}]}')
    assert [i["id"] for i in items] == [1, 2]  # a box covering most of the screen is rejected
    ocr = {"image": {"width": 1000, "height": 500}, "words": [word("Save", 50, 20)]}
    found = {h["id"]: h for h in resolve(items, ocr, [])}
    assert found[1]["approximate"] is False
    assert found[2]["approximate"] is True and found[2]["box"]["x"] == 0.9


def test_text_found_on_screen_beats_a_model_box():
    items = [{"id": 1, "text": "Save", "box": {"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.1}}]
    ocr = {"image": {"width": 1000, "height": 500}, "words": [word("Save", 50, 20)]}
    (hit,) = resolve(items, ocr, [])
    assert hit["approximate"] is False and abs(hit["box"]["x"] - 0.05) < 1e-6
