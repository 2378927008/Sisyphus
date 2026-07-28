param(
  [string]$InstallDir = "",
  [ValidateSet("Q4_K_M")]
  [string]$Quantization = "Q4_K_M",
  [string]$NodeExe = "node",
  [switch]$RuntimeOnly
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "invoke-node-process.ps1")

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

function Get-EnvUrls {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Names
  )

  $urls = @()
  foreach ($name in $Names) {
    $raw = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($raw)) {
      continue
    }
    $urls += $raw -split "[;`r`n]+" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }
  }
  return $urls
}

function Format-DownloadSource {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  try {
    $uri = [Uri]$Url
    return $uri.Host
  } catch {
    return "custom source"
  }
}

function Test-FileSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedSha256
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $hashCheck = Invoke-NodeProcess `
    -Executable $NodeExe `
    -Arguments @($hashCheckScript, $Path, $ExpectedSha256) `
    -HideStdout
  return $hashCheck.ExitCode -eq 0
}

function Download-WithFallback {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Urls,
    [Parameter(Mandatory = $true)]
    [string]$DestinationPath,
    [Parameter(Mandatory = $true)]
    [string]$FailureCode,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage,
    [string]$ExpectedSha256 = ""
  )

  $validUrls = @($Urls | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
  for ($index = 0; $index -lt $validUrls.Count; $index += 1) {
    $url = $validUrls[$index]
    Write-Host "Downloading from $(Format-DownloadSource -Url $url)..."
    $downloadResult = Invoke-NodeProcess -Executable $NodeExe -Arguments @($downloadScript, $url, $DestinationPath)
    $downloadSucceeded = $downloadResult.ExitCode -eq 0

    if ($downloadSucceeded -and -not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
      $downloadSucceeded = Test-FileSha256 -Path $DestinationPath -ExpectedSha256 $ExpectedSha256
      if (-not $downloadSucceeded) {
        Write-Host "Downloaded file failed SHA-256 verification."
        Remove-Item -LiteralPath $DestinationPath -Force -ErrorAction SilentlyContinue
      }
    }

    if ($downloadSucceeded) {
      return
    }

    if ($index -lt $validUrls.Count - 1) {
      Remove-Item -LiteralPath "$DestinationPath.part" -Force -ErrorAction SilentlyContinue
      Write-Host "Download source failed. Trying next source..."
    }
  }

  Fail-Setup -Code $FailureCode -Message $FailureMessage
}

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $repoRoot "vendor\llm"
}

$binDir = Join-Path $InstallDir "bin"
$modelDir = Join-Path $InstallDir "models"
$downloadDir = Join-Path $InstallDir "downloads"
$downloadScript = Join-Path $repoRoot "scripts\download-file.mjs"
$hashCheckScript = Join-Path $repoRoot "scripts\check-file-sha256.mjs"
$runtimeCheckScript = Join-Path $repoRoot "scripts\check-llama-runtime.mjs"
$runtimeManifestPath = Join-Path $repoRoot "scripts\llama-runtime-manifest.json"
$modelManifestPath = Join-Path $repoRoot "scripts\qwen-model-manifest.json"

New-Item -ItemType Directory -Force -Path $binDir, $modelDir, $downloadDir | Out-Null

try {
  $runtimeManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $runtimeManifestPath | ConvertFrom-Json
  $runtimeFile = [string]$runtimeManifest.fileName
  $runtimeSha256 = [string]$runtimeManifest.sha256
  $runtimeCliSha256 = [string]$runtimeManifest.cliSha256
  $manifestRuntimeUrls = @($runtimeManifest.urls)
  if (
    [string]::IsNullOrWhiteSpace($runtimeFile) -or
    $runtimeSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
    $runtimeCliSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
    $manifestRuntimeUrls.Count -eq 0
  ) {
    throw "Runtime manifest is incomplete."
  }
} catch {
  Fail-Setup -Code "llm_runtime_manifest" -Message "The bundled llama.cpp runtime manifest is missing or invalid."
}

try {
  $modelManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $modelManifestPath | ConvertFrom-Json
  $modelFile = [string]$modelManifest.fileName
  $modelSha256 = [string]$modelManifest.sha256
  $modelSize = [long]$modelManifest.size
  $manifestModelUrls = @($modelManifest.urls)
  if (
    [string]::IsNullOrWhiteSpace($modelFile) -or
    $modelSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
    $modelSize -le 0 -or
    $manifestModelUrls.Count -lt 2
  ) {
    throw "Model manifest is incomplete."
  }
} catch {
  Fail-Setup -Code "llm_model_manifest" -Message "The bundled Qwen model manifest is missing or invalid."
}
$modelPath = Join-Path $modelDir $modelFile

$cliPath = Join-Path $binDir "llama-cli.exe"
$serverPath = Join-Path $binDir "llama-server.exe"
$runtimeReady = $false
if (Test-Path -LiteralPath $cliPath) {
  if (Test-FileSha256 -Path $cliPath -ExpectedSha256 $runtimeCliSha256) {
    $runtimeCheck = Invoke-NodeProcess -Executable $NodeExe -Arguments @($runtimeCheckScript, $cliPath)
    $runtimeReady = $runtimeCheck.ExitCode -eq 0
  }
  if (-not $runtimeReady) {
    Write-Host "Existing llama.cpp runtime is not the verified bundled version. Reinstalling it."
  }
}

if ($runtimeReady) {
  Write-Host "Using bundled llama.cpp runtime."
} else {
  $zipPath = Join-Path $downloadDir $runtimeFile
  if ((Test-Path -LiteralPath $zipPath) -and -not (Test-FileSha256 -Path $zipPath -ExpectedSha256 $runtimeSha256)) {
    Write-Host "Cached llama.cpp runtime failed SHA-256 verification. Downloading it again."
    try {
      Remove-Item -LiteralPath $zipPath -Force -ErrorAction Stop
    } catch {
      Fail-Setup -Code "llm_runtime_locked" -Message "The cached llama.cpp runtime is in use. Close Local Flow and retry."
    }
  }

  if (-not (Test-Path -LiteralPath $zipPath)) {
    Write-Host "Downloading pinned llama.cpp runtime $($runtimeManifest.version)..."
    $runtimeOverrideUrls = @(Get-EnvUrls -Names @("LOCAL_FLOW_LLAMA_RUNTIME_URL"))
    $runtimeUrls = @()
    if ($runtimeOverrideUrls.Count -gt 0) {
      $runtimeUrls += $runtimeOverrideUrls
    } else {
      $runtimeUrls += $manifestRuntimeUrls
    }
    $runtimeUrls += Get-EnvUrls -Names @("LOCAL_FLOW_LLAMA_RUNTIME_MIRROR_URLS")
    Download-WithFallback `
      -Urls $runtimeUrls `
      -DestinationPath $zipPath `
      -FailureCode "llm_runtime_download" `
      -FailureMessage "Failed to download the verified llama.cpp runtime." `
      -ExpectedSha256 $runtimeSha256
  } else {
    Write-Host "Using verified cached $zipPath"
  }

  try {
    if (Test-Path -LiteralPath $binDir) {
      Remove-Item -LiteralPath $binDir -Recurse -Force -ErrorAction Stop
    }
    New-Item -ItemType Directory -Force -Path $binDir -ErrorAction Stop | Out-Null
  } catch {
    Fail-Setup -Code "llm_runtime_locked" -Message "The existing llama.cpp runtime is in use. Close Local Flow and retry."
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

  if ($cli -and $cli.FullName -ne $cliPath) {
    Copy-Item -LiteralPath $cli.FullName -Destination $cliPath -Force
  }
  if ($server -and $server.FullName -ne $serverPath) {
    Copy-Item -LiteralPath $server.FullName -Destination $serverPath -Force
  }

  if (-not (Test-FileSha256 -Path $cliPath -ExpectedSha256 $runtimeCliSha256)) {
    Fail-Setup -Code "llm_runtime_invalid" -Message "llama-cli.exe did not match the verified bundled runtime."
  }
  $runtimeCheck = Invoke-NodeProcess -Executable $NodeExe -Arguments @($runtimeCheckScript, $cliPath)
  if ($runtimeCheck.ExitCode -ne 0) {
    Fail-Setup -Code "llm_runtime_invalid" -Message "llama-cli.exe was installed but could not start on this computer."
  }
}

