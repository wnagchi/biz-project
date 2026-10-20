import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as history from '../scripts/lib/records-history.mjs';
import { fixture } from './helpers/records-fixture.mjs';
function store(root) {
  assert.equal(typeof history.createSnapshotStore, 'function', 'native snapshots must replace Git');
  return history.createSnapshotStore(root);
}
test('native snapshots preserve original bytes without Git', async t => {
  const f = fixture(t), bytes = Buffer.from('\uFEFF# Exact\r\n'); fs.writeFileSync(f.filename, bytes);
  const s = store(f.root); assert.equal((await s.capture(f.relative, 'startup-scan')).status, 'recorded');
  const versions = await s.versions(f.relative); assert.equal(versions.length, 1);
  assert.equal(versions[0].source, 'startup-scan');
  assert.deepEqual(Buffer.from((await s.readVersion(f.relative, versions[0].id)).content_base64, 'base64'), bytes);
  assert.deepEqual(fs.readFileSync(f.filename), bytes); assert.equal(fs.existsSync(path.join(f.root, '.git')), false);
});
test('equal consecutive contents deduplicate but returning to older content is recorded', async t => {
  const f = fixture(t), s = store(f.root);
  await s.capture(f.relative, 'startup-scan'); await s.capture(f.relative, 'filesystem-watcher');
  assert.equal((await s.versions(f.relative)).length, 1);
  fs.writeFileSync(f.filename, '# Changed\n'); await s.capture(f.relative, 'filesystem-watcher');
  fs.writeFileSync(f.filename, '# Original\n'); await s.capture(f.relative, 'filesystem-watcher');
  assert.equal((await s.versions(f.relative)).length, 3);
});
test('deletion creates a tombstone and old content remains readable', async t => {
  const f = fixture(t), s = store(f.root); await s.capture(f.relative, 'startup-scan');
  fs.unlinkSync(f.filename); await s.capture(f.relative, 'filesystem-watcher');
  const versions = await s.versions(f.relative); assert.equal(versions[0].deleted, true);
  assert.equal((await s.readVersion(f.relative, versions[1].id)).content, '# Original\n');
  assert.equal((await s.capture(f.relative, 'filesystem-watcher')).status, 'unchanged');
});
test('snapshot scope excludes source, config, audit, temporary and unsafe paths', async t => {
  const f = fixture(t), s = store(f.root);
  for (const file of ['../SKILL.md', 'SKILL.md', 'projects/one/SKILL.md', 'projects/one/AGENTS.md', '.gitignore', '.biz-project-history/a.md', 'projects/one/a.tmp', 'projects/one/history/x.json']) {
    await assert.rejects(() => s.capture(file, 'filesystem-watcher'), /record|document|path/i);
  }
  fs.writeFileSync(f.filename, Buffer.from([0xff]));
  await assert.rejects(() => s.capture(f.relative, 'filesystem-watcher'), /UTF|encoded|encoding/i);
  assert.equal((await s.versions(f.relative)).length, 0);
});

test('concurrent captures publish one version and never touch an existing Git directory', async t => {
  const f = fixture(t), s = store(f.root), git = path.join(f.root, '.git'); fs.mkdirSync(git);
  const marker = path.join(git, 'config'); fs.writeFileSync(marker, 'unrelated local data');
  await Promise.all(Array.from({ length: 6 }, () => s.capture(f.relative, 'filesystem-watcher')));
  assert.equal((await s.versions(f.relative)).length, 1); assert.equal(s.metrics.snapshots_created, 1);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'unrelated local data'); assert.deepEqual(fs.readdirSync(git), ['config']);
});
test('snapshots defer active writes and incomplete recovery journals', async t => {
  const f = fixture(t), s = store(f.root); fs.writeFileSync(path.join(f.root, '.write.lock'), 'owner');
  await assert.rejects(() => s.capture(f.relative, 'filesystem-watcher'), /busy/i);
  fs.unlinkSync(path.join(f.root, '.write.lock')); fs.mkdirSync(path.join(f.root, 'projects/one/history'));
  fs.writeFileSync(path.join(f.root, 'projects/one/history/.one.pending'), 'unfinished');
  await assert.rejects(() => s.capture(f.relative, 'filesystem-watcher'), /journal|recovery/i);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), '# Original\n');
});
test('damaged objects are detected without changing the original document', async t => {
  const f = fixture(t), s = store(f.root); await s.capture(f.relative, 'startup-scan');
  const v = (await s.versions(f.relative))[0]; fs.writeFileSync(path.join(f.root, '.biz-project-history/objects', v.hash), 'damaged');
  await assert.rejects(() => s.readVersion(f.relative, v.id), /damaged/i);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), '# Original\n');
});
test('center paths never follow document symlinks', async t => {
  const f = fixture(t), s = store(f.root), outside = path.join(f.base, 'outside.md');
  fs.writeFileSync(outside, '# Private\n'); fs.unlinkSync(f.filename); fs.symlinkSync(outside, f.filename);
  await assert.rejects(() => s.capture(f.relative, 'filesystem-watcher'), /symbolic|unsafe/i);
  assert.equal(fs.readFileSync(outside, 'utf8'), '# Private\n');
});
