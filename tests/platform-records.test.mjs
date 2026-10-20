import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, test, mock } from 'node:test';
import { openRecords, dashboard, projectDetail, featureDetail, saveOverview, saveFeature,
  newFeature, newUpdate, searchRecords } from '../scripts/lib/platform-records.mjs';

let sandbox, root, project, feature;
const pid = 'project-one', fid = 'feature-one';
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-platform-records-'));
  root = path.join(sandbox, 'records'); project = path.join(root, 'projects', pid); feature = path.join(project, 'features', fid);
  put(path.join(root, 'registry.json'), { kind: 'biz-project', schema_version: 1, projects: {
    [pid]: { name: '项目一', identity: 'directory:example', paths: [path.join(sandbox, 'code')], hosts: { codex: { rules_file: 'AGENTS.md', rules_selection: 'default' } } }
  } });
  put(path.join(project, 'project.json'), { schema_version: 1, id: pid, name: '项目一', development_branch: null, release_branch: null, custom: 'preserved' });
  put(path.join(project, 'README.md'), '# 项目一\n\n约定：不要自动发布。\n');
  put(path.join(feature, 'feature.json'), { schema_version: 1, id: fid, project_id: pid, title: '搜索功能', owner: 'codex', status: 'developing', custom: 42 });
  put(path.join(feature, 'README.md'), '# 搜索功能\n\nFeature ID: feature-one\nOwner: codex\nStatus: developing\n\n## Scope\n\n中文路径搜索。\n');
});
afterEach(() => {
  assert.equal(path.dirname(sandbox), os.tmpdir()); assert.ok(path.basename(sandbox).startsWith('biz-project-platform-records-'));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('platform reads an existing center without initialization or guessed defaults', () => {
  assert.equal(openRecords({ recordsRoot: root }), root);
  const missing = path.join(sandbox, 'missing');
  assert.throws(() => openRecords({ recordsRoot: missing }), /确认|center|中心/i);
  assert.equal(fs.existsSync(missing), false);
});
test('dashboard derives actual statuses and leaves unknown releases unknown', () => {
  const data = dashboard(root);
  assert.deepEqual(data.stats, { projects: 1, features: 1, active: 1, blocked: 0, verified: 0, released: 0 });
  assert.equal(data.features[0].title, '搜索功能'); assert.deepEqual(data.projects[0].hosts, ['codex']);
  assert.equal(projectDetail(root, pid).project.release_branch, null);
});
test('feature summaries expose recorded creation time without inventing one from file metadata', () => {
  const file = path.join(feature, 'feature.json'), metadata = JSON.parse(fs.readFileSync(file));
  assert.equal(projectDetail(root, pid).features[0].created_at, undefined);
  put(file, { ...metadata, created_at: '2026-01-02T03:04:05Z' });
  assert.equal(projectDetail(root, pid).features[0].created_at, '2026-01-02T03:04:05Z');
  assert.equal(dashboard(root).features[0].created_at, '2026-01-02T03:04:05Z');
  assert.notEqual(projectDetail(root, pid).features[0].updated_at, '2026-01-02T03:04:05Z');
  assert.equal(JSON.parse(fs.readFileSync(file)).custom, 42);
});
test('unknown status names cannot collide with inherited object properties', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(feature, 'feature.json'), 'utf8'));
  for (const status of ['__proto__', 'constructor', 'toString']) {
    put(path.join(feature, 'feature.json'), { ...metadata, status });
    const data = JSON.parse(JSON.stringify(dashboard(root)));
    assert.equal(Object.hasOwn(data.projects[0].status_counts, status), true);
    assert.equal(data.projects[0].status_counts[status], 1);
    assert.equal(data.features[0].status, status);
    assert.equal(data.stats.released, 0);
  }
});
test('a damaged feature produces a warning without hiding healthy projects', () => {
  put(path.join(project, 'features/broken/feature.json'), '{bad');
  const data = dashboard(root); assert.equal(data.projects.length, 1); assert.equal(data.features.length, 1); assert.ok(data.warnings.length);
});
test('overview edits are version checked and preserve project profile fields', () => {
  const before = projectDetail(root, pid);
  const saved = saveOverview(root, pid, { revision: before.overview_revision, content: '# Updated overview\n' }, 'browser');
  assert.equal(saved.overview, '# Updated overview\n'); assert.equal(saved.project.custom, 'preserved');
  assert.throws(() => saveOverview(root, pid, { revision: before.overview_revision, content: 'stale' }, 'browser'), error => error.status === 409);
  assert.equal(projectDetail(root, pid).overview, '# Updated overview\n');
});
test('feature saves preserve unknown metadata and synchronize managed document headers', () => {
  const before = featureDetail(root, pid, fid);
  const saved = saveFeature(root, pid, fid, { revision: before.revision, title: '新的搜索', owner: 'owner-two', status: 'verified', content: before.document + '\n测试已通过。\n' }, 'browser');
  assert.equal(saved.feature.custom, 42); assert.equal(saved.feature.status, 'verified'); assert.equal(saved.feature.title, '新的搜索');
  assert.match(saved.document, /^# 新的搜索/m); assert.match(saved.document, /^Owner: owner-two$/m); assert.match(saved.document, /^Status: verified$/m);
  assert.match(saved.document, /测试已通过/); assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].before.feature.status, 'developing'); assert.equal(saved.history[0].after.feature.status, 'verified');
  assert.throws(() => saveFeature(root, pid, fid, { revision: before.revision, title: 'stale', owner: 'codex', status: 'released', content: 'stale' }, 'browser'), e => e.status === 409);
  assert.equal(featureDetail(root, pid, fid).feature.status, 'verified');
});
test('a direct agent document write makes the old browser revision stale', () => {
  const before = featureDetail(root, pid, fid); const agentContent = before.document + '\nAgent evidence\n';
  put(path.join(feature, 'README.md'), agentContent);
  assert.throws(() => saveFeature(root, pid, fid, { revision: before.revision, title: 'Search', owner: 'codex', status: 'developing', content: 'browser draft' }, 'browser'), e => e.status === 409);
  assert.equal(fs.readFileSync(path.join(feature, 'README.md'), 'utf8'), agentContent);
});
test('adding an independent update never advances the feature status', () => {
  const saved = newUpdate(root, pid, fid, { agent: 'cursor', content: '检查完成，但尚未上线。' }, 'browser');
  assert.equal(saved.updates.length, 1); assert.equal(saved.updates[0].agent, 'cursor'); assert.equal(saved.feature.status, 'developing');
  assert.equal(dashboard(root).activity[0].content, '检查完成，但尚未上线。');
  assert.equal(searchRecords(root, '尚未上线').results[0].kind, 'update');
});
test('new features get stable IDs and do not require executing code from managed repositories', () => {
  const created = newFeature(root, pid, { title: '新功能', owner: 'me' }, 'browser');
  assert.equal(created.feature.status, 'planned'); assert.match(created.feature.id, /^[a-z0-9-]+$/);
  assert.equal(projectDetail(root, pid).features.length, 2); assert.match(created.document, /Feature ID:/);
});
test('search spans project agreements and feature bodies', () => {
  assert.equal(searchRecords(root, '不要自动发布').results[0].kind, 'project');
  assert.equal(searchRecords(root, '中文路径').results[0].feature_id, fid);
  assert.deepEqual(searchRecords(root, 'not present').results, []);
});
test('unregistered and traversal IDs cannot select arbitrary files', () => {
  assert.throws(() => projectDetail(root, '../outside'));
  assert.throws(() => projectDetail(root, 'not-registered'));
  assert.throws(() => featureDetail(root, pid, '..'));
});
test('symlink escape is rejected without reading or modifying an external document', () => {
  const outside = path.join(sandbox, 'outside'); fs.mkdirSync(outside); put(path.join(outside, 'README.md'), 'private');
  const escaped = path.join(project, 'features/escaped'); fs.symlinkSync(outside, escaped, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => featureDetail(root, pid, 'escaped'), /inside|路径/);
  assert.equal(fs.readFileSync(path.join(outside, 'README.md'), 'utf8'), 'private');
});
test('an existing center lock blocks changes and remains untouched', () => {
  const before = projectDetail(root, pid); put(path.join(root, '.write.lock'), 'owned by another agent');
  assert.throws(() => saveOverview(root, pid, { revision: before.overview_revision, content: 'no' }, 'browser'), /busy|lock/i);
  assert.equal(fs.readFileSync(path.join(root, '.write.lock'), 'utf8'), 'owned by another agent');
  assert.equal(projectDetail(root, pid).overview, before.overview);
});
test('unfinished journals block further writes rather than silently deleting recovery evidence', () => {
  const before = featureDetail(root, pid, fid); put(path.join(feature, 'history/.unfinished.pending'), '{}');
  assert.throws(() => saveFeature(root, pid, fid, { revision: before.revision, title: 'no', owner: 'me', status: 'blocked', content: 'no' }, 'browser'), /恢复|journal/i);
  assert.equal(fs.existsSync(path.join(feature, 'history/.unfinished.pending')), true);
  assert.equal(featureDetail(root, pid, fid).document, before.document);
});
test('invalid fields fail before creating audit history or changing records', () => {
  const before = featureDetail(root, pid, fid);
  for (const body of [{ title: '', owner: 'me', status: 'developing', content: 'x' },
    { title: 'x', owner: 'me', status: 'automatic-release', content: 'x' },
    { title: 'x', owner: 'me', status: 'developing', content: '' }]) {
    assert.throws(() => saveFeature(root, pid, fid, { revision: before.revision, ...body }, 'browser'));
  }
  assert.equal(fs.existsSync(path.join(feature, 'history')), false); assert.equal(featureDetail(root, pid, fid).document, before.document);
});
test('feature saves preserve CRLF and treat replacement characters as literal title text', () => {
  const original = '# 原功能\r\n\r\nFeature ID: feature-one\r\nOwner: codex\r\nStatus: developing\r\n\r\n原正文。\r\n';
  put(path.join(feature, 'README.md'), original);
  const before = featureDetail(root, pid, fid);
  const saved = saveFeature(root, pid, fid, { revision: before.revision, title: '搜索 $& $1', owner: 'new-owner', status: 'verified', content: original }, 'browser');
  assert.equal(saved.document, '# 搜索 $& $1\r\n\r\nFeature ID: feature-one\r\nOwner: new-owner\r\nStatus: verified\r\n\r\n原正文。\r\n');
});
test('failure during a two-file save rolls back completed writes and leaves no false successful history', () => {
  const beforeDocument = fs.readFileSync(path.join(feature, 'README.md')), beforeMetadata = fs.readFileSync(path.join(feature, 'feature.json'));
  const before = featureDetail(root, pid, fid), rename = fs.renameSync;
  mock.method(fs, 'renameSync', (from, to) => {
    if (to === path.join(feature, 'feature.json')) throw Object.assign(new Error('Simulated filesystem denial'), { code: 'EACCES' });
    return rename(from, to);
  });
  try {
    assert.throws(() => saveFeature(root, pid, fid, { revision: before.revision, title: 'new', owner: 'me', status: 'verified', content: 'new content' }, 'browser'), /Simulated filesystem denial/);
  } finally { mock.restoreAll(); }
  assert.deepEqual(fs.readFileSync(path.join(feature, 'README.md')), beforeDocument);
  assert.deepEqual(fs.readFileSync(path.join(feature, 'feature.json')), beforeMetadata);
  assert.deepEqual(fs.readdirSync(path.join(feature, 'history')), []);
});
test('an unfinished feature save also blocks update writes', () => {
  put(path.join(feature, 'history/.unfinished.pending'), '{}');
  assert.throws(() => newUpdate(root, pid, fid, { agent: 'me', content: 'no write' }, 'browser'), /恢复|journal/i);
  assert.equal(fs.existsSync(path.join(feature, 'updates')), false);
});
test('rollback never overwrites a third-party document changed after the failed save', () => {
  const before = featureDetail(root, pid, fid), rename = fs.renameSync;
  let denied = false;
  mock.method(fs, 'renameSync', (from, to) => {
    if (to === path.join(feature, 'feature.json') && !denied) {
      denied = true;
      fs.writeFileSync(path.join(feature, 'README.md'), 'third-party evidence');
      throw new Error('Filesystem denied metadata');
    }
    return rename(from, to);
  });
  try {
    assert.throws(() => saveFeature(root, pid, fid, { revision: before.revision, title: 'new', owner: 'me', status: 'verified', content: 'new' }, 'browser'), error => error.code === 'RECOVERY_REQUIRED');
  } finally { mock.restoreAll(); }
  assert.equal(fs.readFileSync(path.join(feature, 'README.md'), 'utf8'), 'third-party evidence');
  assert.ok(fs.readdirSync(path.join(feature, 'history')).some(name => name.endsWith('.pending')));
});
test('failed feature creation never publishes a partial visible feature directory', () => {
  const rename = fs.renameSync;
  mock.method(fs, 'renameSync', (from, to) => {
    if (path.basename(to) === 'feature.json') throw new Error('Creation denied');
    return rename(from, to);
  });
  try { assert.throws(() => newFeature(root, pid, { title: 'new', owner: 'me' }, 'browser'), /Creation denied/); }
  finally { mock.restoreAll(); }
  assert.deepEqual(fs.readdirSync(path.join(project, 'features')), [fid]);
});
test('editing legacy unknown status preserves it unless the user deliberately chooses a supported status', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(feature, 'feature.json'))); metadata.status = 'manual-review';
  put(path.join(feature, 'feature.json'), metadata);
  const before = featureDetail(root, pid, fid);
  const saved = saveFeature(root, pid, fid, { revision: before.revision, title: 'Search', owner: 'me', status: 'manual-review', content: before.document + '\nNew evidence\n' }, 'browser');
  assert.equal(saved.feature.status, 'manual-review'); assert.equal(dashboard(root).stats.released, 0);
});
test('revisions detect byte-only BOM changes and preserve a BOM during a subsequent edit', () => {
  const before = featureDetail(root, pid, fid);
  fs.writeFileSync(path.join(feature, 'README.md'), '\uFEFF' + before.document);
  const withBom = featureDetail(root, pid, fid); assert.notEqual(before.revision, withBom.revision);
  const saved = saveFeature(root, pid, fid, { revision: withBom.revision, title: 'Search', owner: 'me', status: 'developing', content: withBom.document }, 'browser');
  assert.ok(saved.document.startsWith('\uFEFF# Search'));
  assert.deepEqual([...fs.readFileSync(path.join(feature, 'README.md')).subarray(0, 3)], [239, 187, 191]);
});
