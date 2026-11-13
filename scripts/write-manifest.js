// Writes latest.json (what the app's "Check for updates" reads) for the exe in dist/.
// Run after building: npm run release   (or: node scripts/write-manifest.js "What changed")
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('../package.json');

const exe = path.join(__dirname, '..', 'dist', 'JobCosting-Portable.exe');
const data = fs.readFileSync(exe);
const manifest = {
  version: pkg.version,
  url: pkg.updates.download,
  size: data.length,
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
  date: new Date().toISOString().slice(0, 10),
  notes: process.argv[2] || '',
};
fs.writeFileSync(path.join(__dirname, '..', 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`latest.json: version ${manifest.version}, ${manifest.size} bytes, sha256 ${manifest.sha256.slice(0, 12)}…`);
