"""Turn the user's selections into images the model can't misread.

Sending a full screenshot plus selection coordinates as numbers leaves the model to map numbers to
pixels, which many models do badly: they answer about whatever is most prominent on screen instead
of what was selected. So for each source we send:

- an overview: the screenshot with every selection outlined and numbered (points get a marker),
- one close-up per selection: a padded crop; a freeform (lasso) selection has its outline traced
  and everything outside it dimmed.

The model is told which image is which, so "look at close-up 2" is an instruction it can follow.
"""
import base64
import io
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFont

HIGHLIGHT = (255, 0, 200)  # magenta: rare in real UIs, so the outline can't be mistaken for content
OVERVIEW_MAX_SIDE = 2048   # close-ups carry the detail, so the overview can be smaller
CLOSEUP_MAX_SIDE = 1600
CLOSEUP_MIN_SIDE = 384     # tiny selections are upscaled so their text is legible
POINT_CROP = 0.12          # a point's close-up covers this fraction of the image's shorter side


@dataclass
class FocusImage:
    description: str
    png_base64: str


def _load(raw: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(raw))
    image.load()
    return image.convert("RGB")


def _encode(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def _font(size: int):
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _box_px(box: dict, size: Tuple[int, int]) -> Tuple[int, int, int, int]:
    w, h = size
    x0, y0 = int(round(box["x"] * w)), int(round(box["y"] * h))
    x1, y1 = int(round((box["x"] + box["width"]) * w)), int(round((box["y"] + box["height"]) * h))
    return max(0, x0), max(0, y0), min(w, max(x1, x0 + 1)), min(h, max(y1, y0 + 1))


def mask_for_region(region: dict, annotations: Sequence[dict], tolerance: float = 0.003) -> Optional[List[dict]]:
    """The freeform outline whose bounding box is this region, if the region came from a lasso."""
    for annotation in annotations:
        points = annotation.get("points") or []
        if annotation.get("type") != "mask" or len(points) < 3:
            continue
        xs, ys = [p["x"] for p in points], [p["y"] for p in points]
        bounds = (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
        target = (region["x"], region["y"], region["width"], region["height"])
        if all(abs(a - b) <= tolerance for a, b in zip(bounds, target)):
            return points
    return None


def _label(draw: ImageDraw.ImageDraw, xy: Tuple[int, int], text: str, size: int) -> None:
    font = _font(size)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    pad = max(2, size // 5)
    x, y = xy
    y = max(0, y - (bottom - top) - pad * 2)
    draw.rectangle([x, y, x + (right - left) + pad * 2, y + (bottom - top) + pad * 2], fill=HIGHLIGHT)
    draw.text((x + pad - left, y + pad - top), text, font=font, fill=(255, 255, 255))


def _overview(image: Image.Image, regions: Sequence[dict], annotations: Sequence[dict], points: Sequence[dict], max_side: int = OVERVIEW_MAX_SIDE) -> Image.Image:
    out = image.copy()
    draw = ImageDraw.Draw(out)
    w, h = out.size
    stroke = max(3, round(min(w, h) / 300))
    label_size = max(14, round(min(w, h) / 45))
    for index, region in enumerate(regions, start=1):
        x0, y0, x1, y1 = _box_px(region, (w, h))
        outline = mask_for_region(region, annotations)
        if outline:
            draw.line([(p["x"] * w, p["y"] * h) for p in outline + outline[:1]], fill=HIGHLIGHT, width=stroke, joint="curve")
        else:
            draw.rectangle([x0, y0, x1, y1], outline=HIGHLIGHT, width=stroke)
        _label(draw, (x0, y0), str(index), label_size)
    for index, point in enumerate(points, start=1):
        cx, cy, r = point["x"] * w, point["y"] * h, stroke * 7
        # A ring around the spot, never a filled dot: the marker must not hide what's pointed at.
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=HIGHLIGHT, width=max(2, stroke // 2))
        _label(draw, (int(cx + r), int(cy - r)), f"P{index}", label_size)
    if max(out.size) > max_side:
        out.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return out


def _fit(crop: Image.Image, max_side: int = CLOSEUP_MAX_SIDE) -> Image.Image:
    w, h = crop.size
    scale = 1.0
    if min(w, h) < CLOSEUP_MIN_SIDE:
        scale = min(CLOSEUP_MIN_SIDE / max(1, min(w, h)), 4.0)
    if max(w, h) * scale > max_side:
        scale = max_side / max(w, h)
    if scale != 1.0:
        crop = crop.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
    return crop


def _region_closeup(image: Image.Image, region: dict, annotations: Sequence[dict], max_side: int = CLOSEUP_MAX_SIDE) -> Image.Image:
    w, h = image.size
    x0, y0, x1, y1 = _box_px(region, (w, h))
    pad = max(12, round(0.08 * max(x1 - x0, y1 - y0)))
    cx0, cy0, cx1, cy1 = max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)
    crop = image.crop((cx0, cy0, cx1, cy1))
    outline = mask_for_region(region, annotations)
    draw_stroke = max(2, round(min(crop.size) / 150))
    if outline:
        polygon = [(p["x"] * w - cx0, p["y"] * h - cy0) for p in outline]
        inside = Image.new("L", crop.size, 0)
        ImageDraw.Draw(inside).polygon(polygon, fill=255)
        dimmed = Image.blend(crop, Image.new("RGB", crop.size, (128, 128, 128)), 0.7)
        crop = Image.composite(crop, dimmed, inside)
        ImageDraw.Draw(crop).line(polygon + polygon[:1], fill=HIGHLIGHT, width=draw_stroke, joint="curve")
    else:
        ImageDraw.Draw(crop).rectangle([x0 - cx0, y0 - cy0, x1 - cx0 - 1, y1 - cy0 - 1], outline=HIGHLIGHT, width=draw_stroke)
    return _fit(crop, max_side)


def _point_closeup(image: Image.Image, point: dict, max_side: int = CLOSEUP_MAX_SIDE) -> Image.Image:
    w, h = image.size
    half = max(40, round(POINT_CROP * min(w, h)))
    cx, cy = point["x"] * w, point["y"] * h
    x0, y0 = max(0, round(cx - half)), max(0, round(cy - half))
    crop = image.crop((x0, y0, min(w, round(cx + half)), min(h, round(cy + half))))
    draw = ImageDraw.Draw(crop)
    r = max(14, round(half / 5))
    px, py = cx - x0, cy - y0
    draw.ellipse([px - r, py - r, px + r, py + r], outline=HIGHLIGHT, width=2)
    return _fit(crop, max_side)


def build_focus_images(
    raw: bytes,
    source_label: str,
    regions: Sequence[dict],
    annotations: Sequence[dict],
    points: Sequence[dict],
    max_closeups: int,
    overview_max_side: int = OVERVIEW_MAX_SIDE,
    closeup_max_side: int = CLOSEUP_MAX_SIDE,
) -> Tuple[FocusImage, List[FocusImage]]:
    """Overview plus up to max_closeups close-ups (selections first, then points)."""
    image = _load(raw)
    if not regions and not points:
        plain = image.copy()
        if max(plain.size) > 4096:
            plain.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
        return FocusImage(f'{source_label}: the full screenshot (no selection was made)', _encode(plain)), []

    overview = FocusImage(
        f"{source_label}: the full screenshot for context, with the user's selections outlined in magenta and "
        "numbered (1, 2, ...) and pointed-at spots marked P1, P2, ...",
        _encode(_overview(image, regions, annotations, points, overview_max_side)),
    )
    closeups: List[FocusImage] = []
    for index, region in enumerate(regions, start=1):
        if len(closeups) >= max_closeups:
            break
        shape = "freeform selection; only the undimmed area inside the magenta outline is selected" if mask_for_region(region, annotations) else "selection, outlined in magenta"
        name = region.get("label") or f"Selection {index}"
        closeups.append(FocusImage(f'{source_label}: close-up of selection {index} ("{name}", {shape})', _encode(_region_closeup(image, region, annotations, closeup_max_side))))
    for index, point in enumerate(points, start=1):
        if len(closeups) >= max_closeups:
            break
        closeups.append(FocusImage(f"{source_label}: close-up around point P{index} (the circled spot is exactly where the user pointed)", _encode(_point_closeup(image, point, closeup_max_side))))
    return overview, closeups
