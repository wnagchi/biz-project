import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { rulesFixture } from './helpers/rules-fixture.mjs';
import { saveParticipation, participation, preferencesPath } from '../scripts/lib/participation.mjs';
const api = await import('../scripts/lib/rules-apply.mjs').catch(() => ({}));
function fixture(t, options = {}) { const f = rulesFixture(t); assert.equal(typeof api.createRulePlanner, 'function', 'rule planner API must exist'); return { ...f, planner: api.createRulePlanner(f.library, { globalRules: [], ...options }) }; }
function draft(p) { return { summary: 'Agent reviewed all conflicts and preserved existing requirements.', unresolved: [],
  files: p.files.map(f => ({ path: f.path, base_hash: f.base_hash, content: f.after, reason: 'Preserve original rules and add approved policy.' })) }; }
test('first preview is read-only; confirmed application writes only rule files', t => {
  const f = fixture(t), p = f.planner.preview(f.input); assert.equal(p.mode, 'create'); assert.equal(p.can_apply, true);
  assert.equal(fs.readdirSync(f.project).length, 0); assert.throws(() => f.planner.apply({ plan_id: p.id }), /批准|approved/i);
  const result = f.planner.apply({ plan_id: p.id, approved: true }); assert.equal(result.ok, true);
  assert.match(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), /verified deployment/);
  assert.deepEqual(fs.readdirSync(f.project), ['AGENTS.md']); assert.equal(fs.existsSync(f.configFile), false);
  assert.throws(() => f.planner.apply({ plan_id: p.id, approved: true }), /计划|plan/i);
});
test('old root rules force Agent merge even when the Cursor destination is missing', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), '# Existing release requirements\n');
  const p = f.planner.preview({ ...f.input, hosts: ['cursor'] }); assert.equal(p.requires_merge, true); assert.equal(p.can_apply, false);
  assert.match(p.task, /Agent|AGENT/); assert.match(p.task, /Existing release/);
  assert.throws(() => f.planner.apply({ plan_id: p.id, approved: true }), /合并|merge/i);
  assert.equal(fs.existsSync(path.join(f.project, '.cursor')), false);
  assert.throws(() => f.planner.merge({ plan_id: p.id, draft: { ...draft(p), unresolved: ['ambiguous release'] } }), /未解决|unresolved/i);
  assert.throws(() => f.planner.merge({ plan_id: p.id, draft: { ...draft(p), files: [{ ...draft(p).files[0], path: '../escape.md' }] } }), /目标|target/i);
  const m = f.planner.merge({ plan_id: p.id, draft: draft(p) }); assert.equal(m.can_apply, true);
  assert.equal(f.planner.apply({ plan_id: p.id, approved: true }).ok, true);
  assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), '# Existing release requirements\n');
});
test('Agent merge preserves BOM, CRLF and protected records entry', t => {
  const f = fixture(t), hook = '<!-- biz-project:start -->\r\nKeep this record entry\r\n<!-- biz-project:end -->';
  const original = `\uFEFF# Original\r\n${hook}\r\n`; fs.writeFileSync(path.join(f.project, 'AGENTS.md'), original);
  const p = f.planner.preview(f.input), d = draft(p);
  assert.throws(() => f.planner.merge({ plan_id: p.id, draft: { ...d, files: [{ ...d.files[0], content: d.files[0].content.replace(hook, '') }] } }), /保护|登记/i);
  f.planner.merge({ plan_id: p.id, draft: d }); f.planner.apply({ plan_id: p.id, approved: true });
  const actual = fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'); assert.ok(actual.startsWith(original)); assert.ok(actual.includes(hook)); assert.equal(/(?<!\r)\n/.test(actual), false);
});
test('overwrite is explicit, scopes replacement and keeps exact private recovery bytes', t => {
  const f = fixture(t), filename = path.join(f.project, 'AGENTS.md'), old = Buffer.from('# Old rules\r\n'); fs.writeFileSync(filename, old);
  assert.throws(() => f.planner.preview({ ...f.input, mode: 'overwrite' }), /明确|确认/i);
  const p = f.planner.preview({ ...f.input, mode: 'overwrite', overwrite_confirmed: true }); assert.equal(p.mode, 'overwrite');
  assert.deepEqual(fs.readFileSync(filename), old, 'Overwrite preview cannot write project files');
  const r = f.planner.apply({ plan_id: p.id, approved: true }); assert.equal(r.ok, true); assert.equal(fs.readFileSync(filename, 'utf8').includes('Old rules'), false);
  assert.deepEqual(fs.readFileSync(r.results[0].recovery_file), old); assert.equal(fs.existsSync(path.join(f.project, '.git')), false);
});

