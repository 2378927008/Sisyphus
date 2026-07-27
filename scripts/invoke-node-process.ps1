function ConvertTo-ProcessArgument {
  param(
    [AllowEmptyString()]
    [string]$Argument
  )

  if ($null -eq $Argument) {
    return '""'
  }

  $escaped = $Argument.Replace('"', '\"')
  return '"' + $escaped + '"'
}

function Invoke-NodeProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [switch]$HideStdout,
    [int]$HeartbeatSeconds = 15
  )

  $process = $null
  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Executable
    $startInfo.Arguments = ($Arguments | ForEach-Object { ConvertTo-ProcessArgument -Argument $_ }) -join " "
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
      throw "The setup helper process did not start."
    }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $lastHeartbeat = [DateTime]::UtcNow

    while (-not $process.WaitForExit(1000)) {
      if ($HeartbeatSeconds -gt 0 -and ([DateTime]::UtcNow - $lastHeartbeat).TotalSeconds -ge $HeartbeatSeconds) {
        [Console]::Out.WriteLine("Setup subprocess is still running...")
        $lastHeartbeat = [DateTime]::UtcNow
      }
    }
    $process.WaitForExit()

    $stdout = $stdoutTask.Result.TrimEnd()
    $stderr = $stderrTask.Result.TrimEnd()
    if (-not $HideStdout -and -not [string]::IsNullOrWhiteSpace($stdout)) {
      [Console]::Out.WriteLine($stdout)
    }
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      [Console]::Error.WriteLine($stderr)
    }

    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = $stdout
      Stderr = $stderr
    }
  } catch {
    $message = $_.Exception.Message
    [Console]::Error.WriteLine($message)
    return [pscustomobject]@{
      ExitCode = -1
      Stdout = ""
      Stderr = $message
    }
  } finally {
    if ($process) {
      $process.Dispose()
    }
  }
}
