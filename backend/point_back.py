"""Point back: the answer highlights the on-screen things it talks about.

The model marks references in its answer as ⟦1⟧, ⟦2⟧ and, after a delimiter line, lists the exact
visible text each one refers to. That quoted text is located with OCR word boxes from the real
screenshot, so a highlight lands on actual text positions rather than on a pixel guess from the
model. Things without visible text (bare icons) are not highlighted in this version.
"""
import json
import re
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Sequence, Tuple

DELIMITER = "<<<POINT_BACK>>>"
MAX_HIGHLIGHTS = 6
MIN_SCORE = 0.6

INSTRUCTIONS = (
    "\nPOINT BACK: the user will see numbered highlights drawn on their screen for the things your answer "
    "refers to. In the answer, put a marker like ⟦1⟧ right after the mention of each on-screen thing the "
    "user should look at, click, or change: for example the exact line of code to fix, the button to "
    "press, the field to fill, or the value that is wrong. These can be anywhere in the full screenshot, "
    "not only inside the selection. Prefer the most actionable thing; skip things that are merely "
    f"context. Use at most {MAX_HIGHLIGHTS} markers. "
    f"After the complete answer, output a line containing exactly {DELIMITER} followed by JSON only: "
    '{"highlights": [{"id": 1, "text": "<the text exactly as it appears on screen for that thing, '
    'copied character for character, 1-8 words>"}]}. For a thing with NO readable text (an icon, an '
    'image, a colour swatch), give instead "box": [x, y, width, height] as fractions 0-1 of Image 1 (the '
    'full screenshot), e.g. {"id": 2, "box": [0.91, 0.02, 0.03, 0.04]}; always prefer "text" when the '
    "thing has any visible text. If nothing should be highlighted, output "
    f'{DELIMITER} and {{"highlights": []}}. Do NOT list, explain, or repeat the markers or their texts in '
    "the answer itself; the list after the delimiter is hidden from the user.\n"
)

_MARKER = re.compile(r"⟦\s*(\d+)\s*⟧")


class StreamSplitter:
    """Separates the visible answer from the trailing highlight list while text streams in.

    feed() returns only text that is safe to show: anything that might be the start of the
    delimiter is held back until it's clear it isn't.
    """

    def __init__(self) -> None:
        self.full = ""
        self.sent = 0

    def feed(self, chunk: str) -> str:
        self.full += chunk
        cut = self.full.find(DELIMITER)
        if cut >= 0:
            visible_end = cut
        else:
            visible_end = len(self.full)
            for keep in range(len(DELIMITER) - 1, 0, -1):
                if self.full.endswith(DELIMITER[:keep]):
                    visible_end = len(self.full) - keep
                    break
        out = self.full[self.sent:visible_end] if visible_end > self.sent else ""
        self.sent = max(self.sent, visible_end)
        return out

    def finish(self) -> Tuple[str, str]:
        """(remaining visible text, raw highlight block)."""
        cut = self.full.find(DELIMITER)
        visible_end = cut if cut >= 0 else len(self.full)
        rest = self.full[self.sent:visible_end]
        self.sent = visible_end
        block = self.full[cut + len(DELIMITER):] if cut >= 0 else ""
        return rest, block


def parse_block(block: str) -> List[dict]:
    """The model's highlight list; tolerant of code fences and surrounding prose."""
    start, end = block.find("{"), block.rfind("}")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(block[start:end + 1])
    except ValueError:
        return []
    items = data.get("highlights") if isinstance(data, dict) else None
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        try:
            number = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        text = str(item.get("text") or "").strip()
        box = _valid_box(item.get("box"))
        if text or box:
            entry = {"id": number, "text": text[:200]}
            if box:
                entry["box"] = box
            out.append(entry)
    return out[:MAX_HIGHLIGHTS]


def _valid_box(value) -> Optional[dict]:
    """A model-given [x, y, w, h] (fractions of the screenshot), or None if it isn't usable."""
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        x, y, w, h = (float(v) for v in value)
    except (TypeError, ValueError):
        return None
    if not (0 <= x < 1 and 0 <= y < 1 and 0 < w <= 0.5 and 0 < h <= 0.5):
        return None  # a box covering half the screen isn't pointing at anything
    return {"x": x, "y": y, "width": min(w, 1 - x), "height": min(h, 1 - y)}


# Models sometimes echo their reference list into the visible answer as lines like
# '⟦1⟧: "$ python app.py"' or '[1] "Save"'. Those lines are noise once the highlight is drawn.
_LEGEND_LINE = re.compile(r"^\s*(?:[-*]\s*)?(?:⟦\s*\d+\s*⟧|\[\d+\])\s*[:=\-–—]\s*.*$", re.M)


def clean_answer(answer: str) -> str:
    """Remove echoed reference-list lines from the visible answer."""
    return re.sub(r"\n{3,}", "\n\n", _LEGEND_LINE.sub("", answer)).strip()


def strip_unmatched_markers(answer: str, kept_ids: Sequence[int]) -> str:
    """Drop ⟦n⟧ markers that have no highlight, so the answer never shows a dangling chip."""
    kept = set(kept_ids)
    return _MARKER.sub(lambda m: m.group(0) if int(m.group(1)) in kept else "", clean_answer(answer))


def _norm(token: str) -> str:
    return re.sub(r"[^0-9a-z]+", "", token.lower())


def _tokens(text: str) -> List[str]:
    return [t for t in (_norm(raw) for raw in text.split()) if t]


