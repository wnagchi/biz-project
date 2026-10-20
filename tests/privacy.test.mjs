import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/check-privacy.mjs', import.meta.url));
const fakeToken = ['ghp', 'x'.repeat(36)].join('_');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-privacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', windowsHide: true });
  git('init', '--quiet');
  fs.writeFileSync(path.join(root, '.gitignore'), '.env\nAGENTS.override.md\n');
  const write = (name, content) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const scan = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
    return { ...result, output: result.stdout + result.stderr };
  };
  return { root, git, write, scan };
}

test('privacy check accepts public examples and leaves ignored local files untouched', t => {
  const { write, scan } = fixture(t);
  write('README.md', 'Example: D:\\work\\example-project; ~/.config/biz-project/config.json\n');
  write('.env.example', 'API_KEY=replace-me\n');
  write('.env', fakeToken);
  write('AGENTS.override.md', 'Private local guidance');
  const result = scan();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /checked/i);
});

test('privacy check rejects ignored files that have already entered the Git index', t => {
  const { git, write, scan } = fixture(t);
  write('.env', 'API_KEY=replace-me');
  write('AGENTS.override.md', 'local guidance');
  git('add', '--force', '.env', 'AGENTS.override.md');
  const result = scan();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /private file.*\.env/i);
  assert.match(result.output, /AGENTS\.override\.md/);
});

test('privacy check detects untracked credentials without printing their value', t => {
  const { write, scan } = fixture(t);
  write('accidental-note.md', `token: ${fakeToken}\n`);
  const result = scan();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /GitHub token.*accidental-note\.md":1/);
  assert.equal(result.output.includes(fakeToken), false);
});

test('staged privacy check reads index bytes even after the working copy is cleaned', t => {
  const { git, write, scan } = fixture(t);
  write('README.md', `token: ${fakeToken}\n`);
  git('add', 'README.md');
  write('README.md', 'Clean working copy\n');
  const result = scan('--staged');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /GitHub token.*README\.md":1/);
  assert.equal(result.output.includes(fakeToken), false);
  assert.equal(scan().status, 0);
});

test('privacy check flags private keys and personal home paths in public documents', t => {
  const { write, scan } = fixture(t);
  write('note.md', ['-----BEGIN ' + 'PRIVATE KEY-----', ['C:', 'Users', 'someone', 'config.json'].join('\\'), ['', 'home', 'someone', '.config', 'file'].join('/'), ['C:', 'Users', 'someone', 'file'].join('/')].join('\n'));
  const result = scan();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /private key.*note\.md":1/);
  assert.match(result.output, /personal home path.*note\.md":2/);
  assert.match(result.output, /personal home path.*note\.md":3/);
  assert.match(result.output, /personal home path.*note\.md":4/);
});

test('privacy check rejects local records, certificates, and generated output by path', t => {
  const { write, scan } = fixture(t);
  for (const name of ['records/project.json', 'records/.env.example', 'server.p12', 'config.local.json', 'docs/verification.md', 'web/build/chunk.js']) write(name, '{}');
  const result = scan();
  assert.equal(result.status, 1, result.output);
  for (const name of ['records/project.json', 'records/.env.example', 'server.p12', 'config.local.json', 'docs/verification.md', 'web/build/chunk.js']) assert.ok(result.output.includes(name), result.output);
});

test('privacy check refuses staged symlinks without reading their targets', t => {
  const { root, git, scan } = fixture(t);
  // Store the link object in the controlled repository, including on Windows without symlink privileges.
  const linkHash = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: '../../private', encoding: 'utf8', windowsHide: true });
  git('update-index', '--add', '--cacheinfo', `120000,${linkHash.toString().trim()},private-link`);
  const result = scan('--staged');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /symlink.*private-link/);
});

test('privacy check fails closed outside Git and for unsupported options', t => {
  const { scan } = fixture(t);
  assert.equal(scan('--unknown').status, 2);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-no-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Git repository/);
});
