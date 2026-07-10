$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $DesktopRoot

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