$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $DesktopRoot

$Signed = -not (@("WINDOWS_CERT_PATH", "WINDOWS_CERT_PASSWORD", "TIMESTAMP_URL") |
  Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) })
if (-not $Signed) {
  Write-Warning "No signing certificate configured: building UNSIGNED installers (SmartScreen will warn on install)."
}

# The installed app talks to its own bundled backend on 127.0.0.1:47811 (see BUNDLED_BACKEND_PORT
# in src-tauri/src/main.rs), not the :8001 dev backend.
$env:REACT_APP_BACKEND_URL = "http://127.0.0.1:47811"

Write-Host "Building Spatial AI frontend..." -ForegroundColor Cyan
yarn --cwd "$RepoRoot\frontend" install --frozen-lockfile
if ($LASTEXITCODE) { throw "yarn install failed" }
yarn --cwd "$RepoRoot\frontend" build
if ($LASTEXITCODE) { throw "Frontend build failed" }

Write-Host "Bundling the local backend and Tesseract..." -ForegroundColor Cyan
& "$DesktopRoot\build-backend.ps1"

if (-not (Get-Command cargo-tauri -ErrorAction SilentlyContinue)) {
  cargo install tauri-cli --version "^2" --locked
}

Write-Host "Creating NSIS and MSI installers..." -ForegroundColor Cyan
Push-Location $DesktopRoot
try {
  # Release-only config: ship the frozen backend + Tesseract as resources (kept out of
  # tauri.conf.json so dev builds don't need them), and hook up code signing only when a
  # certificate is configured (absolute path: Tauri runs the sign command from its own cwd).
  $bundle = @{ resources = @{ "resources/point-backend/" = "point-backend/"; "resources/tesseract/" = "tesseract/" } }
  if ($Signed) {
    $signScript = Join-Path $DesktopRoot "src-tauri\sign-artifact.ps1"
    $bundle.windows = @{ signCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$signScript`" %1" }
  }
  $override = Join-Path $env:TEMP "point-tauri-release.json"
  [IO.File]::WriteAllText($override, (@{ bundle = $bundle } | ConvertTo-Json -Depth 6))  # no BOM
  $buildArgs = @("tauri", "build", "--bundles", "nsis,msi", "--config", $override)
  & cargo @buildArgs
  if ($LASTEXITCODE) { throw "cargo tauri build failed" }
} finally {
  Pop-Location
}

Write-Host "Installers are in desktop\src-tauri\target\release\bundle" -ForegroundColor Green

$bundleRoot = Join-Path $DesktopRoot "src-tauri\target\release\bundle"
$artifacts = Get-ChildItem -Path $bundleRoot -Recurse -File | Where-Object { $_.Extension -in @(".exe", ".msi") }
if (-not $artifacts) { throw "No Windows installers were produced." }

$manifest = foreach ($artifact in $artifacts) {
  $signature = Get-AuthenticodeSignature -FilePath $artifact.FullName
  if ($Signed -and $signature.Status -ne "Valid") { throw "Invalid installer signature: $($artifact.FullName)" }
  [ordered]@{
    file = $artifact.FullName
    size_bytes = $artifact.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -Path $artifact.FullName).Hash
    signature_status = $signature.Status.ToString()
    signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    timestamp = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
  }
}

$manifestPath = Join-Path $bundleRoot "signed-package-manifest.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "Signed package manifest: $manifestPath" -ForegroundColor Green