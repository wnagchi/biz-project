import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, test } from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let sandbox, home, projects, records, config, child, origin, token;

function tree(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name => {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename);
    return [name, stat.isSymbolicLink() ? { link: fs.readlinkSync(filename) }
      : stat.isDirectory() ? tree(filename) : fs.readFileSync(filename).toString('base64')];
  }));
}

beforeEach(async () => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-web-test-'));
  home = path.join(sandbox, 'home');
  const parent = path.join(sandbox, 'projects');
  projects = [path.join(parent, 'first project'), path.join(parent, '中文项目')];
  records = path.join(sandbox, 'records');
  config = path.join(home, '.config/biz-project/config.json');
  [home, ...projects].forEach(p => fs.mkdirSync(p, { recursive: true }));
  fs.writeFileSync(path.join(projects[0], 'package.json'), '{}');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of ['BIZ_PROJECT_HOME', 'PROJECT_RECORDS_HOME', 'CODEX_HOME']) delete env[key];
  child = spawn(process.execPath, [path.join(source, 'scripts/setup-web.mjs'), '--no-open', '--port', '0', '--config', config],
    { env, cwd: source, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timeout = setTimeout(() => reject(new Error(`Server startup timeout: ${errors}`)), 15000);
    child.stderr.on('data', bytes => { errors += bytes; });
    child.stdout.on('data', bytes => {
      output += bytes;
      for (const line of output.split('\n')) {
        try { const value = JSON.parse(line); if (value.url) { clearTimeout(timeout); resolve(value); } }
        catch { /* Wait for the completed ready line. */ }
      }
    });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${errors}`)); });
  });
  const url = new URL(ready.url);
  origin = url.origin;
  token = new URLSearchParams(url.hash.slice(1)).get('token');
});

afterEach(async () => {
  if (child && child.exitCode === null) {
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  }
  assert.equal(path.dirname(sandbox), os.tmpdir());
  assert.ok(path.basename(sandbox).startsWith('biz-project-web-test-'));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function api(route, body, extraHeaders = {}) {
  return fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Biz-Token': token, Origin: origin, 'Content-Type': 'application/json', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body) });
}

const selection = () => ({ projects, hosts: ['codex', 'cursor'], recordsRoot: records });
async function preview(options = selection()) {
  const response = await api('/api/preview', options);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('opening the web wizard and discovering an unconfigured center writes nothing', async () => {
  const before = tree(sandbox);
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const state = await (await api('/api/state')).json();
  assert.equal(state.records_root, null);
  assert.equal(state.records_root_confirmed, false);
  assert.deepEqual(tree(sandbox), before);
});

test('standalone wizard opens one local management platform without installing or creating records', async () => {
  const before = tree(sandbox);
  assert.equal((await (await api('/api/state')).json()).has_platform, false);
  assert.equal((await fetch(origin + '/api/platform', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await api('/api/platform', {}, { Origin: 'https://untrusted.invalid' })).status, 403);
  const responses = await Promise.all([api('/api/platform', {}), api('/api/platform', {})]);
  assert.ok(responses.every(response => response.status === 200));
  const targets = await Promise.all(responses.map(response => response.json()));
  assert.equal(targets[0].url, targets[1].url);
  const url = new URL(targets[0].url); assert.equal(url.hostname, '127.0.0.1');
  const owner = new URLSearchParams(url.hash.slice(1)).get('token');
  const session = await fetch(url.origin + '/api/session', { headers: { 'X-Biz-Token': owner } });
  assert.equal(session.status, 200); const state = await session.json();
  assert.equal(state.local, true); assert.equal(state.lan_enabled, false); assert.equal(state.records_root, null);
  assert.deepEqual(tree(sandbox), before);
});

test('center discovery and management do not require enrolling the skill source project', async () => {
  fs.mkdirSync(path.dirname(config), { recursive: true }); fs.mkdirSync(records);
  fs.writeFileSync(config, JSON.stringify({ schema_version: 1, records_root: records }));
  fs.writeFileSync(path.join(records, 'registry.json'), JSON.stringify({ kind: 'biz-project', schema_version: 1, projects: {} }));
  fs.writeFileSync(path.join(path.dirname(config), 'project-preferences.json'), JSON.stringify({ kind: 'biz-project-preferences', schema_version: 1,
    projects: { fixture: { identity: `directory:${process.platform === 'win32' ? source.toLowerCase() : source}`, paths: [source], decision: 'no' } } }));
  const before = tree(sandbox);
  assert.equal((await (await api('/api/state')).json()).records_root, records);
  const target = new URL((await (await api('/api/platform', {})).json()).url);
  const dashboard = await fetch(target.origin + '/api/dashboard', { headers: { 'X-Biz-Token': new URLSearchParams(target.hash.slice(1)).get('token') } });
  assert.equal(dashboard.status, 200);
  const after = tree(sandbox);
  assert.deepEqual(after.projects, before.projects);
  assert.deepEqual(after.records, before.records);
  const privateFiles = after.home['.config']['biz-project'];
  assert.equal(privateFiles['project-preferences.json'], before.home['.config']['biz-project']['project-preferences.json']);
  assert.equal(Object.keys(privateFiles.connections).length, 1, 'The wizard uses shared service registration without enrolling source');
});

test('local APIs reject missing credentials, foreign origins and rebinding hosts', async () => {
  const before = tree(sandbox);
  assert.equal((await fetch(origin + '/api/state')).status, 403);
  assert.equal((await api('/api/state', undefined, { Origin: 'https://untrusted.invalid' })).status, 403);
  const rebinding = await new Promise((resolve, reject) => {
    http.get(origin + '/api/state', { headers: { Host: 'untrusted.invalid', 'X-Biz-Token': token } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(rebinding, 403);
  assert.deepEqual(tree(sandbox), before);
});

test('directory browsing lists immediate directories without selecting or recursively scanning them', async () => {
  fs.mkdirSync(path.join(projects[0], 'nested-project'));
  const before = tree(sandbox);
  const response = await api('/api/directories?path=' + encodeURIComponent(path.dirname(projects[0])));
  assert.equal(response.status, 200);
  const list = await response.json();
  assert.deepEqual(list.directories.map(p => p.name).sort(), ['first project', '中文项目']);
  assert.equal(list.directories.find(p => p.name === 'first project').project_hint, true);
  assert.ok(list.directories.every(p => !p.selected));
  assert.deepEqual(tree(sandbox), before);
});

test('batch preview is read-only and requires an explicitly selected center', async () => {
  const before = tree(sandbox);
  assert.equal((await api('/api/preview', { projects, hosts: ['codex'] })).status, 400);
  const plan = await preview();
  assert.equal(plan.items.length, 4);
  assert.ok(plan.plan_id);
  assert.equal(plan.records_root, records);
  assert.equal(plan.snapshots, undefined);
  assert.deepEqual(tree(sandbox), before);
});

test('only an approved server-held preview can install projects and a plan cannot replay', async () => {
  const plan = await preview();
  const before = tree(sandbox);
  assert.equal((await api('/api/apply', { plan_id: plan.plan_id, confirmed: true })).status, 400);
  assert.deepEqual(tree(sandbox), before);
  assert.equal((await api('/api/apply', { plan_id: 'foreign-plan', confirmed: true, records_root_confirmed: true })).status, 409);
  const response = await api('/api/apply', { plan_id: plan.plan_id, confirmed: true, records_root_confirmed: true });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.ok, true);
  const registry = JSON.parse(fs.readFileSync(path.join(records, 'registry.json')));
  assert.equal(Object.keys(registry.projects).length, 2);
  assert.ok(Object.values(registry.projects).every(p => Object.keys(p.hosts).length === 2));
  assert.equal(fs.realpathSync(path.join(home, '.agents/skills/biz-project')), fs.realpathSync(source));
  assert.equal((await api('/api/apply', { plan_id: plan.plan_id, confirmed: true, records_root_confirmed: true })).status, 409);
});

test('a stale preview is rejected before writes and a fresh preview can resume', async () => {
  const plan = await preview();
  fs.writeFileSync(path.join(projects[0], 'AGENTS.md'), '# Added while reviewing\n');
  const before = tree(sandbox);
  const response = await api('/api/apply', { plan_id: plan.plan_id, confirmed: true, records_root_confirmed: true });
  assert.equal(response.status, 409);
  assert.deepEqual(tree(sandbox), before);
  assert.equal((await preview()).items.length, 4);
});

test('per-project host overrides allow retrying only a failed tool', async () => {
  const file = path.join(projects[0], '.cursor/rules/biz-project.mdc');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '---\nalwaysApply: false\n---\nKeep\n');
  const first = await preview();
  const result = await (await api('/api/apply', { plan_id: first.plan_id, confirmed: true, records_root_confirmed: true })).json();
  assert.equal(result.ok, false);
  fs.writeFileSync(file, '---\nalwaysApply: true\n---\nKeep\n');
  const retry = await preview({ projects: [projects[0]], hosts: ['codex', 'cursor'], recordsRoot: records,
    projectHosts: { [projects[0]]: ['cursor'] } });
  assert.equal(retry.items.length, 1);
  assert.equal(retry.items[0].host, 'cursor');
  const final = await (await api('/api/apply', { plan_id: retry.plan_id, confirmed: true, records_root_confirmed: true })).json();
  assert.equal(final.ok, true);
});

test('canceling a preview invalidates it without installing or creating a center', async () => {
  const plan = await preview();
  const before = tree(sandbox);
  assert.equal((await api('/api/cancel', { plan_id: plan.plan_id })).status, 200);
  assert.equal((await api('/api/apply', { plan_id: plan.plan_id, confirmed: true, records_root_confirmed: true })).status, 409);
  assert.deepEqual(tree(sandbox), before);
});

test('directory errors and malformed bodies return bounded errors without crashing the server', async () => {
  assert.equal((await api('/api/directories?path=' + encodeURIComponent(path.join(sandbox, 'missing')))).status, 400);
  assert.equal((await api('/api/preview', { projects: 'not-an-array', hosts: ['codex'], recordsRoot: records })).status, 400);
  const bad = await fetch(origin + '/api/preview', { method: 'POST', headers: {
    'X-Biz-Token': token, Origin: origin, 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(bad.status, 400);
  assert.equal((await api('/api/state')).status, 200);
});

test('Chinese paths survive a request split in the middle of a UTF-8 character', async () => {
  const payload = Buffer.from(JSON.stringify(selection()));
  const boundary = payload.indexOf(Buffer.from('中')) + 1;
  const result = await new Promise((resolve, reject) => {
    const request = http.request(origin + '/api/preview', { method: 'POST', headers: {
      'X-Biz-Token': token, Origin: origin, 'Content-Type': 'application/json' } }, response => {
      let body = '';
      response.on('data', data => { body += data; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
    request.write(payload.subarray(0, boundary));
    setTimeout(() => request.end(payload.subarray(boundary)), 50);
  });
  assert.equal(result.status, 200);
  assert.ok(result.body.items.some(item => item.project === projects[1] && item.action === 'initialize'));
});

test('oversized requests return a readable error and do not crash the local service', async () => {
  const response = await api('/api/preview', { padding: 'x'.repeat(70000) });
  assert.equal(response.status, 413);
  assert.ok((await response.json()).error);
  assert.equal((await api('/api/state')).status, 200);
});

test('existing center discovery still requires user confirmation on each fresh session', async () => {
  const plan = await preview();
  await api('/api/apply', { plan_id: plan.plan_id, confirmed: true, records_root_confirmed: true });
  const before = tree(sandbox);
  const state = await (await api('/api/state')).json();
  assert.equal(state.records_root, records);
  assert.equal(state.records_root_confirmed, false);
  assert.deepEqual(tree(sandbox), before);
});

test('per-project tool overrides cannot select unrelated paths or unsupported hosts', async () => {
  const before = tree(sandbox);
  assert.equal((await api('/api/preview', { ...selection(), projectHosts: { [home]: ['cursor'] } })).status, 400);
  assert.equal((await api('/api/preview', { ...selection(), projectHosts: { [projects[0]]: ['untrusted'] } })).status, 400);
  assert.deepEqual(tree(sandbox), before);
});

test('Windows web launcher help works from a path containing spaces and ampersand', { skip: process.platform !== 'win32' }, async () => {
  const linked = path.join(sandbox, 'web launcher & spaces');
  fs.symlinkSync(source, linked, 'junction');
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${path.join(linked, 'install.cmd')}" --help"`],
    { windowsVerbatimArguments: true, cwd: home, input: '', encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(result.stdout.includes('网页安装向导'));
  assert.equal(fs.existsSync(records), false);
});
