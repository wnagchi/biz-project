import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const libraryApi = await import('../scripts/lib/rules-library.mjs').catch(() => ({}));
const renderApi = await import('../scripts/lib/rules-render.mjs').catch(() => ({}));
export function fixture(t) {
  assert.equal(typeof libraryApi.createRulesLibrary, 'function', 'rules library API must exist');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-rules-test-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const configFile = path.join(base, 'private/config.json'), root = path.join(base, 'library'), project = path.join(base, 'project'); fs.mkdirSync(project);
  const library = libraryApi.createRulesLibrary({ configFile }); return { base, root, project, library };
}
const domains = ['lifecycle', 'development', 'verification', 'release'];
function seed(f) {
  f.library.confirm({ root: f.root, confirmed: true });
  for (const domain of domains) f.library.save('modules', { id: domain, title: domain, domain, revision: 0,
    body: domain === 'release' ? 'Release only after {{criterion}}; $& is literal.' : `# ${domain}`, variables: domain === 'release' ? [{ name: 'criterion', label: 'Release evidence', required: true }] : [] });
  return f.library.save('schemes', { id: 'default', title: 'Default', revision: 0, modules: Object.fromEntries(domains.map(d => [d, d])), defaults: {} });
}
test('library discovery is read-only and requires explicit path confirmation', t => {
  const f = fixture(t); assert.equal(f.library.state().configured, false); assert.equal(fs.readdirSync(f.base).length, 1);
  assert.throws(() => f.library.confirm({ root: f.root }), /confirm|确认/i); assert.equal(fs.existsSync(f.root), false);
  assert.equal(f.library.confirm({ root: f.root, confirmed: true }).configured, true);
  assert.equal(fs.existsSync(f.library.state().pointer), true);
});
test('library refuses unrelated data, source and pointer containment', t => {
  const f = fixture(t); fs.mkdirSync(f.root); fs.writeFileSync(path.join(f.root, 'keep.txt'), 'keep');
  assert.throws(() => f.library.confirm({ root: f.root, confirmed: true }), /unrelated|非空|无关/i);
  assert.throws(() => f.library.confirm({ root: process.cwd(), confirmed: true }), /source|源码|工程/i);
  assert.throws(() => f.library.confirm({ root: f.base, confirmed: true }), /pointer|指针/i);
  assert.equal(fs.readFileSync(path.join(f.root, 'keep.txt'), 'utf8'), 'keep');
});
test('module updates use revisions; archive and copy are explicit and safe', t => {
  const f = fixture(t); seed(f); const before = f.library.get('modules', 'release');
  assert.equal(before.revision, 1); assert.throws(() => f.library.save('modules', { ...before, revision: 0 }), /revision|版本|修订/i);
  const changed = f.library.save('modules', { ...before, title: 'Changed' }); assert.equal(changed.revision, 2);
  assert.equal(f.library.get('modules', 'release').title, 'Changed');
  f.library.save('modules', { ...changed, archived: true });
  assert.throws(() => renderApi.renderScheme(f.library, 'default', { criterion: 'proof' }), /archiv|归档/i);
  assert.equal(f.library.save('modules', { ...changed, id: 'release-copy', revision: 0 }).revision, 1);
});
test('rendering is literal, requires confirmed values and pins module revisions', t => {
  const f = fixture(t); seed(f); assert.equal(typeof renderApi.renderScheme, 'function');
  assert.throws(() => renderApi.renderScheme(f.library, 'default', {}), /criterion|必填/i);
  const r = renderApi.renderScheme(f.library, 'default', { criterion: '$& <proof>' });
  assert.match(r.content, /after \$& <proof>/); assert.equal(r.module_revisions.release, 1);
  assert.equal(r.variables.length, 1);
  assert.throws(() => renderApi.renderScheme(f.library, 'default', { criterion: 'ok', typo: 'bad' }), /unknown|未知/i);
});
test('schemes cannot omit required domains, duplicate domains or accept invalid placeholders', t => {
  const f = fixture(t); seed(f);
  assert.throws(() => f.library.save('schemes', { id: 'bad', title: 'Bad', revision: 0, modules: { release: 'release' } }), /domain|领域/i);
  assert.throws(() => f.library.save('modules', { id: 'bad', title: 'Bad', domain: 'release', revision: 0, variables: [], body: '{{missing}}' }), /placeholder|占位/i);
  assert.throws(() => f.library.save('modules', { id: 'bad', title: 'Bad', domain: 'release', revision: 0, variables: [], body: '<!-- biz-project:start -->' }), /entry|登记|调用/i);
  assert.equal(fs.existsSync(path.join(f.root, 'modules/bad.json')), false);
});
test('body limits, IDs, unknown variable declarations and symlinks fail closed', t => {
  const f = fixture(t); seed(f);
  assert.throws(() => f.library.save('modules', { id: '../escape', revision: 0 }), /ID|标识/i);
  assert.throws(() => f.library.save('modules', { id: 'big', title: 'Big', domain: 'release', revision: 0, body: 'x'.repeat(65537), variables: [] }), /64|limit|上限/i);
  assert.throws(() => f.library.save('modules', { id: 'bad', title: 'Bad', domain: 'release', revision: 0, body: 'x', variables: [{ name: 'n', required: 'yes' }] }), /variable|参数/i);
  fs.symlinkSync(f.project, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.library.safe('escape/file.json'), /link|链接/i);
});
test('lists use summary pagination without returning module bodies', t => {
  const f = fixture(t); seed(f); const list = f.library.list('modules');
  assert.equal(list.total, 4); assert.equal(list.items[0].body, undefined); assert.equal(list.next_offset, null);
  assert.throws(() => f.library.list('modules', -1), /offset|分页/i);
});

test('confirming a corrupt existing library leaves the current pointer unchanged', t => {
  const f = fixture(t); seed(f);
  const pointer = f.library.state().pointer, before = fs.readFileSync(pointer), corrupt = path.join(f.base, 'corrupt');
  fs.mkdirSync(corrupt);
  fs.writeFileSync(path.join(corrupt, 'library.json'), JSON.stringify({ kind: 'biz-project-rules-library', schema_version: 1,
    modules: { broken: { id: 'broken', title: 'Broken', revision: 0, hash: 'invalid' } }, schemes: {} }));
  assert.throws(() => f.library.confirm({ root: corrupt, confirmed: true }), /索引|损坏/);
  assert.deepEqual(fs.readFileSync(pointer), before);
});

test('a template pointer cannot be written inside the records center', t => {
  const f = fixture(t), center = path.join(f.base, 'records'); fs.mkdirSync(center);
  const library = libraryApi.createRulesLibrary({ configFile: path.join(center, 'config.json'), recordsRoot: center });
  assert.throws(() => library.confirm({ root: f.root, confirmed: true }), /指针|配置/);
  assert.equal(fs.existsSync(f.root), false); assert.deepEqual(fs.readdirSync(center), []);
});

test('linked configuration directories are rejected before any confirmation writes', t => {
  const f = fixture(t), external = path.join(f.base, 'external'); fs.mkdirSync(external);
  fs.symlinkSync(external, path.join(f.base, 'private'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.library.confirm({ root: f.root, confirmed: true }), /链接|link/);
  assert.equal(fs.existsSync(f.root), false); assert.deepEqual(fs.readdirSync(external), []);
});
