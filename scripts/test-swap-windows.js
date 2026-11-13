// Proves the in-app update swap works in real Windows PowerShell. Run by the GitHub
// release workflow on a Windows machine (does nothing elsewhere).
//
// It sets up the awkward real-world conditions at once:
//  - the folder name has both kinds of apostrophe (O'Brien’s);
//  - the old exe is held open, like a running app, so the swap has to wait and retry;
//  - running .ps1 scripts is disabled by policy, as on many company PCs (and we check
//    that a normal script really is blocked, so the test means something).
// Harmless Windows programs (hostname.exe as the "old version", whoami.exe as the "new")
// stand in for the app.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../src/updater');

if (process.platform !== 'win32') {
  console.log('Windows only; skipped.');
  process.exit(0);
}

const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
// GitHub's machines force scripts on with this variable; real PCs don't have it.
const env = { ...process.env };
delete env.PSExecutionPolicyPreference;
const ps = (args, opts = {}) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', ...args], { encoding: 'utf8', timeout: 180000, env, ...opts });
const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap test O\'Brien\u2019s '));
const target = path.join(dir, 'JobCosting-Portable.exe');
const fresh = path.join(dir, 'download', 'JobCosting-Portable-9.9.9.exe');
fs.mkdirSync(path.dirname(fresh));
fs.copyFileSync(path.join(sys32, 'HOSTNAME.EXE'), target);
fs.copyFileSync(path.join(sys32, 'whoami.exe'), fresh);
const wanted = fs.readFileSync(fresh);
const log = path.join(os.tmpdir(), 'JobCosting-update.log');
try { fs.unlinkSync(log); } catch { /* none yet */ }

// Disable scripts for this user, and check a plain .ps1 is now refused.
ps(['-Command', 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Restricted -Force']);
const probe = path.join(dir, 'probe.ps1');
fs.writeFileSync(probe, "'script ran'");
const blocked = ps(['-File', probe]);
console.log(`Execution policies:\n${ps(['-Command', 'Get-ExecutionPolicy -List | Out-String']).stdout.trim()}`);
console.log(`A .ps1 file ${/script ran/.test(blocked.stdout) ? 'still RAN' : 'is blocked'}${blocked.stderr ? ` (${blocked.stderr.trim().split('\n')[0]})` : ''}.`);
if (/script ran/.test(blocked.stdout)) fail('could not set up a "scripts disabled" PC for the test');

(async () => {
  try {
    // Hold the old exe open for 5 seconds without delete sharing (like a running app).
    const marker = path.join(dir, 'locked.txt');
    const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$f = [System.IO.File]::Open(${U.psQuote(target)}, 'Open', 'Read', 'Read'); Set-Content -LiteralPath ${U.psQuote(marker)} -Value 1; Start-Sleep -Seconds 5; $f.Close()`], { stdio: 'inherit', env });
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise(r => setTimeout(r, 200));
    if (!fs.existsSync(marker)) fail('the lock holder did not start');

    // The same command the app runs.
    const t0 = Date.now();
    const run = ps(['-WindowStyle', 'Hidden', '-EncodedCommand', U.swapCommand(fresh, target)]);
    const secs = (Date.now() - t0) / 1000;
    await new Promise(r => holder.on('exit', r));

    console.log(`Swap finished in ${secs.toFixed(1)}s with exit code ${run.status}.`);
    if (run.stderr && run.stderr.trim()) console.log(`stderr: ${run.stderr.trim()}`);
    const logText = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '(missing)';
    console.log(`Update log:\n${logText}`);
    if (!logText.includes(target)) fail('the log does not show the full folder name (apostrophes garbled?)');
    if (run.status !== 0) fail('PowerShell exited with an error');
    if (!fs.readFileSync(target).equals(wanted)) fail('the old exe was not replaced by the new one');
    if (secs < 2) fail('the swap did not wait for the old exe to be released');
    if (fs.existsSync(`${target}.new`)) fail('the staged .new file was left behind');
    if (fs.existsSync(`${target}.old`)) fail('the .old backup was left behind');
    if (fs.existsSync(fresh)) fail('the downloaded copy was not removed');
    if (!/Replaced; starting the new version/.test(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '')) fail('the log does not record a successful replace');
  } finally {
    ps(['-Command', 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined -Force']);
  }
  if (!process.exitCode) console.log('PASS: the update swap works on Windows (locked exe, apostrophes, scripts disabled).');
})();
