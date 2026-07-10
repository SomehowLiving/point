$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $DesktopRoot

foreach ($name in @("WINDOWS_CERT_PATH", "WINDOWS_CERT_PASSWORD", "TIMESTAMP_URL")) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "Required signing environment variable $name is missing."
  }
}

Write-Host "Building Spatial AI frontend..." -ForegroundColor Cyan
yarn --cwd "$RepoRoot\frontend" install --frozen-lockfile
yarn --cwd "$RepoRoot\frontend" build

if (-not (Get-Command cargo-tauri -ErrorAction SilentlyContinue)) {
  cargo install tauri-cli --version "^2" --locked
}

Write-Host "Creating NSIS and MSI installers..." -ForegroundColor Cyan
Push-Location $DesktopRoot
try {
  cargo tauri build --bundles nsis,msi
} finally {
  Pop-Location
}

Write-Host "Installers are in desktop\src-tauri\target\release\bundle" -ForegroundColor Green

$bundleRoot = Join-Path $DesktopRoot "src-tauri\target\release\bundle"
$artifacts = Get-ChildItem -Path $bundleRoot -Recurse -File | Where-Object { $_.Extension -in @(".exe", ".msi") }
if (-not $artifacts) { throw "No Windows installers were produced." }

$manifest = foreach ($artifact in $artifacts) {
  $signature = Get-AuthenticodeSignature -FilePath $artifact.FullName
  if ($signature.Status -ne "Valid") { throw "Invalid installer signature: $($artifact.FullName)" }
  [ordered]@{
    file = $artifact.FullName
    size_bytes = $artifact.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -Path $artifact.FullName).Hash
    signature_status = $signature.Status.ToString()
    signer = $signature.SignerCertificate.Subject
    timestamp = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
  }
}

$manifestPath = Join-Path $bundleRoot "signed-package-manifest.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "Signed package manifest: $manifestPath" -ForegroundColor Green