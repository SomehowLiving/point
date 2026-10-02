"""Entry point for the backend bundled inside the desktop app (frozen with PyInstaller).

The desktop shell starts this as a hidden child process. It serves only on 127.0.0.1, keeps all
data in the user's local Point folder (SQLite history, settings.json with API keys), and uses the
Tesseract that ships next to it.
"""
import argparse
import os
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Point local backend")
    parser.add_argument("--port", type=int, default=47811)
    parser.add_argument("--data-dir", default="")
    parser.add_argument("--tesseract", default="", help="path to tesseract.exe")
    args = parser.parse_args()

    if args.data_dir:
        os.environ["POINT_DATA_DIR"] = args.data_dir
    # The packaged app never uses Mongo, even if the machine happens to have MONGO_URL set.
    os.environ.pop("MONGO_URL", None)
    os.environ.setdefault(
        "CORS_ORIGINS", "http://tauri.localhost,https://tauri.localhost,http://localhost:3000"
    )
    tesseract = args.tesseract
    if not tesseract and getattr(sys, "frozen", False):
        bundled = Path(sys.executable).parent.parent / "tesseract" / "tesseract.exe"
        if bundled.exists():
            tesseract = str(bundled)
    if tesseract:
        os.environ["TESSERACT_CMD"] = tesseract
        os.environ.setdefault("TESSDATA_PREFIX", str(Path(tesseract).parent / "tessdata"))

    import uvicorn
    from server import app

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