def _similar(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) <= 2:
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.8


def _inside_any(box: dict, regions: Sequence[dict], size: Tuple[int, int]) -> bool:
    w, h = size
    cx, cy = (box["x"] + box["width"] / 2) / w, (box["y"] + box["height"] / 2) / h
    return any(r["x"] <= cx <= r["x"] + r["width"] and r["y"] <= cy <= r["y"] + r["height"] for r in regions)


def locate(text: str, words: Sequence[dict], size: Tuple[int, int], regions: Sequence[dict] = ()) -> Optional[dict]:
    """Best on-screen box for a quoted phrase, as a normalized {x, y, width, height}, or None.

    Walks OCR words left to right along a line: a candidate starts at a word similar to the first
    quoted token and extends to the next word on the same line while tokens keep matching.
    Score = matched tokens / quoted tokens. Ties prefer matches inside the user's selection, then
    higher OCR confidence.
    """
    wanted = _tokens(text)
    if not wanted or not words:
        return None
    entries = [(w, _norm(w["text"])) for w in words]
    entries = [(w, t) for w, t in entries if t]

    def same_line_next(word: dict) -> List[Tuple[dict, str]]:
        b = word["box"]
        mid = b["y"] + b["height"] / 2
        candidates = [
            (w, t) for w, t in entries
            if w is not word
            and abs((w["box"]["y"] + w["box"]["height"] / 2) - mid) <= max(b["height"], w["box"]["height"]) * 0.6
            and 0 <= w["box"]["x"] - (b["x"] + b["width"]) <= max(b["height"], 8) * 3
        ]
        return sorted(candidates, key=lambda e: e[0]["box"]["x"])

    def consume(token: str, start: int) -> int:
        """How many quoted tokens, from `start`, this OCR word covers (0 if none). OCR often runs
        neighbouring words together ("Send invoice" -> "sendinvoice"), so up to 3 joined tokens count."""
        for span in (1, 2, 3):
            if start + span <= len(wanted) and _similar(token, "".join(wanted[start:start + span])):
                return span
        return 0

    best = None
    for word, token in entries:
        first = consume(token, 0)
        if not first:
            continue
        chain, index = [word], first
        while index < len(wanted):
            following = same_line_next(chain[-1])
            step = consume(following[0][1], index) if following else 0
            if not step:
                break
            chain.append(following[0][0])
            index += step
        score = index / len(wanted)
        if score < MIN_SCORE:
            continue
        x0 = min(w["box"]["x"] for w in chain)
        y0 = min(w["box"]["y"] for w in chain)
        x1 = max(w["box"]["x"] + w["box"]["width"] for w in chain)
        y1 = max(w["box"]["y"] + w["box"]["height"] for w in chain)
        box = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
        rank = (score, _inside_any(box, regions, size), sum(w.get("confidence", 0) for w in chain) / len(chain))
        if best is None or rank > best[0]:
            best = (rank, box)
    if best is None:
        return None
    width, height = size
    b = best[1]
    return {"x": b["x"] / width, "y": b["y"] / height, "width": b["width"] / width, "height": b["height"] / height, "score": round(best[0][0], 2)}


def resolve(items: Sequence[dict], ocr: Optional[dict], regions: Sequence[dict]) -> List[dict]:
    """Highlights that were found on screen: [{id, text, box, approximate}].

    Quoted text is located with OCR word boxes (exact). A model-given box is used only when there's
    no text, or the text can't be found on screen, and is flagged approximate so the UI can show it
    differently: models are much less precise with coordinates than OCR is.
    """
    words = (ocr or {}).get("words") or []
    size = ((ocr or {}).get("image") or {}).get("width"), ((ocr or {}).get("image") or {}).get("height")
    found = []
    for item in items:
        box = locate(item["text"], words, size, regions) if item.get("text") and words and all(size) else None
        if box:
            found.append({"id": item["id"], "text": item["text"], "box": box, "approximate": False})
        elif item.get("box"):
            found.append({"id": item["id"], "text": item["text"], "box": item["box"], "approximate": True})
    return found


def screen_words(raw: bytes) -> Optional[dict]:
    """OCR tuned for finding UI text anywhere on a screenshot.

    Upscaling 2x in grayscale is what lets Tesseract read small interface text such as button
    labels, which it mostly misses at native screen resolution (3x is worse again). Boxes are
    mapped back to original pixels. Returns the same shape resolve() expects.
    """
    import io
    import pytesseract
    from PIL import Image, ImageOps
    from pytesseract import Output

    image = ImageOps.grayscale(Image.open(io.BytesIO(raw)))
    width, height = image.size
    scale = 2 if max(width, height) <= 4096 else 1
    if scale != 1:
        image = image.resize((width * scale, height * scale), Image.Resampling.LANCZOS)
    data = pytesseract.image_to_data(image, config="--psm 11", output_type=Output.DICT)
    words = []
    for index, raw_text in enumerate(data["text"]):
        text = raw_text.strip()
        try:
            confidence = float(data["conf"][index]) / 100
        except (TypeError, ValueError):
            continue
        if not text or confidence < 0:
            continue
        words.append({
            "text": text,
            "confidence": round(max(0.0, min(1.0, confidence)), 4),
            "box": {
                "x": round(data["left"][index] / scale), "y": round(data["top"][index] / scale),
                "width": max(1, round(data["width"][index] / scale)), "height": max(1, round(data["height"][index] / scale)),
            },
        })
    return {"words": words, "image": {"width": width, "height": height}}