test('preview snapshots are immutable, application locks are preserved and no records are initialized', t => {
  const f = fixture(t), p = f.planner.preview(f.input); p.files[0].after = 'attacker content';
  const lock = path.join(f.root, '.write.lock'); fs.writeFileSync(lock, 'another process');
  assert.throws(() => f.planner.apply({ plan_id: p.id, approved: true }), /busy|lock/i); assert.equal(fs.readFileSync(lock, 'utf8'), 'another process');
  fs.unlinkSync(lock); assert.equal(f.planner.apply({ plan_id: p.id, approved: true }).ok, true);
  assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8').includes('attacker content'), false);
  assert.equal(fs.existsSync(path.join(f.base, 'records')), false);
});

test('existing override is selected and inactive MDC is never activated implicitly', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'AGENTS.override.md'), '# Override\n');
  assert.equal(f.planner.preview(f.input).files[0].path, 'AGENTS.override.md');
  const target = path.join(f.project, '.cursor/rules/biz-project-development.mdc'); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '---\nalwaysApply: false\n---\n# Existing');
  assert.throws(() => f.planner.preview({ ...f.input, hosts: ['cursor'] }), /alwaysApply/);
  assert.equal(fs.readFileSync(target, 'utf8').includes('false'), true);
});
test('file/template drift and expiration invalidate plans before writes', t => {
  let now = 0; const f = fixture(t, { now: () => now });
  const p = f.planner.preview(f.input); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), 'Other writer');
  assert.throws(() => f.planner.apply({ plan_id: p.id, approved: true }), /变化|changed/i); assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), 'Other writer');
  fs.unlinkSync(path.join(f.project, 'AGENTS.md')); const q = f.planner.preview(f.input);
  f.library.save('modules', { ...f.library.get('modules', 'release'), body: 'Changed policy {{criterion}}' });
  assert.throws(() => f.planner.apply({ plan_id: q.id, approved: true }), /变化|changed/i);
  const expired = f.planner.preview(f.input); now = 1800001; assert.throws(() => f.planner.apply({ plan_id: expired.id, approved: true }), /过期|计划/i);
  assert.equal(fs.readdirSync(f.project).length, 0);
});
test('symlinks, target traversal and unsafe libraries cannot select project files', t => {
  const f = fixture(t); fs.symlinkSync(f.root, path.join(f.project, '.cursor'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.planner.preview({ ...f.input, hosts: ['cursor'] }), /链接|link/i);
  assert.throws(() => f.planner.preview({ ...f.input, targets: { codex: '../AGENTS.md' } }), /目标|路径/i);
});

test('existing registered release agreements enter Agent review without rewriting the profile', t => {
  const f = fixture(t), center = path.join(f.base, 'records'), folder = path.join(center, 'projects/one'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(f.configFile, JSON.stringify({ schema_version: 1, records_root: center }));
  fs.writeFileSync(path.join(center, 'registry.json'), JSON.stringify({ kind: 'biz-project', projects: { one: { paths: [f.project] } } }));
  const profile = JSON.stringify({ schema_version: 1, id: 'one', release_criterion: 'Old release agreement' }); fs.writeFileSync(path.join(folder, 'project.json'), profile);
  const p = f.planner.preview(f.input); assert.equal(p.mode, 'merge'); assert.match(p.task, /Old release agreement/);
  assert.equal(fs.readFileSync(path.join(folder, 'project.json'), 'utf8'), profile); assert.equal(fs.readdirSync(f.project).length, 0);
});
test('two hosts report partial failure and a fresh retry keeps prior applied bytes', t => {
  const f = fixture(t), p = f.planner.preview({ ...f.input, hosts: ['codex', 'cursor'] });
  const rename = fs.renameSync; t.mock.method(fs, 'renameSync', (a, b) => { if (String(b).endsWith('.mdc')) throw new Error('controlled write failure'); return rename(a, b); });
  const r = f.planner.apply({ plan_id: p.id, approved: true }); assert.equal(r.ok, false);
  assert.deepEqual(r.results.map(x => x.status), ['applied', 'failed']); assert.match(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), /verified deployment/);
  t.mock.restoreAll(); const q = f.planner.preview({ ...f.input, hosts: ['codex', 'cursor'], mode: 'overwrite', overwrite_confirmed: true });
  const next = f.planner.apply({ plan_id: q.id, approved: true }); assert.deepEqual(next.results.map(x => x.status), ['unchanged', 'applied']);
});

test('rules import never clears an existing records participation refusal', t => {
  const f = fixture(t), identity = { root: f.project, identity: 'temporary-project' };
  saveParticipation(identity, f.configFile, 'no');
  const filename = preferencesPath(f.configFile), before = fs.readFileSync(filename);
  const p = f.planner.preview(f.input);
  assert.equal(f.planner.apply({ plan_id: p.id, approved: true }).ok, true);
  assert.deepEqual(fs.readFileSync(filename), before);
  assert.equal(participation(identity, f.configFile).status, 'declined');
  assert.equal(fs.existsSync(f.configFile), false);
  assert.equal(fs.existsSync(path.join(f.base, 'records')), false);
});

test('unchanged example explanations cannot masquerade as Agent semantic review', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), '# Old release decisions\n');
  const p = f.planner.preview(f.input);
  assert.throws(() => f.planner.merge({ plan_id: p.id, draft: { ...p.draft_example, unresolved: [] } }), /实际/);
  assert.throws(() => f.planner.merge({ plan_id: p.id, draft: { ...p.draft_example, summary: 'Agent reviewed all requirements.', unresolved: [] } }), /实际/);
  assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), '# Old release decisions\n');
});

