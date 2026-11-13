// In-app updates for the portable Windows exe.
//
// A small file, latest.json, sits next to the exe on GitHub:
//   { "version": "1.2.0", "url": "https://raw.githubusercontent.com/.../JobCosting-Portable.exe",
//     "size": 94165781, "sha256": "...", "notes": "..." }
// The app reads it, and if the version is newer it downloads the exe, checks the size and
// SHA-256, then hands over to a small PowerShell script that waits for the app to close,
// swaps the exe in place and starts it again.
//
// Everything here is pure (no Electron) so it can be unit-tested; main.js does the I/O.

// Only these addresses are trusted for update files.
const TRUSTED_PREFIXES = [
  'https://raw.githubusercontent.com/JPDC17/costing/',
  'https://github.com/JPDC17/costing/',
];

// "1.10.2" > "1.9.9"; missing parts count as 0; anything after a "-" is ignored.
function compareVersions(a, b) {
  const parse = v => String(v).trim().replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Check latest.json has everything needed and points somewhere trusted.
function validateManifest(m, extraPrefixes = []) {
  if (!m || typeof m !== 'object') throw new Error('The update information is not in the expected format.');
  const version = String(m.version || '').trim();
  if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error('The update information has no valid version number.');
  const url = String(m.url || '');
  if (![...TRUSTED_PREFIXES, ...extraPrefixes].some(p => url.startsWith(p))) throw new Error('The update points to an address the app does not trust.');
  const size = Number(m.size);
  if (!Number.isInteger(size) || size < 1024 * 1024 || size > 500 * 1024 * 1024) throw new Error('The update information has an invalid file size.');
  const sha256 = String(m.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('The update information has no valid checksum.');
  const notes = typeof m.notes === 'string' ? m.notes.slice(0, 2000) : '';
  return { version, url, size, sha256, notes, date: typeof m.date === 'string' ? m.date.slice(0, 40) : '' };
}

// The PowerShell commands that swap the exe once the app has closed. They copy the new
// exe next to the old one, then retry an atomic replace until the old exe is no longer
// in use (up to 2 minutes). If the replace can't be done (e.g. a read-only folder) they
// start the new version from where it was downloaded instead, so the person still gets
// the update. $New and $Target are set in front of this by swapCommand().
const POWERSHELL_SWAP = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$log = Join-Path $env:TEMP 'JobCosting-update.log'
function Write-Log([string]$m) { Add-Content -LiteralPath $log -Encoding UTF8 -Value ((Get-Date -Format s) + '  ' + $m) }
Write-Log ('Updating ' + $Target)
$staged = $Target + '.new'
$backup = $Target + '.old'
$done = $false
try {
  Copy-Item -LiteralPath $New -Destination $staged -Force
  for ($i = 0; $i -lt 240 -and -not $done; $i++) {
    try {
      [System.IO.File]::Replace($staged, $Target, $backup)
      $done = $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
} catch {
  Write-Log ('Could not copy next to the old version: ' + $_.Exception.Message)
}
if ($done) {
  Write-Log 'Replaced; starting the new version'
  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $New -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $Target
} else {
  Write-Log 'Could not replace the old version; starting the new one from the download folder'
  Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $New
}
`;

// A PowerShell single-quoted string. PowerShell also treats curly quotes as quotes, so
// every kind is doubled (e.g. a folder called O’Brien's Jobs stays intact).
function psQuote(s) {
  return `'${String(s).replace(/['\u2018\u2019\u201a\u201b]/g, q => q + q)}'`;
}

// The full command, base64-encoded for powershell -EncodedCommand. Commands passed this
// way aren't blocked by the "running scripts is disabled" policy that applies to .ps1
// files on many company PCs.
function swapCommand(newExe, target) {
  const text = `$New = ${psQuote(newExe)}\n$Target = ${psQuote(target)}\n${POWERSHELL_SWAP}`;
  return Buffer.from(text, 'utf16le').toString('base64');
}

// Starts the swap as its own hidden PowerShell process and exits 0 once it's running.
// Start-Process gives the swap a normal (hidden) console, and it isn't tied to the app,
// so it keeps going after the app closes.
function launchCommand(newExe, target) {
  const text = [
    "$ErrorActionPreference = 'Stop'",
    `$p = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${swapCommand(newExe, target)}'`,
    'if ($p -and $p.Id) { exit 0 } else { exit 1 }',
  ].join('\n');
  return Buffer.from(text, 'utf16le').toString('base64');
}

module.exports = { TRUSTED_PREFIXES, compareVersions, validateManifest, POWERSHELL_SWAP, psQuote, swapCommand, launchCommand };
