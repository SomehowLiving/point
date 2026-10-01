param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ArtifactPath
)

$ErrorActionPreference = "Stop"

# Signing is optional: with no certificate configured the artifact is left unsigned (Windows
# SmartScreen will warn on install). Configure all three variables to produce signed builds.
$missing = @("WINDOWS_CERT_PATH", "WINDOWS_CERT_PASSWORD", "TIMESTAMP_URL") |
  Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($missing) {
  Write-Warning "Skipping code signing for $ArtifactPath (not set: $($missing -join ', '))."
  exit 0
}

$certificatePath = [Environment]::GetEnvironmentVariable("WINDOWS_CERT_PATH")
$certificatePassword = [Environment]::GetEnvironmentVariable("WINDOWS_CERT_PASSWORD")
$timestampUrl = [Environment]::GetEnvironmentVariable("TIMESTAMP_URL")

if (-not (Test-Path -LiteralPath $certificatePath)) {
  throw "Signing certificate was not found at WINDOWS_CERT_PATH."
}
if (-not (Test-Path -LiteralPath $ArtifactPath)) {
  throw "Signing artifact does not exist: $ArtifactPath"
}

$signTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signTool) {
  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  $signToolPath = Get-ChildItem -Path $kitsRoot -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $signToolPath) { throw "signtool.exe was not found. Install the Windows 10/11 SDK signing tools." }
} else {
  $signToolPath = $signTool.Source
}

& $signToolPath sign /fd SHA256 /td SHA256 /tr $timestampUrl /f $certificatePath /p $certificatePassword $ArtifactPath
if ($LASTEXITCODE -ne 0) { throw "signtool failed for $ArtifactPath with exit code $LASTEXITCODE." }

$signature = Get-AuthenticodeSignature -FilePath $ArtifactPath
if ($signature.Status -ne "Valid") {
  throw "Signature verification failed for $ArtifactPath: $($signature.StatusMessage)"
}

Write-Host "Signed and verified: $ArtifactPath" -ForegroundColor Green