"""Focus images: the overview + close-ups that make the model look at what the user selected."""
import base64
import io

from PIL import Image

from focus_service import build_focus_images, mask_for_region


def png(width=1000, height=600, color=(255, 255, 255)):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def decode(item):
    return Image.open(io.BytesIO(base64.b64decode(item.png_base64)))


def test_no_selection_sends_just_the_screenshot():
    overview, closeups = build_focus_images(png(), "Primary", [], [], [], max_closeups=5)
    assert closeups == []
    assert "no selection" in overview.description


def test_one_closeup_per_selection_and_point_within_budget():
    regions = [{"id": f"r{i}", "x": 0.1 * i, "y": 0.1, "width": 0.08, "height": 0.1} for i in range(4)]
    points = [{"id": "p1", "x": 0.5, "y": 0.8}]
    _, closeups = build_focus_images(png(), "Primary", regions, [], points, max_closeups=10)
    assert len(closeups) == 5
    assert "point P1" in closeups[-1].description
    _, capped = build_focus_images(png(), "Primary", regions, [], points, max_closeups=2)
    assert len(capped) == 2  # Groq's 5-image limit must hold


def test_small_selection_is_upscaled_and_overview_is_capped():
    # 80x60 px selection (+ padding): upscaled toward 384 px, but never more than 4x (beyond that
    # it only adds blur).
    region = {"id": "r", "x": 0.5, "y": 0.5, "width": 0.02, "height": 0.02}
    overview, (closeup,) = build_focus_images(png(4000, 3000), "Primary", [region], [], [], max_closeups=3)
    assert min(decode(closeup).size) >= 4 * 80
    assert max(decode(overview).size) <= 2048
    medium = {"id": "m", "x": 0.5, "y": 0.5, "width": 0.05, "height": 0.05}  # 200x150 px
    _, (closeup,) = build_focus_images(png(4000, 3000), "Primary", [medium], [], [], max_closeups=3)
    assert min(decode(closeup).size) >= 384


def test_selection_is_outlined_in_the_overview():
    region = {"id": "r", "x": 0.2, "y": 0.2, "width": 0.4, "height": 0.4}
    overview, _ = build_focus_images(png(), "Primary", [region], [], [], max_closeups=3)
    image = decode(overview).convert("RGB")
    left_edge = image.getpixel((int(0.2 * image.width) + 1, int(0.4 * image.height)))
    assert left_edge == (255, 0, 200)


def test_freeform_closeup_dims_outside_the_outline():
    ring = [{"x": 0.3 + 0.2 * dx, "y": 0.3 + 0.2 * dy} for dx, dy in [(0, 0.5), (0.5, 0), (1, 0.5), (0.5, 1)]]  # a diamond
    region = {"id": "f", "x": 0.3, "y": 0.3, "width": 0.2, "height": 0.2}
    mask = {"id": "m", "type": "mask", "points": ring}
    _, (closeup,) = build_focus_images(png(), "Primary", [region], [mask], [], max_closeups=3)
    assert "freeform" in closeup.description
    image = decode(closeup).convert("RGB")
    assert image.getpixel((image.width // 2, image.height // 2)) == (255, 255, 255)  # inside: untouched
    assert image.getpixel((2, 2)) != (255, 255, 255)  # corner, outside the diamond: dimmed


def test_mask_matches_only_its_own_region():
    ring = [{"x": 0.1, "y": 0.1}, {"x": 0.3, "y": 0.1}, {"x": 0.2, "y": 0.4}]
    mask = {"id": "m", "type": "mask", "points": ring}
    assert mask_for_region({"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.3}, [mask]) == ring
    assert mask_for_region({"x": 0.5, "y": 0.5, "width": 0.2, "height": 0.3}, [mask]) is None
