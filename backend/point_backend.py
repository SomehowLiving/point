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
    # Started by the desktop app with no console, so stdout/stderr are None (which breaks uvicorn's
    # logging) and any crash would be invisible. Send both to a log file in the data folder.
    from storage import data_dir
    log_dir = data_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    if sys.stdout is None or sys.stderr is None:
        log = open(log_dir / "backend.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log
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
    try:
        main()
    except BaseException:
        import traceback
        try:
            from storage import data_dir
            with open(data_dir() / "backend.log", "a", encoding="utf-8") as handle:
                traceback.print_exc(file=handle)
        finally:
            raise
