param(
  [ValidateSet("tiny", "base", "small")]
  [string]$Model = "base",
  [string]$InstallDir = "",
  [string]$NodeExe = "node"
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
    [string]$ExpectedSha256 = "",
    [string]$HashFailureCode = "",
    [string]$HashFailureMessage = ""
  )

  $validUrls = @($Urls | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
  $hashMismatchObserved = $false
  for ($index = 0; $index -lt $validUrls.Count; $index += 1) {
    $url = $validUrls[$index]
    Write-Host "Downloading from $(Format-DownloadSource -Url $url)..."
    $downloadResult = Invoke-NodeProcess -Executable $NodeExe -Arguments @($downloadScript, $url, $DestinationPath)
    $downloadSucceeded = $downloadResult.ExitCode -eq 0

    if ($downloadSucceeded -and -not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
      $downloadSucceeded = Test-FileSha256 -Path $DestinationPath -ExpectedSha256 $ExpectedSha256
      if (-not $downloadSucceeded) {
        $hashMismatchObserved = $true
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

  if ($hashMismatchObserved -and -not [string]::IsNullOrWhiteSpace($HashFailureCode)) {
    Fail-Setup -Code $HashFailureCode -Message $HashFailureMessage
  }
  Fail-Setup -Code $FailureCode -Message $FailureMessage
}

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $repoRoot "vendor\whisper"
}

$binDir = Join-Path $InstallDir "bin"
$modelDir = Join-Path $InstallDir "models"
$downloadDir = Join-Path $InstallDir "downloads"
$downloadScript = Join-Path $repoRoot "scripts\download-file.mjs"
$hashCheckScript = Join-Path $repoRoot "scripts\check-file-sha256.mjs"
$manifestPath = Join-Path $repoRoot "scripts\whisper-runtime-manifest.json"

New-Item -ItemType Directory -Force -Path $binDir, $modelDir, $downloadDir | Out-Null

try {
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
  $runtimeFile = [string]$manifest.fileName
  $runtimeSha256 = [string]$manifest.sha256
  $runtimeCliSha256 = [string]$manifest.cliSha256
  $manifestRuntimeUrls = @($manifest.urls)
  $modelManifest = $manifest.models.$Model
  $modelFile = [string]$modelManifest.fileName
  $modelSha256 = [string]$modelManifest.sha256
  $manifestModelUrls = @($modelManifest.urls)
  if (
    [string]::IsNullOrWhiteSpace($runtimeFile) -or
    $runtimeSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
    $runtimeCliSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
    $manifestRuntimeUrls.Count -eq 0 -or
    [string]::IsNullOrWhiteSpace($modelFile) -or
    $modelSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
    $manifestModelUrls.Count -lt 2
  ) {
    throw "Whisper manifest is incomplete."
  }
} catch {
  Fail-Setup -Code "whisper_runtime_manifest" -Message "The bundled Whisper runtime manifest is missing or invalid."
}

$modelPath = Join-Path $modelDir $modelFile
$cliPath = Join-Path $binDir "Release\whisper-cli.exe"
$runtimeReady = Test-FileSha256 -Path $cliPath -ExpectedSha256 $runtimeCliSha256

if ($runtimeReady) {
  Write-Host "Using bundled verified Whisper runtime."
} else {
  $zipPath = Join-Path $downloadDir $runtimeFile
  if ((Test-Path -LiteralPath $zipPath) -and -not (Test-FileSha256 -Path $zipPath -ExpectedSha256 $runtimeSha256)) {
    Write-Host "Cached Whisper runtime failed SHA-256 verification. Downloading it again."
    try {
      Remove-Item -LiteralPath $zipPath -Force -ErrorAction Stop
    } catch {
      Fail-Setup -Code "whisper_runtime_locked" -Message "The cached Whisper runtime is in use. Close Local Flow and retry."
    }
  }

  if (-not (Test-Path -LiteralPath $zipPath)) {
    Write-Host "Downloading pinned whisper.cpp runtime $($manifest.version)..."
    $runtimeOverrideUrls = @(Get-EnvUrls -Names @("LOCAL_FLOW_WHISPER_RUNTIME_URL"))
    $runtimeUrls = @()
    if ($runtimeOverrideUrls.Count -gt 0) {
      $runtimeUrls += $runtimeOverrideUrls
    } else {
      $runtimeUrls += $manifestRuntimeUrls
    }
    $runtimeUrls += Get-EnvUrls -Names @("LOCAL_FLOW_WHISPER_RUNTIME_MIRROR_URLS")
    Download-WithFallback `
      -Urls $runtimeUrls `
      -DestinationPath $zipPath `
      -FailureCode "whisper_runtime_download" `
      -FailureMessage "Failed to download the verified whisper.cpp runtime." `
      -ExpectedSha256 $runtimeSha256 `
      -HashFailureCode "whisper_runtime_hash" `
      -HashFailureMessage "The downloaded whisper.cpp runtime failed SHA-256 verification."
  } else {
    Write-Host "Using verified cached $zipPath"
  }

  try {
    if (Test-Path -LiteralPath $binDir) {
      Remove-Item -LiteralPath $binDir -Recurse -Force -ErrorAction Stop
    }
    New-Item -ItemType Directory -Force -Path $binDir -ErrorAction Stop | Out-Null
  } catch {
    Fail-Setup -Code "whisper_runtime_locked" -Message "The existing Whisper runtime is in use. Close Local Flow and retry."
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
  if (-not (Test-FileSha256 -Path $cli.FullName -ExpectedSha256 $runtimeCliSha256)) {
    Fail-Setup -Code "whisper_cli_hash" -Message "whisper-cli.exe did not match the verified runtime."
  }
  $cliPath = $cli.FullName
}

if ((Test-Path -LiteralPath $modelPath) -and -not (Test-FileSha256 -Path $modelPath -ExpectedSha256 $modelSha256)) {
  Write-Host "Existing Whisper model failed SHA-256 verification. Downloading it again."
  try {
    Remove-Item -LiteralPath $modelPath -Force -ErrorAction Stop
  } catch {
    Fail-Setup -Code "whisper_model_locked" -Message "The existing Whisper model is in use. Close Local Flow and retry."
  }
}

if (-not (Test-Path -LiteralPath $modelPath)) {
  Write-Host "Downloading verified $modelFile..."
  $modelOverrideUrls = @(Get-EnvUrls -Names @("LOCAL_FLOW_WHISPER_MODEL_URL"))
  $modelUrls = @()
  if ($modelOverrideUrls.Count -gt 0) {
    $modelUrls += $modelOverrideUrls
  } else {
    $modelUrls += $manifestModelUrls
  }
  $modelUrls += Get-EnvUrls -Names @("LOCAL_FLOW_WHISPER_MODEL_MIRROR_URLS")
  Download-WithFallback `
    -Urls $modelUrls `
    -DestinationPath $modelPath `
    -FailureCode "whisper_model_download" `
    -FailureMessage "Failed to download the verified $modelFile." `
    -ExpectedSha256 $modelSha256 `
    -HashFailureCode "whisper_model_hash" `
    -HashFailureMessage "The downloaded Whisper model failed SHA-256 verification."
} else {
  Write-Host "Using bundled verified $modelPath"
}

if (-not (Test-FileSha256 -Path $modelPath -ExpectedSha256 $modelSha256)) {
  Fail-Setup -Code "whisper_model_hash" -Message "The Whisper model did not match the verified manifest."
}

Write-Host ""
Write-Host "Whisper setup complete."
Write-Host "Runtime: $cliPath"
Write-Host "Model:   $modelPath"
Write-Host "License: MIT"
