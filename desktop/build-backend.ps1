# Freeze the FastAPI backend into desktop/src-tauri/resources/point-backend/ (PyInstaller one-dir)
# and copy Tesseract next to it, so the installer needs no Python, Docker or database.
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $DesktopRoot
$Backend = Join-Path $RepoRoot "backend"
$Resources = Join-Path $DesktopRoot "src-tauri\resources"
$Work = Join-Path $DesktopRoot ".build-backend"  # same drive as the sources: PyInstaller can't relativize across drives

$python = if ($env:POINT_PYTHON) { $env:POINT_PYTHON } else { "python" }
$venv = Join-Path $Work "venv"
if (-not (Test-Path "$venv\Scripts\python.exe")) { & $python -m venv $venv }
& "$venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r "$Backend\requirements-desktop.txt"
if ($LASTEXITCODE) { throw "pip install failed" }

New-Item -ItemType Directory -Force $Resources | Out-Null
Remove-Item -Recurse -Force "$Resources\point-backend" -ErrorAction SilentlyContinue
Push-Location $Backend
try {
  & "$venv\Scripts\pyinstaller.exe" point_backend.py --name point-backend --onedir --noconsole --noconfirm `
    --distpath $Resources --workpath "$Work\build" --specpath $Work `
    --collect-submodules uvicorn --collect-data google.genai `
    --exclude-module paddleocr --exclude-module paddle --exclude-module motor --exclude-module pymongo `
    --exclude-module tkinter --exclude-module pytest
  if ($LASTEXITCODE) { throw "PyInstaller failed" }
} finally { Pop-Location }

# Tesseract: use TESSERACT_DIR, else the standard install location. English data only, to keep size down.
$tesseractDir = if ($env:TESSERACT_DIR) { $env:TESSERACT_DIR } else { "C:\Program Files\Tesseract-OCR" }
if (-not (Test-Path "$tesseractDir\tesseract.exe")) { throw "Tesseract not found at $tesseractDir (set TESSERACT_DIR)" }
$target = Join-Path $Resources "tesseract"
Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$target\tessdata" | Out-Null
# Only the OCR binary; the ~30 training tools and the text-rendering stack they need (ICU, pango,
# cairo, harfbuzz, glib, ...) aren't used at runtime. Image-format libraries are all kept.
$trainingOnly = '^(libicu|libpango|libcairo|libharfbuzz|libfontconfig|libfreetype|libglib|libgobject|libfribidi|libpixman|libgio|libgmodule|libthai|libdatrie|libgraphite|libpcre)'
Copy-Item "$tesseractDir\tesseract.exe" $target
Get-ChildItem "$tesseractDir\*.dll" | Where-Object { $_.Name -notmatch $trainingOnly } | Copy-Item -Destination $target
Copy-Item "$tesseractDir\tessdata\eng.traineddata", "$tesseractDir\tessdata\osd.traineddata" "$target\tessdata" -ErrorAction SilentlyContinue
if (Test-Path "$tesseractDir\tessdata\configs") { Copy-Item -Recurse "$tesseractDir\tessdata\configs" "$target\tessdata" }

# Smoke test: the pruned Tesseract must still read PNG, JPEG and WEBP. (Tesseract logs to stderr,
# which Windows PowerShell 5.1 turns into a terminating error under "Stop", so relax it per call.)
function Read-Text($image) {
  $ErrorActionPreference = "Continue"
  (& "$target\tesseract.exe" $image - 2>$null) -join " "
}
Add-Type -AssemblyName System.Drawing
$probe = New-Object Drawing.Bitmap 420, 90
$g = [Drawing.Graphics]::FromImage($probe); $g.Clear([Drawing.Color]::White)
$g.DrawString("Point OCR check", (New-Object Drawing.Font "Arial", 28), [Drawing.Brushes]::Black, 10, 20)
foreach ($fmt in @("Png", "Jpeg")) {
  $file = Join-Path $Work "probe.$($fmt.ToLower())"
  $probe.Save($file, [Drawing.Imaging.ImageFormat]::$fmt)
  $text = Read-Text $file
  if (-not ($text -match "OCR")) { throw "Bundled Tesseract failed to read $fmt" }
}
& "$venv\Scripts\python.exe" -c "from PIL import Image; Image.open(r'$Work\probe.png').save(r'$Work\probe.webp')"
$text = Read-Text "$Work\probe.webp"
if (-not ($text -match "OCR")) { throw "Bundled Tesseract failed to read WEBP" }
Write-Host "Bundled Tesseract reads PNG, JPEG and WEBP" -ForegroundColor Green

$size = (Get-ChildItem -Recurse $Resources | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Bundled backend + Tesseract: {0:N0} MB in {1}" -f $size, $Resources) -ForegroundColor Green
