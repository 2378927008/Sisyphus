param(
  [ValidateSet("tiny", "base", "small")]
  [string]$Model = "base",
  [string]$InstallDir = "",
  [string]$NodeExe = "node"
)

$ErrorActionPreference = "Stop"

function Fail-Setup {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Code,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  Write-Host "LOCAL_FLOW_SETUP_ERROR:$Code"
  Write-Host $Message
  exit 1
}

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
$releaseJson = & $NodeExe -e "const r=await fetch(process.argv[1],{headers:{'user-agent':'local-flow-dictation'}}); if(!r.ok) throw new Error('HTTP '+r.status); console.log(await r.text());" $releaseApi
if ($LASTEXITCODE -ne 0) {
  Fail-Setup -Code "whisper_release_metadata" -Message "Failed to fetch whisper.cpp release metadata."
}
try {
  $release = $releaseJson | ConvertFrom-Json
} catch {
  Fail-Setup -Code "whisper_release_metadata" -Message "Failed to parse whisper.cpp release metadata."
}
$asset = $release.assets | Where-Object { $_.name -eq "whisper-bin-x64.zip" } | Select-Object -First 1
if (-not $asset) {
  Fail-Setup -Code "whisper_release_asset_missing" -Message "Could not find whisper-bin-x64.zip in latest whisper.cpp release."
}

$zipPath = Join-Path $downloadDir $asset.name
if (-not (Test-Path -LiteralPath $zipPath)) {
  Write-Host "Downloading $($asset.name)..."
  & $NodeExe $downloadScript $asset.browser_download_url $zipPath
  if ($LASTEXITCODE -ne 0) {
    Fail-Setup -Code "whisper_runtime_download" -Message "Failed to download $($asset.name)."
  }
} else {
  Write-Host "Using existing $zipPath"
}

Write-Host "Extracting whisper.cpp binaries..."
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $binDir -Force
} catch {
  Fail-Setup -Code "whisper_extract_failed" -Message "Failed to extract whisper.cpp binaries."
}

$cli = Get-ChildItem -Path $binDir -Filter "whisper-cli.exe" -Recurse | Select-Object -First 1
if (-not $cli) {
  Fail-Setup -Code "whisper_runtime_missing" -Message "whisper-cli.exe was not found after extracting the runtime archive."
}

if (-not (Test-Path -LiteralPath $modelPath)) {
  Write-Host "Downloading $modelFile..."
  & $NodeExe $downloadScript $modelUrl $modelPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Primary Hugging Face download failed. Trying mirror..."
    & $NodeExe $downloadScript $modelMirrorUrl $modelPath
    if ($LASTEXITCODE -ne 0) {
      Fail-Setup -Code "whisper_model_download" -Message "Failed to download $modelFile from primary and mirror URLs."
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
