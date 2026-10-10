// One command to version and publish the game:
//   npm run release                 patch bump  (0.1.0 -> 0.1.1)
//   npm run release -- minor        0.1.0 -> 0.2.0     (also: major, or an exact 1.2.3)
//   npm run release -- 0.1.0             the version package.json already has: no bump, release as is
//   npm run release -- minor --dry-run   show what it would do; change nothing
//   npm run release -- patch --draft     publish the release as a draft to look at first
// It checks the tree is clean (nothing tracked modified), on main and up to
// date with origin, that the build passes, then: bumps package.json (and the
// lockfile), commits "Release vX.Y.Z", builds the bundle from that commit
// (tools/pack.mjs -> release/kids-platform-vX.Y.Z-windows.zip), tags vX.Y.Z,
// pushes the commit and the tag, and creates the GitHub release with the zip
// attached (the notes: the newest entry of docs/HISTORY.md + how to run it).
// Needs git and the GitHub CLI (`gh auth login`).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const draft = argv.includes('--draft');
const bump = argv.find(a => !a.startsWith('--')) ?? 'patch';

const sh = (line, opts = {}) => spawnSync(line, { cwd: ROOT, shell: true, encoding: 'utf8', ...opts });
const out = (line) => { const r = sh(line); return r.status === 0 ? r.stdout.trimEnd() : null; };
const die = (m) => { console.error('\n' + m); process.exit(1); };
const step = (m) => console.log('\n> ' + m);
const must = (line, why) => { const r = sh(line, { stdio: 'inherit', encoding: undefined }); if (r.status !== 0) die(why); };

// ---- the version ----
const pkgPath = path.join(ROOT, 'package.json');
const current = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
function nextVersion(v, how) {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [a, b, c] = v.split('.').map(Number);
  if (how === 'major') return `${a + 1}.0.0`;
  if (how === 'minor') return `${a}.${b + 1}.0`;
  if (how === 'patch') return `${a}.${b}.${c + 1}`;
  return die(`Unknown version "${how}": use patch, minor, major or an exact x.y.z.`);
}
const version = nextVersion(current, bump);
const tag = `v${version}`;
const zipName = `kids-platform-${tag}-windows.zip`;
const zip = path.join(ROOT, 'release', zipName);

// ---- the release notes: the newest HISTORY.md entry, without its picture tables ----
function notesFor() {
  const hist = fs.readFileSync(path.join(ROOT, 'docs', 'HISTORY.md'), 'utf8').replace(/\r\n/g, '\n');
  const m = hist.match(/\n## ([^\n]+)\n([\s\S]*?)\n---\n/);
  const body = m ? `### ${m[1]}\n${m[2].split('\n').filter(l => !l.startsWith('|')).join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n\n` : '';
  const sha = fs.existsSync(zip) ? createHash('sha256').update(fs.readFileSync(zip)).digest('hex') : '(worked out when the zip is built)';
  return `${body}## Run it on another Windows computer\n\n`
    + `1. Download **${zipName}** below and unzip it (or copy it over on a USB stick).\n`
    + `2. Double-click **start.bat** — the game opens in the browser. Nothing to install.\n\n`
    + `Use Edge or Chrome; plug in the USB wheel first.\n\n`
    + `SHA-256 of the zip: \`${sha}\`\n`;
}

// ---- checks ----
step(`Release ${current} -> ${version} (${tag})`);
if (out('gh auth status') === null) die('The GitHub CLI isn\'t signed in: run `gh auth login`.');
const branch = out('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') die(`On branch "${branch}": releases are made from main.`);
const dirty = out('git status --porcelain --untracked-files=no');
if (dirty && !dryRun) die('There are uncommitted changes to tracked files — commit or stash them first:\n' + dirty);
if (dirty) console.log('(a real release would stop here: uncommitted changes to tracked files)\n' + dirty);
if (out('git fetch origin') === null) die('Could not reach origin (git fetch failed).');
const behind = Number(out('git rev-list --count HEAD..origin/main') ?? 0);
if (behind > 0) die(`main is ${behind} commit(s) behind origin/main: pull first.`);
if (out(`git tag -l ${tag}`) || out(`git ls-remote --tags origin ${tag}`)) die(`The tag ${tag} already exists.`);
const ahead = Number(out('git rev-list --count origin/main..HEAD') ?? 0);
console.log(`${ahead} commit(s) on main not on origin yet: they are pushed with the release.`);

if (dryRun) {
  console.log(`\n--dry-run: would ${version === current ? "keep package.json at" : "bump package.json to"} ${version}, ${version === current ? "" : "commit, "}build ${zipName}, tag ${tag}, push main + ${tag}${draft ? ', create a DRAFT release' : ', create the release'} on ${out('gh repo view --json url --jq .url')}.`);
  console.log('\nThe release notes would be:\n----\n' + notesFor() + '----');
  process.exit(0);
}

// ---- build first: nothing is changed if it fails ----
step('npm run build');
must('npm run build', 'The build failed: nothing was changed.');

// ---- bump, commit, pack ----
// (an exact version equal to package.json's — the first release, say — needs no bump)
if (version !== current) {
  step(`bump to ${version}`);
  must(`npm version ${version} --no-git-tag-version`, 'npm version failed.');
  const undo = () => { sh('git checkout -- package.json package-lock.json'); };
  if (sh('git add package.json package-lock.json').status !== 0) { undo(); die('git add failed.'); }
  const c = sh(`git commit -m "Release ${tag}"`, { stdio: 'inherit', encoding: undefined });
  if (c.status !== 0) { undo(); die('git commit failed.'); }
}
step('pack the bundle');
if (sh('node tools/pack.mjs --no-build', { stdio: 'inherit', encoding: undefined }).status !== 0 || !fs.existsSync(zip)) {
  if (version !== current) sh('git reset --hard HEAD~1'); // (our own release commit: the tree was clean before it)
  die('Packing failed' + (version !== current ? ': the version bump was undone.' : '.'));
}

// ---- tag, push, release ----
step(`tag ${tag} and push`);
must(`git tag -a ${tag} -m "Kids Platform ${tag}"`, 'git tag failed.');
must(`git push origin main ${tag}`, `Push failed. The release commit and tag ${tag} exist locally: fix the problem, then \`git push origin main ${tag}\` and \`gh release create ${tag} release/${zipName}\`.`);
step('create the GitHub release');
const notes = path.join(ROOT, 'release', 'notes.md');
fs.writeFileSync(notes, notesFor());
must(`gh release create ${tag} "${zip}" --title "Kids Platform ${tag}" --notes-file "${notes}"${draft ? ' --draft' : ' --latest'}`,
  `The release could not be created (the tag is pushed). Retry: gh release create ${tag} release/${zipName} --notes-file release/notes.md`);
console.log('\nReleased: ' + out(`gh release view ${tag} --json url --jq .url`));
