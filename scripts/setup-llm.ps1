param(
  [string]$InstallDir = "",
  [ValidateSet("Q4_K_M")]
  [string]$Quantization = "Q4_K_M",
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
  $InstallDir = Join-Path $repoRoot "vendor\llm"
}

$binDir = Join-Path $InstallDir "bin"
$modelDir = Join-Path $InstallDir "models"
$downloadDir = Join-Path $InstallDir "downloads"
$downloadScript = Join-Path $repoRoot "scripts\download-file.mjs"
$assetSelector = Join-Path $repoRoot "scripts\select-llama-release-asset.mjs"
$releaseApi = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
$modelFile = "Qwen3-4B-Q4_K_M.gguf"
$modelUrl = "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/$modelFile"
$modelMirrorUrl = "https://hf-mirror.com/Qwen/Qwen3-4B-GGUF/resolve/main/$modelFile"
$modelPath = Join-Path $modelDir $modelFile

New-Item -ItemType Directory -Force -Path $binDir, $modelDir, $downloadDir | Out-Null

Write-Host "Fetching latest llama.cpp release metadata..."
$releaseJson = & $NodeExe -e "const r=await fetch(process.argv[1],{headers:{'user-agent':'local-flow-dictation'}}); if(!r.ok) throw new Error('HTTP '+r.status); console.log(await r.text());" $releaseApi
if ($LASTEXITCODE -ne 0) {
  Fail-Setup -Code "llm_release_metadata" -Message "Failed to fetch llama.cpp release metadata."
}

try {
  $release = $releaseJson | ConvertFrom-Json
} catch {
  Fail-Setup -Code "llm_release_metadata" -Message "Failed to parse llama.cpp release metadata."
}
$assetsJson = $release.assets | ConvertTo-Json -Depth 10 -Compress
$assetJson = $assetsJson | & $NodeExe $assetSelector
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($assetJson)) {
  Fail-Setup -Code "llm_release_asset_missing" -Message "Could not find a Windows x64 llama.cpp runtime zip asset in the latest release."
}
$asset = $assetJson | ConvertFrom-Json

$zipPath = Join-Path $downloadDir $asset.name
if (-not (Test-Path -LiteralPath $zipPath)) {
  Write-Host "Downloading $($asset.name)..."
  & $NodeExe $downloadScript $asset.browser_download_url $zipPath
  if ($LASTEXITCODE -ne 0) {
    Fail-Setup -Code "llm_runtime_download" -Message "Failed to download $($asset.name)."
  }
} else {
  Write-Host "Using existing $zipPath"
}

Write-Host "Extracting llama.cpp binaries..."
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $binDir -Force
} catch {
  Fail-Setup -Code "llm_extract_failed" -Message "Failed to extract llama.cpp binaries."
}

$cli = Get-ChildItem -Path $binDir -Filter "llama-cli.exe" -Recurse | Select-Object -First 1
$server = Get-ChildItem -Path $binDir -Filter "llama-server.exe" -Recurse | Select-Object -First 1
if (-not $cli -and -not $server) {
  Fail-Setup -Code "llm_runtime_missing" -Message "llama-cli.exe or llama-server.exe was not found after extracting the runtime archive."
}

if ($cli -and $cli.DirectoryName -ne $binDir) {
  Copy-Item -LiteralPath $cli.FullName -Destination (Join-Path $binDir "llama-cli.exe") -Force
}
if ($server -and $server.DirectoryName -ne $binDir) {
  Copy-Item -LiteralPath $server.FullName -Destination (Join-Path $binDir "llama-server.exe") -Force
}

if (-not (Test-Path -LiteralPath $modelPath)) {
  Write-Host "Downloading $modelFile. This is about 2.5 GB..."
  & $NodeExe $downloadScript $modelUrl $modelPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Primary Hugging Face download failed. Trying mirror..."
    & $NodeExe $downloadScript $modelMirrorUrl $modelPath
    if ($LASTEXITCODE -ne 0) {
      Fail-Setup -Code "llm_model_download" -Message "Failed to download $modelFile from primary and mirror URLs."
    }
  }
} else {
  Write-Host "Using existing $modelPath"
}

Write-Host ""
Write-Host "Local language model setup complete."
Write-Host "Runtime: $binDir"
Write-Host "Model:   $modelPath"
Write-Host "License: Apache-2.0. Keep the Qwen license notice with distributed builds."
