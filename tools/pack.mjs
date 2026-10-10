// Builds the ready-to-run bundle: release/kids-platform-v<version>-windows.zip
//   npm run bundle                 (typecheck + build, then pack)
//   npm run bundle -- --no-build   (pack the dist/ already built)
// The zip unpacks to one folder: game/ (the built game), start.bat + serve.ps1
// (a launcher that needs nothing installed: Windows PowerShell serves the game
// on localhost and opens the browser), README.txt, VERSION.txt. The version is
// package.json's (npm run release bumps it). Prints the zip's path, size and
// SHA-256.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const name = `kids-platform-v${version}`;
const OUT = path.join(ROOT, 'release');
const STAGE = path.join(OUT, 'stage');
const zipPath = path.join(OUT, `${name}-windows.zip`);

const run = (line) => spawnSync(line, { cwd: ROOT, stdio: 'inherit', shell: true });
const git = (...a) => { const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
const die = (m) => { console.error('\n' + m); process.exit(1); };

// ---- build ----
if (!args.includes('--no-build')) {
  console.log('> npm run build');
  if (run('npm run build').status !== 0) die('The build failed: nothing was packed.');
}
const dist = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) die('dist/ has no index.html: run without --no-build.');

// ---- stage ----
fs.rmSync(STAGE, { recursive: true, force: true });
const dir = path.join(STAGE, name);
fs.mkdirSync(dir, { recursive: true });
// (the dev pages — sound lister, road viewer — aren't for the kid's computer)
fs.cpSync(dist, path.join(dir, 'game'), { recursive: true, filter: (src) => !/[\\/]dev-[^\\/]*\.html$/.test(src) });
// (Windows scripts need CRLF line ends, whatever the checkout has)
for (const f of ['start.bat', 'serve.ps1', 'README.txt']) {
  const text = fs.readFileSync(path.join(ROOT, 'tools', 'bundle', f), 'utf8').replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(path.join(dir, f), text);
}
const sha = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=no') ? ' (uncommitted changes)' : '';
fs.writeFileSync(path.join(dir, 'VERSION.txt'),
  `Kids Platform v${version}\r\nbuilt ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC` + (sha ? ` from ${sha}${dirty}` : '') + '\r\n');

// ---- zip ----
fs.rmSync(zipPath, { force: true });
let z;
if (process.platform === 'win32') {
  // (Windows' own bsdtar writes zips; a git-bash tar on the PATH is GNU tar and can't)
  const bsdtar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  z = spawnSync(bsdtar, ['-a', '-c', '-f', zipPath, '-C', STAGE, name], { stdio: 'inherit' });
} else {
  z = spawnSync('zip', ['-qr', zipPath, name], { cwd: STAGE, stdio: 'inherit' });
}
if (z.status !== 0 || !fs.existsSync(zipPath)) die('Could not write the zip.');
fs.rmSync(STAGE, { recursive: true, force: true });

const sum = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
console.log(`\nPacked ${path.relative(ROOT, zipPath)}  ${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB`);
console.log(`sha256 ${sum}`);
console.log('Copy it to the other computer, unzip, double-click start.bat.');
