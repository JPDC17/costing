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

test('the PowerShell swap script takes its paths as parameters and always restarts the app', () => {
  const s = U.POWERSHELL_SWAP;
  assert.match(s, /^param\(\[string\]\$New, \[string\]\$Target\)/);
  assert.match(s, /\[System\.IO\.File\]::Replace\(\$staged, \$Target, \$backup\)/);
  assert.strictEqual((s.match(/Start-Process -FilePath/g) || []).length, 2); // new version starts either way
  assert.ok(!/Invoke-Expression|iex |DownloadString/i.test(s));
  // braces and parentheses balance
  for (const [o, c] of [['{', '}'], ['(', ')']]) assert.strictEqual(s.split(o).length, s.split(c).length, `${o}${c} balanced`);
});
