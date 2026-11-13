# Measures how long Job Costing takes to start on Windows (GitHub Actions).
# For each variant it launches the app 3 times and records the seconds from launch until
# the app's main process is up ("started") and until the window has loaded ("window ready").
#
# usage: powershell -File scripts\perf-startup-windows.ps1 -Variants "label=path", ...
param([string[]]$Variants)
$ErrorActionPreference = 'Stop'
Remove-Item Env:JOB_COSTING_E2E_AUTOUPDATE -ErrorAction SilentlyContinue

function Stop-App {
  Get-Process | Where-Object { $_.Name -match '^Job' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 4 # let the portable wrapper clean up its unpacked copy
}

$rows = @()
foreach ($v in $Variants) {
  $label, $exe = $v -split '=', 2
  foreach ($run in 1..3) {
    Stop-App
    $marker = Join-Path $env:RUNNER_TEMP ("perf-" + [guid]::NewGuid() + '.txt')
    $env:JOB_COSTING_E2E_MARKER = $marker
    $t0 = [DateTime]::UtcNow
    Start-Process -FilePath $exe
    $started = $null; $ready = $null
    for ($i = 0; $i -lt 600 -and -not $ready; $i++) {
      Start-Sleep -Milliseconds 100
      if (Test-Path -LiteralPath $marker) {
        foreach ($line in Get-Content -LiteralPath $marker) {
          $when = [DateTime]::Parse(($line -split ' ')[0]).ToUniversalTime()
          if (-not $started -and $line -match ' started') { $started = ($when - $t0).TotalSeconds }
          if (-not $ready -and $line -match ' window ready') { $ready = ($when - $t0).TotalSeconds }
        }
        # older versions don't record "window ready"; stop once they've started
        if ($started -and $i -gt 40 -and -not (Select-String -LiteralPath $marker -Pattern 'window ready' -Quiet) -and $label -match 'old') { break }
      }
    }
    $rows += [pscustomobject]@{ Variant = $label; Run = $run; Started = ('{0:N1}s' -f $started); WindowReady = $(if ($ready) { '{0:N1}s' -f $ready } else { '-' }) }
  }
}
Stop-App
$rows | Format-Table -AutoSize | Out-String | Write-Host
