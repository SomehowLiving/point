import io
import json
import logging
import os
import subprocess
import sys
import tempfile
import threading
from typing import Any, Dict, List, Tuple

import numpy as np
import pytesseract
from PIL import Image
from pytesseract import Output


logger = logging.getLogger(__name__)
_paddle_lock = threading.Lock()


def _regions(image: Image.Image, regions: List[Dict[str, Any]]) -> List[Tuple[Image.Image, int, int, int]]:
    if not regions:
        return [(image, 0, 0, 0)]
    crops = []
    for index, region in enumerate(regions):
        left = max(0, round(region["x"] * image.width))
        top = max(0, round(region["y"] * image.height))
        right = min(image.width, round((region["x"] + region["width"]) * image.width))
        bottom = min(image.height, round((region["y"] + region["height"]) * image.height))
        if right > left and bottom > top:
            crops.append((image.crop((left, top, right, bottom)), left, top, index))
    return crops or [(image, 0, 0, 0)]


def _lines(words: List[Dict[str, Any]]) -> List[str]:
    grouped: Dict[str, List[str]] = {}
    for word in words:
        key = word.get("line_key", str(word.get("region", 0)))
        grouped.setdefault(key, []).append(word["text"])
    return [" ".join(values) for values in grouped.values() if values]


def _tesseract(image: Image.Image, regions: List[Dict[str, Any]], language: str) -> Dict[str, Any]:
    words: List[Dict[str, Any]] = []
    for crop, offset_x, offset_y, region_index in _regions(image, regions):
        data = pytesseract.image_to_data(crop, lang=language, config="--psm 11", output_type=Output.DICT)
        for index, raw_text in enumerate(data["text"]):
            text = raw_text.strip()
            try:
                confidence = float(data["conf"][index]) / 100
            except (TypeError, ValueError):
                confidence = -1
            if not text or confidence < 0:
                continue
            words.append({
                "text": text,
                "confidence": round(max(0, min(1, confidence)), 4),
                "box": {
                    "x": int(data["left"][index]) + offset_x,
                    "y": int(data["top"][index]) + offset_y,
                    "width": int(data["width"][index]),
                    "height": int(data["height"][index]),
                },
                "region": region_index,
                "line_key": f"{region_index}:{data['block_num'][index]}:{data['par_num'][index]}:{data['line_num'][index]}",
            })
    lines = _lines(words)
    average = sum(word["confidence"] for word in words) / len(words) if words else 0
    return {"engine": "tesseract", "text": "\n".join(lines), "lines": lines, "words": words, "average_confidence": round(average, 4)}


def _paddle(image: Image.Image, regions: List[Dict[str, Any]]) -> Dict[str, Any]:
    words: List[Dict[str, Any]] = []
    worker = str((__import__("pathlib").Path(__file__).parent / "paddle_worker.py"))
    with _paddle_lock, tempfile.TemporaryDirectory(prefix="spatial-paddle-") as directory:
        for crop, offset_x, offset_y, region_index in _regions(image, regions):
            input_path = os.path.join(directory, f"region-{region_index}.png")
            output_path = os.path.join(directory, f"region-{region_index}.json")
            crop.save(input_path, format="PNG")
            environment = {**os.environ, "PADDLE_PDX_MODEL_SOURCE": os.environ.get("PADDLE_PDX_MODEL_SOURCE", "BOS"), "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK": "True"}
            completed = subprocess.run([sys.executable, worker, input_path, output_path], capture_output=True, text=True, timeout=120, env=environment)
            if completed.returncode != 0:
                raise RuntimeError(f"PaddleOCR worker exited with code {completed.returncode}: {completed.stderr[-500:]}")
            payload = json.loads(__import__("pathlib").Path(output_path).read_text(encoding="utf-8"))
            for index, item in enumerate(payload.get("words", [])):
                box = item.get("box", {})
                words.append({**item, "box": {"x": int(box.get("x", 0)) + offset_x, "y": int(box.get("y", 0)) + offset_y, "width": int(box.get("width", crop.width)), "height": int(box.get("height", crop.height))}, "region": region_index, "line_key": f"{region_index}:{index}"})
    lines = _lines(words)
    average = sum(word["confidence"] for word in words) / len(words) if words else 0
    return {"engine": "paddleocr", "text": "\n".join(lines), "lines": lines, "words": words, "average_confidence": round(average, 4)}


def extract_ocr(image_bytes: bytes, regions: List[Dict[str, Any]], engine: str = "auto", language: str = "eng") -> Dict[str, Any]:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    tried: List[str] = []
    fallback_used = False
    if engine in {"auto", "tesseract"}:
        tried.append("tesseract")
        primary = _tesseract(image, regions, language)
        if engine == "tesseract" or (primary["text"].strip() and primary["average_confidence"] >= 0.55):
            return {**primary, "fallback_used": False, "engines_tried": tried, "image": {"width": image.width, "height": image.height}}
    else:
        primary = None

    try:
        tried.append("paddleocr")
        paddle = _paddle(image, regions)
        fallback_used = engine == "auto"
        candidates = [candidate for candidate in [primary, paddle] if candidate]
        best = max(candidates, key=lambda item: (item["average_confidence"], len(item["text"])))
    except Exception as exc:
        logger.warning("PaddleOCR unavailable, falling back to Tesseract: %s", exc)
        if primary is None:
            tried.append("tesseract")
            primary = _tesseract(image, regions, language)
        best = primary
        fallback_used = True
    return {**best, "fallback_used": fallback_used, "engines_tried": tried, "image": {"width": image.width, "height": image.height}}