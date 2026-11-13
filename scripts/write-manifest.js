// Writes latest.json (what the app's "Check for updates" reads) for the exe in dist/.
// Run after building: npm run release   (or: node scripts/write-manifest.js "What changed").
// The GitHub release workflow runs this too and publishes latest.json with the exe.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('../package.json');

const exe = path.join(__dirname, '..', 'dist', 'JobCosting-Portable.exe');
// The exe must be built after the version was raised, or it would report the old version
// and everyone would be offered the same update again on every start.
if (fs.statSync(exe).mtimeMs < fs.statSync(path.join(__dirname, '..', 'package.json')).mtimeMs) {
  console.error('dist/JobCosting-Portable.exe is older than package.json. Build first (npm run release).');
  process.exit(1);
}
const data = fs.readFileSync(exe);
const manifest = {
  version: pkg.version,
  url: pkg.updates.download.replace('{version}', pkg.version),
  size: data.length,
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
  date: new Date().toISOString().slice(0, 10),
  notes: process.argv[2] || '',
};
fs.writeFileSync(path.join(__dirname, '..', 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`latest.json: version ${manifest.version}, ${manifest.size} bytes, sha256 ${manifest.sha256.slice(0, 12)}…`);
