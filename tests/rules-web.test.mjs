import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPlatformWeb } from '../scripts/lib/platform-web.mjs';
async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-rules-http-')), config = path.join(base, 'private/config.json');
  const server = await startPlatformWeb({ configFile: config });
  t.after(async () => { await server.close(); fs.rmSync(base, { recursive: true, force: true }); });
  const url = new URL(server.url), token = new URLSearchParams(url.hash.slice(1)).get('token');
  const api = (route, data, auth = token, origin = url.origin) => fetch(new URL(route, url), { method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-Biz-Token': auth, Origin: origin, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { base, config, server, api, url };
}
test('owner rules APIs and assets work without a records center and opening creates nothing', async t => {
  const f = await fixture(t), r = await f.api('/api/rules/state'); assert.equal(r.status, 200);
  assert.equal((await r.json()).configured, false); assert.equal(fs.readdirSync(f.base).length, 0);
  for (const asset of ['/rules.js', '/rules.css']) assert.equal((await fetch(new URL(asset, f.url))).status, 200);
  const root = path.join(f.base, 'library'); assert.equal((await f.api('/api/rules/library', { root })).status, 400);
  assert.equal(fs.existsSync(root), false); assert.equal((await f.api('/api/rules/library', { root, confirmed: true })).status, 200);
  assert.equal(fs.existsSync(f.config), false);
});
test('rules endpoints allow the loopback owner and reject cross-origin and LAN clients', async t => {
  const f = await fixture(t); assert.equal((await f.api('/api/rules/state', undefined, '')).status, 200);
  assert.equal((await f.api('/api/rules/library', { root: f.base, confirmed: true }, undefined, 'https://evil.invalid')).status, 403);
  await f.api('/api/network', { enabled: true }); const session = await (await f.api('/api/session')).json();
  assert.ok(session.lan_urls.length, 'A private LAN address is required to prove LAN clients stay restricted');
  const lanOrigin = new URL(session.lan_urls[0]).origin;
  const remote = (route, data) => fetch(lanOrigin + route, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: lanOrigin, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal((await remote('/api/rules/state')).status, 403);
  assert.equal((await remote('/api/rules/preview', {})).status, 403);
  assert.equal(fs.readdirSync(f.base).length, 0);
});
test('HTTP library edits and application plans preserve single-use approval and Agent boundary', async t => {
  const f = await fixture(t), root = path.join(f.base, 'library'), project = path.join(f.base, 'work'); fs.mkdirSync(project);
  await f.api('/api/rules/library', { root, confirmed: true });
  const domains = ['lifecycle', 'development', 'verification', 'release'];
  for (const d of domains) assert.equal((await f.api('/api/rules/modules', { id: d, title: d, domain: d, body: '# policy', variables: [], revision: 0 })).status, 200);
  const scheme = { id: 'standard', title: 'Standard', modules: Object.fromEntries(domains.map(d => [d, d])), defaults: {}, revision: 0 };
  assert.equal((await f.api('/api/rules/schemes', scheme)).status, 200); assert.equal((await f.api('/api/rules/schemes', scheme)).status, 409);
  assert.equal((await (await f.api('/api/rules/schemes/standard')).json()).variables.length, 0);
  const p = await (await f.api('/api/rules/preview', { scheme_id: 'standard', project, hosts: ['codex'], params: {} })).json();
  assert.equal(p.mode, 'create'); assert.equal(fs.readdirSync(project).length, 0);
  assert.equal((await f.api('/api/rules/apply', { plan_id: p.id })).status, 400);
  assert.equal((await f.api('/api/rules/apply', { plan_id: p.id, approved: true })).status, 200);
  assert.equal((await f.api('/api/rules/apply', { plan_id: p.id, approved: true })).status, 409);
  const merge = await (await f.api('/api/rules/preview', { scheme_id: 'standard', project, hosts: ['codex'], params: {} })).json();
  assert.equal(merge.requires_merge, true); assert.equal((await f.api('/api/rules/apply', { plan_id: merge.id, approved: true })).status, 400);
});

test('starter requires a confirmed library and creates editable modules without project writes', async t => {
  const f = await fixture(t); assert.equal((await f.api('/api/rules/starter', {})).status, 400);
  await f.api('/api/rules/library', { root: path.join(f.base, 'library'), confirmed: true });
  const r = await f.api('/api/rules/starter', {}); assert.equal(r.status, 200); const data = await r.json();
  assert.equal(data.scheme.variables.some(v => v.name === 'release_criterion' && v.required), true);
  assert.equal(data.state.module_total, 4); assert.equal(fs.existsSync(f.config), false);
});

test('owned service redeployment may retain its private owner session but rejects invalid credentials', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-rules-restart-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const configFile = path.join(base, 'config.json'), ownerToken = 'A'.repeat(43);
  await assert.rejects(async () => { const unexpected = await startPlatformWeb({ configFile, ownerToken: 'bad' }); t.after(() => unexpected.close()); return unexpected; }, /凭据|token/i);
  const s = await startPlatformWeb({ configFile, ownerToken }); t.after(() => s.close());
  assert.equal(new URLSearchParams(new URL(s.url).hash.slice(1)).get('token'), ownerToken);
  const r = await fetch(new URL('/api/rules/state', s.url), { headers: { 'X-Biz-Token': ownerToken } }); assert.equal(r.status, 200);
});
