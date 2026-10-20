import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/check-version.mjs', import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('package.json', { version: '0.5.0' });
  write('package-lock.json', { version: '0.5.0', packages: { '': { version: '0.5.0' } } });
  write('CHANGELOG.md', '# 更新记录\n\n## 未发布\n\n## [0.5.0] - 2026-10-20\n\n首次开源。\n');
  write('docs/releases/v0.5.0.md', '# v0.5.0\n\n发布日期：2026-10-20\n\n首次开源。\n');
  const scan = (args = [], extraEnv = {}) => {
    const env = { ...process.env, GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '', ...extraEnv };
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true });
    return { ...result, output: result.stdout + result.stderr };
  };
  return { root, write, scan };
}

test('version check accepts consistent package, lockfile, changelog and release notes without writing', t => {
  const { root, scan } = fixture(t);
  const before = fs.readFileSync(path.join(root, 'package.json'));
  const result = scan();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /v0\.5\.0/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'package.json')), before);
});

test('version check rejects a mismatch in either lockfile version field', t => {
  const { write, scan } = fixture(t);
  for (const lock of [
    { version: '0.1.0', packages: { '': { version: '0.5.0' } } },
    { version: '0.5.0', packages: { '': { version: '0.1.0' } } }
  ]) {
    write('package-lock.json', lock);
    const result = scan();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /package-lock/);
  }
});

test('version check requires the current version to be the first dated changelog entry', t => {
  const { write, scan } = fixture(t);
  write('CHANGELOG.md', '## [0.4.0] - 2026-10-19\n\nOlder release\n\n## [0.5.0] - 2026-10-20\n\nNew release\n');
  const result = scan();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /first.*CHANGELOG/);
});

test('version check rejects duplicate versions and impossible calendar dates', t => {
  const { write, scan } = fixture(t);
  for (const content of [
    '## [0.5.0] - 2026-10-20\n\nOne\n\n## [0.5.0] - 2026-10-19\n\nTwo\n',
    '## [0.5.0] - 2026-02-30\n\nImpossible\n'
  ]) {
    write('CHANGELOG.md', content);
    const result = scan();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /duplicate|date/i);
  }
});

test('version check rejects missing release notes and inconsistent note versions or dates', t => {
  const { root, write, scan } = fixture(t);
  fs.rmSync(path.join(root, 'docs/releases/v0.5.0.md'));
  assert.equal(scan().status, 1);
  for (const content of ['# v0.4.0\n\n发布日期：2026-10-20\n', '# v0.5.0\n\n发布日期：2026-10-19\n']) {
    write('docs/releases/v0.5.0.md', content);
    const result = scan();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /release notes/);
  }
});

test('version check validates explicit release tags and GitHub tag events', t => {
  const { scan } = fixture(t);
  assert.equal(scan(['--tag', 'v0.5.0']).status, 0);
  assert.equal(scan([], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.5.0' }).status, 0);
  for (const result of [scan(['--tag', 'v0.4.0']), scan([], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.4.0' })]) {
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /tag/);
  }
});

test('version check rejects malformed versions before deriving filesystem paths', t => {
  const { write, scan } = fixture(t);
  for (const version of ['v0.5.0', '00.5.0', '0.5', '../outside', '0.5.0-01']) {
    write('package.json', { version });
    const result = scan();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /SemVer/);
  }
});

test('version check supports SemVer prerelease and build identifiers', t => {
  const { write, scan } = fixture(t);
  const version = '0.6.0-rc.1+build.7';
  write('package.json', { version });
  write('package-lock.json', { version, packages: { '': { version } } });
  write('CHANGELOG.md', `## [${version}] - 2026-10-20\n\nRelease candidate\n`);
  write(`docs/releases/v${version}.md`, `# v${version}\n\n发布日期：2026-10-20\n`);
  const result = scan(['--tag', `v${version}`]);
  assert.equal(result.status, 0, result.output);
});
