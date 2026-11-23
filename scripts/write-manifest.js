// Writes latest.json (what the app's "Check for updates" reads) for the files in dist/:
// the portable exe, and the installer when it was built too.
// Run after building: npm run release   (or: node scripts/write-manifest.js "What changed").
// The GitHub release workflow runs this too and publishes latest.json with the exes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');
const built = fs.statSync(path.join(root, 'package.json')).mtimeMs;
// Each file must be built after the version was raised, or it would report the old
// version and everyone would be offered the same update again on every start.
function describe(name) {
  const file = path.join(root, 'dist', name);
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).mtimeMs < built) {
    console.error(`dist/${name} is older than package.json. Build first (npm run release).`);
    process.exit(1);
  }
  const data = fs.readFileSync(file);
  return { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

const portable = describe('JobCosting-Portable.exe');
if (!portable) {
  console.error('dist/JobCosting-Portable.exe is missing. Build first (npm run release).');
  process.exit(1);
}
const setup = describe('JobCosting-Setup.exe');
const manifest = {
  version: pkg.version,
  url: pkg.updates.download.replace('{version}', pkg.version),
  size: portable.size,
  sha256: portable.sha256,
  ...(setup ? { setupUrl: pkg.updates.setupDownload.replace('{version}', pkg.version), setupSize: setup.size, setupSha256: setup.sha256 } : {}),
  date: new Date().toISOString().slice(0, 10),
  notes: process.argv[2] || '',
};
fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`latest.json: version ${manifest.version}, portable ${manifest.size} bytes${setup ? `, installer ${setup.size} bytes` : ' (no installer built)'}`);
