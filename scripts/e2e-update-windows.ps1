# End-to-end test of the in-app update, on a real Windows machine (GitHub Actions).
#
# Starts a real packaged "old" portable exe and lets it update itself to a real packaged
# "new" exe (version 9.9.9) served from a local web server, exactly as a person's copy
# would update from GitHub. Passes only if the exe on disk is replaced AND the new
# version actually starts. Prints the app's own notes and the swap log either way.
#
# usage: powershell -File scripts\e2e-update-windows.ps1 -Old <old exe> -New <new exe>
param([string]$Old, [string]$New)
$ErrorActionPreference = 'Stop'

# Like an ordinary PC: no forced script policy (GitHub's machines set one), and the
# Windows default for people, where running .ps1 scripts is blocked.
Remove-Item Env:PSExecutionPolicyPreference -ErrorAction SilentlyContinue
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Restricted -Force

$work = Join-Path $env:RUNNER_TEMP ("update e2e O'Brien" + [char]0x2019 + 's')
$srv = Join-Path $work 'srv'
New-Item -ItemType Directory -Force -Path $work, $srv | Out-Null
$target = Join-Path $work 'JobCosting-Portable.exe'
Copy-Item -LiteralPath $Old -Destination $target -Force
Copy-Item -LiteralPath $New -Destination (Join-Path $srv 'new.exe') -Force
$newHash = (Get-FileHash -LiteralPath (Join-Path $srv 'new.exe') -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item -LiteralPath (Join-Path $srv 'new.exe')).Length
$manifest = @{ version = '9.9.9'; url = 'http://127.0.0.1:8765/new.exe'; size = $size; sha256 = $newHash; notes = 'e2e' } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $srv 'latest.json'), $manifest)

$server = Start-Process -FilePath 'python' -ArgumentList '-m', 'http.server', '8765', '--bind', '127.0.0.1' -WorkingDirectory $srv -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

$marker = Join-Path $work 'marker.txt'
$updateLog = Join-Path $env:TEMP 'JobCosting-update.log'
Remove-Item -LiteralPath $updateLog -ErrorAction SilentlyContinue
$env:JOB_COSTING_UPDATE_MANIFEST = 'http://127.0.0.1:8765/latest.json'
$env:JOB_COSTING_E2E_AUTOUPDATE = '1'
$env:JOB_COSTING_E2E_MARKER = $marker

Write-Host "Starting the old version: $target"
Start-Process -FilePath $target

$started = $false
for ($i = 0; $i -lt 150 -and -not $started; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $marker) { $started = [bool](Select-String -LiteralPath $marker -Pattern ' 9\.9\.9 started' -Quiet) }
}
Start-Sleep -Seconds 3

Write-Host '--- what the app recorded ---'
if (Test-Path -LiteralPath $marker) { Get-Content -LiteralPath $marker | Write-Host } else { Write-Host '(nothing)' }
Write-Host '--- update swap log ---'
if (Test-Path -LiteralPath $updateLog) { Get-Content -LiteralPath $updateLog -Encoding UTF8 | Write-Host } else { Write-Host '(no log: the swap never ran)' }
Write-Host '--- files ---'
Get-ChildItem -LiteralPath $work | ForEach-Object { Write-Host ("{0,-40} {1,12}" -f $_.Name, $_.Length) }
Write-Host '--- related processes still running ---'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Job|powershell' } | ForEach-Object { Write-Host ("{0,6} {1,-28} {2}" -f $_.ProcessId, $_.Name, ($_.CommandLine -replace '-EncodedCommand \S+', '-EncodedCommand ...')) }

$replaced = ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -eq $newHash)
Write-Host "Exe on disk replaced: $replaced"
Write-Host "New version started:  $started"

Get-Process | Where-Object { $_.Name -match '^Job' } | Stop-Process -Force -ErrorAction SilentlyContinue
Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined -Force

if ($replaced -and $started) { Write-Host 'PASS: the app updated itself end to end.'; exit 0 }
Write-Host 'FAIL: the app did not update itself.'
exit 1
