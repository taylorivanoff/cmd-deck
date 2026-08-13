#!/usr/bin/env node
/**
 * Manually bump version across package.json, Cargo.toml, and tauri.conf.json,
 * then commit and push.
 * CI already auto patch-bumps on every master/main push; use this for
 * minor/major bumps, or when you want to set the version yourself.
 *
 * Usage:
 *   node scripts/bump-version.js [patch|minor|major]
 *   npm run bump
 *   npm run bump -- minor
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const level = (process.argv[2] || 'patch').toLowerCase();

if (!['patch', 'minor', 'major'].includes(level)) {
  console.error(`Invalid bump level "${level}". Use patch, minor, or major.`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

function runCapture(cmd) {
  return run(cmd, { silent: true }).trim();
}

function syncTauriVersion(version) {
  const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    let cargo = fs.readFileSync(cargoPath, 'utf8');
    cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
    fs.writeFileSync(cargoPath, cargo);
  }

  const confPath = path.join(root, 'src-tauri', 'tauri.conf.json');
  if (fs.existsSync(confPath)) {
    const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    conf.version = version;
    fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
  }
}

const branch = runCapture('git rev-parse --abbrev-ref HEAD');
if (branch !== 'master' && branch !== 'main') {
  console.error(`Must be on master/main (currently on ${branch}).`);
  process.exit(1);
}

const status = runCapture('git status --porcelain');
if (status) {
  console.error('Working tree is not clean. Commit or stash changes first, then bump.');
  console.error(status);
  process.exit(1);
}

runCapture('git fetch origin');
const behind = runCapture(`git rev-list --count HEAD..origin/${branch}`);
if (behind !== '0') {
  console.error(`Local ${branch} is behind origin/${branch}. Pull first.`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const oldVersion = pkg.version;
run(`npm version ${level} --no-git-tag-version`);
const newVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
syncTauriVersion(newVersion);

const toAdd = ['package.json'];
if (fs.existsSync(path.join(root, 'src-tauri', 'Cargo.toml'))) {
  toAdd.push('src-tauri/Cargo.toml');
}
if (fs.existsSync(path.join(root, 'src-tauri', 'tauri.conf.json'))) {
  toAdd.push('src-tauri/tauri.conf.json');
}
for (const lock of ['package-lock.json', 'bun.lock', 'bun.lockb', 'yarn.lock']) {
  if (fs.existsSync(path.join(root, lock))) toAdd.push(lock);
}

run(`git add -- ${toAdd.join(' ')}`);
run(`git commit -m "chore: bump version to ${newVersion}"`);
run(`git push origin ${branch}`);

console.log(`\nBumped ${oldVersion} → ${newVersion} and pushed to ${branch}.`);
console.log('GitHub Actions will build and publish the release if the version changed.');