if ($RuntimeOnly) {
  Write-Host ""
  Write-Host "llama.cpp runtime setup complete."
  Write-Host "Runtime: $binDir"
  exit 0
}

if ((Test-Path -LiteralPath $modelPath) -and -not (Test-FileSha256 -Path $modelPath -ExpectedSha256 $modelSha256)) {
  Write-Host "Existing Qwen model failed SHA-256 verification. Downloading it again."
  try {
    Remove-Item -LiteralPath $modelPath -Force -ErrorAction Stop
  } catch {
    Fail-Setup -Code "llm_model_locked" -Message "The existing Qwen model is in use. Close Local Flow and retry."
  }
}

if (-not (Test-Path -LiteralPath $modelPath)) {
  Write-Host "Downloading $modelFile. This is about 2.5 GB..."
  $modelOverrideUrls = @(Get-EnvUrls -Names @("LOCAL_FLOW_QWEN_MODEL_URL"))
  $modelUrls = @()
  if ($modelOverrideUrls.Count -gt 0) {
    $modelUrls += $modelOverrideUrls
  } else {
    $modelUrls += $manifestModelUrls
  }
  $modelUrls += Get-EnvUrls -Names @("LOCAL_FLOW_QWEN_MODEL_MIRROR_URLS")
  Download-WithFallback `
    -Urls $modelUrls `
    -DestinationPath $modelPath `
    -FailureCode "llm_model_download" `
    -FailureMessage "Failed to download the verified $modelFile from primary and mirror URLs." `
    -ExpectedSha256 $modelSha256
} else {
  Write-Host "Using existing $modelPath"
}

Write-Host ""
Write-Host "Local language model setup complete."
Write-Host "Runtime: $binDir"
Write-Host "Model:   $modelPath"
Write-Host "License: Apache-2.0. Keep the Qwen license notice with distributed builds."
