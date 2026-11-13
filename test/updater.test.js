const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/updater');

const good = {
  version: '1.2.0',
  url: 'https://raw.githubusercontent.com/JPDC17/costing/main/dist/JobCosting-Portable.exe',
  size: 94165781,
  sha256: 'a'.repeat(64),
  notes: 'New logo',
};

test('compareVersions', () => {
  assert.strictEqual(U.compareVersions('1.1.0', '1.0.9'), 1);
  assert.strictEqual(U.compareVersions('1.10.0', '1.9.9'), 1);
  assert.strictEqual(U.compareVersions('1.1', '1.1.0'), 0);
  assert.strictEqual(U.compareVersions('v2.0.0', '1.99.99'), 1);
  assert.strictEqual(U.compareVersions('1.0.0', '1.0.1'), -1);
  assert.strictEqual(U.compareVersions('1.2.0-beta', '1.2.0'), 0);
});

test('validateManifest accepts a good manifest', () => {
  assert.deepStrictEqual(U.validateManifest(good), { ...good, date: '' });
});

test('validateManifest rejects bad or untrusted manifests', () => {
  assert.throws(() => U.validateManifest(null), /expected format/);
  assert.throws(() => U.validateManifest({ ...good, version: 'latest' }), /version/);
  assert.throws(() => U.validateManifest({ ...good, url: 'https://evil.example/JobCosting.exe' }), /does not trust/);
  assert.throws(() => U.validateManifest({ ...good, url: 'http://raw.githubusercontent.com/JPDC17/costing/x.exe' }), /does not trust/);
  assert.throws(() => U.validateManifest({ ...good, url: 'https://raw.githubusercontent.com/someone-else/costing/x.exe' }), /does not trust/);
  assert.throws(() => U.validateManifest({ ...good, size: 12 }), /size/);
  assert.throws(() => U.validateManifest({ ...good, sha256: 'xyz' }), /checksum/);
  // a local test server is only trusted when explicitly allowed
  const local = { ...good, url: 'http://127.0.0.1:8080/JobCosting.exe' };
  assert.throws(() => U.validateManifest(local), /does not trust/);
  assert.strictEqual(U.validateManifest(local, ['http://127.0.0.1:']).url, local.url);
});

test('psQuote doubles every kind of single quote PowerShell recognises', () => {
  assert.strictEqual(U.psQuote("C:\\Jobs\\O'Brien\u2019s"), "'C:\\Jobs\\O''Brien\u2019\u2019s'");
  assert.strictEqual(U.psQuote('plain'), "'plain'");
});

test('swapCommand encodes the paths and the swap commands for -EncodedCommand', () => {
  const enc = U.swapCommand("C:\\Users\\Pat O'Neil\\AppData\\Local\\Temp\\new.exe", 'D:\\Apps\\JobCosting-Portable.exe');
  const text = Buffer.from(enc, 'base64').toString('utf16le');
  assert.ok(text.startsWith("$New = 'C:\\Users\\Pat O''Neil\\AppData\\Local\\Temp\\new.exe'\n$Target = 'D:\\Apps\\JobCosting-Portable.exe'\n"));
  assert.ok(text.endsWith(U.POWERSHELL_SWAP));
  assert.ok(enc.length < 30000); // well inside the Windows command-line limit
});

test('launchCommand starts the swap as its own hidden process', () => {
  const text = Buffer.from(U.launchCommand('C:\\T\\new.exe', 'D:\\A\\app.exe'), 'base64').toString('utf16le');
  assert.match(text, /Start-Process -FilePath 'powershell\.exe' -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','[A-Za-z0-9+\/=]+'/);
  const inner = text.match(/'-EncodedCommand','([A-Za-z0-9+\/=]+)'/)[1];
  assert.strictEqual(inner, U.swapCommand('C:\\T\\new.exe', 'D:\\A\\app.exe')); // base64 has no quotes, so it's safe inside '...'
  assert.ok(U.launchCommand('C:\\T\\new.exe', 'D:\\A\\app.exe').length < 30000);
});

test('the PowerShell swap commands always restart the app', () => {
  const s = U.POWERSHELL_SWAP;
  assert.ok(!/param\(/.test(s)); // paths are set in front of it, not passed as parameters
  assert.match(s, /\[System\.IO\.File\]::Replace\(\$staged, \$Target, \$backup\)/);
  assert.strictEqual((s.match(/Start-Process -FilePath/g) || []).length, 2); // new version starts either way
  assert.ok(!/Invoke-Expression|iex |DownloadString/i.test(s));
  // braces and parentheses balance
  for (const [o, c] of [['{', '}'], ['(', ')']]) assert.strictEqual(s.split(o).length, s.split(c).length, `${o}${c} balanced`);
});
