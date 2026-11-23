# End-to-end test of the installer, on a real Windows machine (GitHub Actions).
#
# 1. Installs the "old" installer silently, for this user only, as a person would.
# 2. Starts the installed app and lets it update itself: it downloads the "new" installer
#    (version 9.9.9) from a local web server, closes, and the new installer runs silently
#    and starts the new version.
# Passes only if the installed app reports 9.9.9 AND the new version actually starts from
# the install folder. Prints the app's notes and the update log either way.
#
# usage: powershell -File scripts\e2e-install-windows.ps1 -Old <old setup exe> -New <new setup exe>
param([string]$Old, [string]$New)
$ErrorActionPreference = 'Stop'

Remove-Item Env:PSExecutionPolicyPreference -ErrorAction SilentlyContinue
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Restricted -Force

$work = Join-Path $env:RUNNER_TEMP 'install e2e'
$srv = Join-Path $work 'srv'
New-Item -ItemType Directory -Force -Path $work, $srv | Out-Null
Copy-Item -LiteralPath $New -Destination (Join-Path $srv 'setup.exe') -Force
$newHash = (Get-FileHash -LiteralPath (Join-Path $srv 'setup.exe') -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item -LiteralPath (Join-Path $srv 'setup.exe')).Length
# The portable fields must be valid too (the app checks them); point them at the same file.
$manifest = @{ version = '9.9.9'; url = 'http://127.0.0.1:8766/setup.exe'; size = $size; sha256 = $newHash
  setupUrl = 'http://127.0.0.1:8766/setup.exe'; setupSize = $size; setupSha256 = $newHash; notes = 'e2e' } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $srv 'latest.json'), $manifest)

Write-Host "Installing the old version silently: $Old"
$t0 = Get-Date
$p = Start-Process -FilePath $Old -ArgumentList '/S' -PassThru -Wait
Write-Host ("Installer exit code {0} after {1:N1}s" -f $p.ExitCode, ((Get-Date) - $t0).TotalSeconds)
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.Name -match '^Job' } | Stop-Process -Force -ErrorAction SilentlyContinue # runAfterFinish may have started it
$exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Filter 'Job Costing.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { Write-Host 'FAIL: the installer did not install Job Costing.exe under %LOCALAPPDATA%\Programs'; exit 1 }
$exe = $exe.FullName
Write-Host "Installed at: $exe"
$links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Job Costing.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Job Costing.lnk'))
foreach ($l in $links) { Write-Host ("Shortcut {0}: {1}" -f $l, (Test-Path -LiteralPath $l)) }

$server = Start-Process -FilePath 'python' -ArgumentList '-m', 'http.server', '8766', '--bind', '127.0.0.1' -WorkingDirectory $srv -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

$marker = Join-Path $work 'marker.txt'
$updateLog = Join-Path $env:TEMP 'JobCosting-update.log'
Remove-Item -LiteralPath $updateLog -ErrorAction SilentlyContinue
$env:JOB_COSTING_UPDATE_MANIFEST = 'http://127.0.0.1:8766/latest.json'
$env:JOB_COSTING_E2E_AUTOUPDATE = '1'
$env:JOB_COSTING_E2E_MARKER = $marker

# Start the installed old version: it checks for the update and installs it.
Write-Host "Starting the installed old version"
$t0 = Get-Date
Start-Process -FilePath $exe
$started = $false
for ($i = 0; $i -lt 150 -and -not $started; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $marker) { $started = [bool](Select-String -LiteralPath $marker -Pattern ' 9\.9\.9 started' -Quiet) }
}
Start-Sleep -Seconds 3

Write-Host '--- what the app recorded ---'
if (Test-Path -LiteralPath $marker) { Get-Content -LiteralPath $marker | Write-Host } else { Write-Host '(nothing)' }
Write-Host '--- update log ---'
if (Test-Path -LiteralPath $updateLog) { Get-Content -LiteralPath $updateLog -Encoding UTF8 | Write-Host } else { Write-Host '(no log: the installer never ran)' }
$fromInstall = [bool](Select-String -LiteralPath $marker -Pattern (' 9\.9\.9 started .*running ' + [regex]::Escape($exe) + '; installed') -Quiet -ErrorAction SilentlyContinue)
$version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
Write-Host "Installed exe version now: $version"
Write-Host "New version started from the install folder: $fromInstall"

Get-Process | Where-Object { $_.Name -match '^Job' } | Stop-Process -Force -ErrorAction SilentlyContinue
Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined -Force

if ($started -and $fromInstall -and $version -like '9.9.9*') { Write-Host 'PASS: the installed app updated itself end to end.'; exit 0 }
Write-Host 'FAIL: the installed app did not update itself.'
exit 1
