param(
  [ValidateSet("tiny", "base", "small")]
  [string]$Model = "base",
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $repoRoot "vendor\whisper"
}

$binDir = Join-Path $InstallDir "bin"
$modelDir = Join-Path $InstallDir "models"
$downloadDir = Join-Path $InstallDir "downloads"
$releaseApi = "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest"
$modelFile = "ggml-$Model.bin"
$modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelFile"
$modelMirrorUrl = "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/$modelFile"
$modelPath = Join-Path $modelDir $modelFile
$downloadScript = Join-Path $repoRoot "scripts\download-file.mjs"

New-Item -ItemType Directory -Force -Path $binDir, $modelDir, $downloadDir | Out-Null

Write-Host "Fetching latest whisper.cpp release metadata..."
$releaseJson = & node -e "const r=await fetch(process.argv[1],{headers:{'user-agent':'local-flow-dictation'}}); if(!r.ok) throw new Error('HTTP '+r.status); console.log(await r.text());" $releaseApi
if ($LASTEXITCODE -ne 0) {
  throw "Failed to fetch whisper.cpp release metadata."
}
$release = $releaseJson | ConvertFrom-Json
$asset = $release.assets | Where-Object { $_.name -eq "whisper-bin-x64.zip" } | Select-Object -First 1
if (-not $asset) {
  throw "Could not find whisper-bin-x64.zip in latest whisper.cpp release."
}

$zipPath = Join-Path $downloadDir $asset.name
if (-not (Test-Path -LiteralPath $zipPath)) {
  Write-Host "Downloading $($asset.name)..."
  & node $downloadScript $asset.browser_download_url $zipPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to download $($asset.name)."
  }
} else {
  Write-Host "Using existing $zipPath"
}

Write-Host "Extracting whisper.cpp binaries..."
Expand-Archive -LiteralPath $zipPath -DestinationPath $binDir -Force

$cli = Get-ChildItem -Path $binDir -Filter "whisper-cli.exe" -Recurse | Select-Object -First 1
if (-not $cli) {
  throw "whisper-cli.exe was not found after extracting $zipPath"
}

if (-not (Test-Path -LiteralPath $modelPath)) {
  Write-Host "Downloading $modelFile..."
  & node $downloadScript $modelUrl $modelPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Primary Hugging Face download failed. Trying mirror..."
    & node $downloadScript $modelMirrorUrl $modelPath
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to download $modelFile from primary and mirror URLs."
    }
  }
} else {
  Write-Host "Using existing $modelPath"
}

Write-Host ""
Write-Host "Whisper setup complete."
Write-Host "Executable: $($cli.FullName)"
Write-Host "Model:      $modelPath"
Write-Host ""
Write-Host "Paste these paths into Local Flow Dictation settings, then click Check local Whisper."
