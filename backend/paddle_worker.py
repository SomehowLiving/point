import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from paddleocr import PaddleOCR


def result_json(result):
    payload = getattr(result, "json", {})
    if callable(payload):
        payload = payload()
    if isinstance(payload, str):
        payload = json.loads(payload)
    return payload.get("res", payload) if isinstance(payload, dict) else {}


def main():
    input_path, output_path = sys.argv[1], sys.argv[2]
    model = PaddleOCR(lang="en", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
    words = []
    for result in model.predict(np.array(Image.open(input_path).convert("RGB"))):
        payload = result_json(result)
        texts = payload.get("rec_texts", [])
        scores = payload.get("rec_scores", [])
        boxes = payload.get("rec_boxes", payload.get("dt_polys", []))
        for index, text in enumerate(texts):
            if not str(text).strip():
                continue
            score = float(scores[index]) if index < len(scores) else 0
            raw_box = boxes[index] if index < len(boxes) else [0, 0, 1, 1]
            array = np.array(raw_box).reshape(-1, 2) if np.array(raw_box).size >= 4 else np.array([[0, 0], [1, 1]])
            min_x, min_y = array.min(axis=0); max_x, max_y = array.max(axis=0)
            words.append({"text": str(text).strip(), "confidence": round(max(0, min(1, score)), 4), "box": {"x": int(min_x), "y": int(min_y), "width": max(1, int(max_x - min_x)), "height": max(1, int(max_y - min_y))}})
    Path(output_path).write_text(json.dumps({"words": words}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()