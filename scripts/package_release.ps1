# Package TERRA release zips on Windows after `wails build`.
# Usage:
#   pwsh scripts/package_release.ps1 -Flavor lite|full -Artifact TERRA-Windows-amd64-lite.zip
param(
  [Parameter(Mandatory = $true)][ValidateSet("lite", "full")][string]$Flavor,
  [Parameter(Mandatory = $true)][string]$Artifact,
  [string]$Arch = "x86_64",
  [string]$PbsTag = "20260728",
  [string]$PbsPy = "3.12.13"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
$BinDir = Join-Path $Root "build\bin"
$DistDir = Join-Path $Root "dist"
$Stage = Join-Path $Root "build\stage-$Flavor"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

function Copy-Assets([string]$Dest) {
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  Copy-Item -Recurse (Join-Path $Root "sidecar") (Join-Path $Dest "sidecar")
  Copy-Item -Recurse (Join-Path $Root "model") (Join-Path $Dest "model")
  Get-ChildItem -Path (Join-Path $Dest "sidecar") -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

$Exe = Get-ChildItem $BinDir -Filter "*.exe" | Select-Object -First 1
if (-not $Exe) { throw "no .exe in $BinDir" }

$OutDir = Join-Path $Stage "TERRA"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item $Exe.FullName (Join-Path $OutDir "Terra.exe")
Copy-Assets $OutDir

if ($Flavor -eq "full") {
  $Triple = switch ($Arch) {
    "x86_64" { "x86_64-pc-windows-msvc" }
    "amd64" { "x86_64-pc-windows-msvc" }
    "aarch64" { "aarch64-pc-windows-msvc" }
    default { throw "unsupported arch $Arch" }
  }
  $Name = "cpython-$PbsPy+$PbsTag-$Triple-install_only.tar.gz"
  $Url = "https://github.com/astral-sh/python-build-standalone/releases/download/$PbsTag/$Name"
  $Cache = Join-Path $Root "build\cache"
  New-Item -ItemType Directory -Force -Path $Cache | Out-Null
  $Tarball = Join-Path $Cache $Name
  if (-not (Test-Path $Tarball)) {
    Write-Host "downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Tarball
  }
  $Tmp = Join-Path $env:TEMP ("terra-py-" + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
  tar -xzf $Tarball -C $Tmp
  $PySrc = Join-Path $Tmp "python"
  if (-not (Test-Path $PySrc)) { throw "unexpected PBS layout" }
  $PyDest = Join-Path $OutDir "python"
  if (Test-Path $PyDest) { Remove-Item -Recurse -Force $PyDest }
  Move-Item $PySrc $PyDest
  Remove-Item -Recurse -Force $Tmp

  $Py = Join-Path $PyDest "python.exe"
  if (-not (Test-Path $Py)) { throw "bundled python.exe missing" }
  & $Py -m pip install --upgrade pip
  & $Py -m pip install -r (Join-Path $Root "requirements.txt")
}

$ZipPath = Join-Path $DistDir $Artifact
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -Force
Write-Host "wrote $ZipPath"
Get-Item $ZipPath | Format-List FullName, Length
