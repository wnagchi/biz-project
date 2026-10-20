import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './helpers/records-fixture.mjs';
import { startHistoryWatcher } from '../scripts/lib/history-watcher.mjs';
import * as history from '../scripts/lib/records-history.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const end = Date.now() + 8000; while (Date.now() < end) { if (await check()) return; await delay(50); } assert.fail('watcher timed out'); }
function watch(t, root) { const w = startHistoryWatcher(root, { quietMs: 150, reconcileMs: 60000 }); t.after(() => w.close()); return w; }
test('startup scans once and catches current offline changes', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready;
  assert.equal(w.status().scan_state, 'ready'); assert.equal(w.status().active, true);
  const s = history.createSnapshotStore(f.root); assert.equal((await s.versions(f.relative)).length, 1);
  await w.close(); fs.writeFileSync(f.filename, '# Offline\n'); const next = watch(t, f.root); await next.ready;
  assert.equal((await s.versions(f.relative)).length, 2);
});
test('idle does not reread content; single events do not scan unrelated documents', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready; await delay(400);
  const before = w.status().content_reads; await delay(600); assert.equal(w.status().content_reads, before);
  fs.writeFileSync(f.filename, '# Event\n'); const s = history.createSnapshotStore(f.root);
  await until(async () => (await s.versions(f.relative)).length === 2);
  assert.ok(w.status().content_reads - before <= 3, 'single events must not reread the center');
});

test('duplicate native notifications without changed metadata never reread content', async t => {
  const f = fixture(t); let notify;
  t.mock.method(fs, 'watch', (_root, _options, callback) => { notify = callback; return { on() { return this; }, close() {} }; });
  const w = watch(t, f.root); await w.ready; const before = w.status().content_reads;
  for (let i = 0; i < 20; i++) notify('change', f.relative);
  await until(() => w.status().dirty_count === 0);
  assert.equal(w.status().content_reads, before, 'Native access/duplicate notifications are not document changes');
});
test('debounce captures stable bytes and excludes source and temporary events', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready; const s = history.createSnapshotStore(f.root);
  for (let i = 0; i < 5; i++) { fs.writeFileSync(f.filename, `# Save ${i}\n`); await delay(20); }
  await until(async () => (await s.versions(f.relative)).length === 2);
  assert.equal((await s.readVersion(f.relative, (await s.versions(f.relative))[0].id)).content, '# Save 4\n');
  const reads = w.status().content_reads; fs.writeFileSync(path.join(f.root, 'source.mjs'), 'ignored');
  fs.writeFileSync(path.join(f.root, 'projects/one/.temp.tmp'), 'ignored'); await delay(450);
  assert.equal(w.status().content_reads, reads);
});
test('pause persists on restart; explicit resume catches changes', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready;
  fs.writeFileSync(f.filename, '# Before pause\n'); await delay(50); await w.pause();
  fs.writeFileSync(f.filename, '# Paused\n'); await delay(350); await w.close();
  const next = watch(t, f.root); await next.ready; assert.equal(next.status().paused, true);
  const s = history.createSnapshotStore(f.root); assert.equal((await s.versions(f.relative)).length, 1);
  await next.resume(); await until(async () => (await s.versions(f.relative)).length === 2);
  fs.writeFileSync(f.filename, '# After resume\n');
  await until(async () => (await s.versions(f.relative)).length === 3);
});
test('one watcher owns a center and deletion is captured', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready; const other = watch(t, f.root); await other.ready;
  assert.equal(other.status().active, false); assert.match(other.status().warning, /owner|running|busy/i);
  fs.unlinkSync(f.filename); const s = history.createSnapshotStore(f.root);
  await until(async () => (await s.versions(f.relative))[0]?.deleted === true);
});
test('same-process pause cancels pending debounce and resume keeps future events alive', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready;
  fs.writeFileSync(f.filename, '# Pending\n'); await until(() => w.status().dirty_count > 0); await w.pause();
  await w.resume(); const s = history.createSnapshotStore(f.root);
  await until(async () => (await s.versions(f.relative)).length === 2);
  fs.writeFileSync(f.filename, '# Next event\n'); await until(async () => (await s.versions(f.relative)).length === 3);
});
test('500-document startup remains asynchronous and idle performs no content reads', async t => {
  const f = fixture(t), folder = path.join(f.root, 'projects/one/notes'); fs.mkdirSync(folder);
  for (let i = 0; i < 500; i++) fs.writeFileSync(path.join(folder, `document-${i}.md`), `# Document ${i}\n`);
  const started = performance.now(), w = watch(t, f.root);
  assert.equal(w.status().scan_state, 'scanning', 'startup must not wait for full scan');
  await w.ready; const elapsed = performance.now() - started, reads = w.status().content_reads;
  assert.equal(reads, 504); await delay(500); assert.equal(w.status().content_reads, reads);
  const before = performance.now(); fs.writeFileSync(f.filename, '# Single change\n');
  await until(() => w.status().snapshots_created === 505); assert.ok(w.status().content_reads - reads <= 3);
  t.diagnostic(`500 extra documents: startup ${elapsed.toFixed(1)} ms; capture including debounce ${(performance.now() - before).toFixed(1)} ms; idle reads 0`);
  const statReads = w.status().stat_reads;
  const events = [], tracer = fs.watch(f.root, { recursive: true }, (_event, file) => { if (!String(file).startsWith('.biz-project-history')) events.push(String(file)); });
  t.after(() => tracer.close());
  const added = path.join(folder, 'added'), staging = path.join(f.root, 'projects/one/.added.new');
  fs.mkdirSync(staging); fs.writeFileSync(path.join(staging, 'one.md'), '# New document\n'); fs.renameSync(staging, added);
  await until(() => w.status().snapshots_created === 506); await delay(1000); await until(() => w.status().scan_state !== 'scanning');
  t.diagnostic(`Directory rename events: ${JSON.stringify(events)}; incremental stat reads: ${w.status().stat_reads - statReads}`);
  assert.ok(w.status().stat_reads - statReads < 40, 'new directories must reconcile only their subtree, not stat the whole center');
});
test('startup records deletions that happened while service was offline', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready; await w.close(); fs.unlinkSync(f.filename);
  const next = watch(t, f.root); await next.ready; const s = history.createSnapshotStore(f.root);
  assert.equal((await s.versions(f.relative))[0].deleted, true);
});

test('directory deletion captures all removed document tombstones', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready;
  fs.rmSync(path.join(f.root, 'projects/one/features/first'), { recursive: true });
  const s = history.createSnapshotStore(f.root);
  await until(async () => (await s.versions('projects/one/features/first/README.md'))[0]?.deleted === true);
  assert.equal((await s.versions('projects/one/features/first/feature.json'))[0].deleted, true);
});
test('invalid JSON is not snapshotted and a later valid edit recovers', async t => {
  const f = fixture(t), w = watch(t, f.root); await w.ready;
  const file = 'projects/one/features/first/feature.json', filename = path.join(f.root, file), old = fs.readFileSync(filename);
  fs.writeFileSync(filename, '{unfinished'); await until(() => Boolean(w.status().warning));
  const s = history.createSnapshotStore(f.root); assert.equal((await s.versions(file)).length, 1);
  fs.writeFileSync(filename, JSON.stringify({ ...JSON.parse(old), title: 'Valid' }));
  await until(async () => (await s.versions(file)).length === 2);
  assert.equal(w.status().warning, null); assert.equal(fs.readFileSync(filename, 'utf8').includes('Valid'), true);
});