test('receipt failure reports already applied bytes and retained recovery accurately', t => {
  const f = fixture(t), filename = path.join(f.project, 'AGENTS.md'), old = Buffer.from('# Old rules\n');
  fs.writeFileSync(filename, old);
  const p = f.planner.preview({ ...f.input, mode: 'overwrite', overwrite_confirmed: true });
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (a, b) => {
    if (String(b).includes(`${path.sep}applications${path.sep}`) && String(b).endsWith('.json')) throw new Error('controlled receipt failure');
    return rename(a, b);
  });
  const r = f.planner.apply({ plan_id: p.id, approved: true });
  assert.equal(r.ok, false); assert.equal(r.results[0].status, 'applied');
  assert.match(r.results[0].warning, /receipt failure/);
  assert.deepEqual(fs.readFileSync(r.results[0].recovery_file), old);
  assert.match(fs.readFileSync(filename, 'utf8'), /verified deployment/);
});

test('a newly appearing applicable rule invalidates an older preview', t => {
  const f = fixture(t), p = f.planner.preview(f.input);
  fs.writeFileSync(path.join(f.project, 'CLAUDE.md'), '# New project policy\n');
  assert.throws(() => f.planner.apply({ plan_id: p.id, approved: true }), /变化|changed/i);
  assert.equal(fs.existsSync(path.join(f.project, 'AGENTS.md')), false);
});
