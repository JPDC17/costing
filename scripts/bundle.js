// Packs the app into bundle/ before electron-builder runs, so the exe carries only the
// code it uses: the main process (with the Excel library) becomes one minified file,
// instead of ~45 MB of node_modules (much of it browser builds and polyfills the app
// never loads). The window's files (renderer/, preload.js, calc.js) are copied as is.
//
// usage: node scripts/bundle.js   (npm run dist:* and npm run release do this for you)
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'bundle');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'main.js')],
  outfile: path.join(out, 'main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  minify: true,
  legalComments: 'linked', // keeps the libraries' licence notices in main.js.LEGAL.txt
  logLevel: 'warning',
});

for (const f of ['preload.js', 'calc.js']) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));
fs.cpSync(path.join(root, 'src', 'renderer'), path.join(out, 'renderer'), { recursive: true });

const size = dir => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`bundle/: ${(size(out) / 1048576).toFixed(1)} MB (main.js ${(fs.statSync(path.join(out, 'main.js')).size / 1024).toFixed(0)} KB)`);
