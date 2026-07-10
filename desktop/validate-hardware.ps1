param(
  [string]$BundleRoot = "$PSScriptRoot\src-tauri\target\release\bundle",
  [string]$OutputRoot = "$PSScriptRoot\hardware-results",
  [ValidateSet("Auto", "NSIS", "MSI")][string]$InstallerKind = "Auto",
  [double]$ExpectedPrimaryScale = 1.0,
  [double]$ExpectedSecondaryScale = 1.5
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$resultRoot = Join-Path $OutputRoot $timestamp
New-Item -ItemType Directory -Path $resultRoot -Force | Out-Null

$os = Get-CimInstance Win32_OperatingSystem
$isWindows11 = [int]$os.BuildNumber -ge 22000
if ($InstallerKind -eq "Auto") { $InstallerKind = if ($isWindows11) { "MSI" } else { "NSIS" } }

$installer = if ($InstallerKind -eq "MSI") {
  Get-ChildItem -Path (Join-Path $BundleRoot "msi") -Filter *.msi -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
} else {
  Get-ChildItem -Path (Join-Path $BundleRoot "nsis") -Filter *.exe -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $installer) { throw "$InstallerKind installer was not found under $BundleRoot." }

$installerSignature = Get-AuthenticodeSignature -FilePath $installer.FullName
if ($installerSignature.Status -ne "Valid") { throw "Installer signature is invalid: $($installerSignature.StatusMessage)" }

if ($InstallerKind -eq "MSI") {
  $install = Start-Process msiexec.exe -ArgumentList @("/i", "`"$($installer.FullName)`"", "/qn", "/norestart") -Wait -PassThru
} else {
  $install = Start-Process $installer.FullName -ArgumentList "/S" -Wait -PassThru
}
if ($install.ExitCode -ne 0) { throw "$InstallerKind installation failed with exit code $($install.ExitCode)." }

$uninstallKeys = @(
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
$product = Get-ItemProperty $uninstallKeys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like "Spatial AI Context Layer*" } |
  Select-Object -First 1

$executable = $null
if ($product.InstallLocation) {
  $executable = Get-ChildItem -Path $product.InstallLocation -Filter "spatial-ai-context-layer.exe" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $executable) {
  $executable = Get-ChildItem -Path $env:ProgramFiles -Filter "spatial-ai-context-layer.exe" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $executable) { throw "Installed Spatial AI executable could not be located." }

$executableSignature = Get-AuthenticodeSignature -FilePath $executable.FullName
if ($executableSignature.Status -ne "Valid") { throw "Installed executable signature is invalid." }

$nativeReportPath = Join-Path $resultRoot "native-hardware-report.json"
$capture = Start-Process $executable.FullName -ArgumentList @("--hardware-report", "`"$nativeReportPath`"") -Wait -PassThru
if ($capture.ExitCode -notin @(0, 3)) { throw "Native hardware probe failed with exit code $($capture.ExitCode)." }
if (-not (Test-Path $nativeReportPath)) { throw "Native hardware report was not created." }

$native = Get-Content $nativeReportPath -Raw | ConvertFrom-Json
if ($native.displays.Count -lt 2) { throw "At least two displays are required for mixed-DPI validation." }
$scales = @($native.displays | ForEach-Object { [double]$_.scale_factor })
$primaryMatch = $scales | Where-Object { [Math]::Abs($_ - $ExpectedPrimaryScale) -le 0.06 }
$secondaryMatch = $scales | Where-Object { [Math]::Abs($_ - $ExpectedSecondaryScale) -le 0.06 }
$topologyPassed = [bool]$primaryMatch -and [bool]$secondaryMatch

$summary = [ordered]@{
  created_at = (Get-Date).ToString("o")
  machine = $env:COMPUTERNAME
  os_caption = $os.Caption
  os_version = $os.Version
  os_build = $os.BuildNumber
  installer_kind = $InstallerKind
  installer = $installer.FullName
  installer_sha256 = (Get-FileHash -Algorithm SHA256 -Path $installer.FullName).Hash
  installer_signature = $installerSignature.Status.ToString()
  installer_signer = $installerSignature.SignerCertificate.Subject
  executable = $executable.FullName
  executable_signature = $executableSignature.Status.ToString()
  expected_scales = @($ExpectedPrimaryScale, $ExpectedSecondaryScale)
  detected_scales = $scales
  topology_passed = $topologyPassed
  native_alignment_passed = [bool]$native.passed
  seams = $native.seams
  overall_passed = $topologyPassed -and [bool]$native.passed
}

$summaryPath = Join-Path $resultRoot "hardware-summary.json"
$summary | ConvertTo-Json -Depth 10 | Set-Content -Path $summaryPath -Encoding UTF8
Copy-Item $installer.FullName -Destination $resultRoot
Compress-Archive -Path (Join-Path $resultRoot "*") -DestinationPath "$resultRoot.zip" -Force

Write-Host "Hardware report: $summaryPath" -ForegroundColor Cyan
Write-Host "Return package: $resultRoot.zip" -ForegroundColor Green
if (-not $summary.overall_passed) { throw "Mixed-DPI hardware validation failed. Inspect the JSON and stitched PNG in $resultRoot." }