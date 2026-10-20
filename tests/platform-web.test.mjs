import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, test } from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let sandbox, root, config, origin, token, child;
const pid = 'one', fid = 'search';
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
beforeEach(async () => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-platform-web-')); root = path.join(sandbox, 'records'); config = path.join(sandbox, 'home/.config/biz-project/config.json');
  put(config, { schema_version: 1, records_root: root });
  put(path.join(root, 'registry.json'), { kind: 'biz-project', schema_version: 1, projects: { [pid]: { name: '项目一', identity: 'directory:one', paths: [] } } });
  put(path.join(root, 'projects', pid, 'project.json'), { schema_version: 1, id: pid, name: '项目一' });
  put(path.join(root, 'projects', pid, 'README.md'), '# 项目一\n');
  put(path.join(root, 'projects', pid, 'features', fid, 'feature.json'), { schema_version: 1, id: fid, project_id: pid, title: '搜索', owner: 'me', status: 'developing' });
  put(path.join(root, 'projects', pid, 'features', fid, 'README.md'), '# 搜索\n\n中文路径\n');
  const env = { ...process.env, HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'home') };
  for (const key of ['BIZ_PROJECT_HOME', 'PROJECT_RECORDS_HOME', 'CODEX_HOME']) delete env[key];
  child = spawn(process.execPath, [path.join(source, 'scripts/platform-web.mjs'), '--no-open', '--port', '0', '--config', config], { cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = await new Promise((resolve, reject) => {
    let output = '', stderr = ''; const timer = setTimeout(() => reject(new Error(`Startup timeout: ${stderr}`)), 10000);
    child.stderr.on('data', data => { stderr += data; });
    child.stdout.on('data', data => { output += data; for (const line of output.split('\n')) {
      try { const value = JSON.parse(line); if (value.url) { clearTimeout(timer); resolve(value); } } catch { /* Read completed JSON lines. */ }
    } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Startup failed ${code}: ${stderr}`)); });
  });
  const url = new URL(ready.url); origin = url.origin; token = new URLSearchParams(url.hash.slice(1)).get('token');
});
afterEach(async () => {
  if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  assert.equal(path.dirname(sandbox), os.tmpdir()); assert.ok(path.basename(sandbox).startsWith('biz-project-platform-web-'));
  fs.rmSync(sandbox, { recursive: true, force: true });
});
const api = (route, body, key = token, headers = {}) => fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-Biz-Token': key, Origin: origin, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('installer returns to its original authenticated platform without installation side effects', async () => {
  const before = fs.readFileSync(path.join(root, 'registry.json'));
  const url = new URL((await (await api('/api/installer', {})).json()).url);
  const wizardToken = new URLSearchParams(url.hash.slice(1)).get('token');
  const headers = { 'X-Biz-Token': wizardToken, Origin: url.origin, 'Content-Type': 'application/json' };
  const state = await (await fetch(url.origin + '/api/state', { headers })).json();
  assert.equal(state.has_platform, true);
  const response = await fetch(url.origin + '/api/platform', { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, `${origin}/#token=${token}`);
  assert.equal((await api('/api/session')).status, 200);
  assert.deepEqual(fs.readFileSync(path.join(root, 'registry.json')), before);
});

test('stopping a wizard leaves management alive and immediately reopening uses a live new wizard', async () => {
  const first = new URL((await (await api('/api/installer', {})).json()).url);
  const response = await fetch(first.origin + '/api/shutdown', { method: 'POST', headers: {
    'X-Biz-Token': new URLSearchParams(first.hash.slice(1)).get('token'), Origin: first.origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const next = new URL((await (await api('/api/installer', {})).json()).url);
  assert.notEqual(next.href, first.href, 'Do not reuse a session already shutting down');
  assert.equal((await fetch(next.origin)).status, 200);
  assert.equal((await api('/api/session')).status, 200);
});
async function lanCall() {
  const session = await (await api('/api/session')).json();
  assert.equal(session.lan_enabled, true);
  assert.equal(session.access_key, undefined);
  assert.ok(session.lan_urls.length, 'A private LAN address is required to observe restricted network access');
  const lanOrigin = new URL(session.lan_urls[0]).origin;
  return (route, body) => fetch(lanOrigin + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: lanOrigin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
test('loopback opens records without an access code and adds no guessed center', async () => {
  assert.equal((await fetch(origin + '/api/dashboard')).status, 200);
  const data = await (await api('/api/dashboard')).json(); assert.equal(data.projects[0].name, '项目一'); assert.equal(data.stats.active, 1);
  fs.unlinkSync(config);
  assert.equal((await api('/api/dashboard')).status, 200, 'An active session stays pinned to its selected center');
});

test('Markdown browser assets are local and preserve the restrictive security policy', async () => {
  for (const asset of ['/marked.umd.js', '/markdown.js']) {
    const response = await fetch(origin + asset);
    assert.equal(response.status, 200, `${asset} must be bundled locally`);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});
test('foreign origins and Host headers cannot bypass authentication', async () => {
  assert.equal((await api('/api/dashboard', undefined, token, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await api('/api/projects/one/overview', { revision: 'x', content: 'x' }, token, { Origin: 'null' })).status, 403);
  const status = await new Promise((resolve, reject) => http.get(origin + '/api/session', { headers: { Host: 'evil.invalid', 'X-Biz-Token': token } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject));
  assert.equal(status, 403);
});
test('LAN clients can edit records but cannot use owner-only operations', async () => {
  const call = await lanCall();
  const session = await (await call('/api/session')).json(); assert.equal(session.local, false); assert.equal(session.access_key, undefined);
  for (const [route, body] of [['/api/network', { enabled: false }], ['/api/installer', {}], ['/api/history/rescan', {}], ['/api/service/policy', { auto_start: true }], ['/api/service/stop', {}], ['/api/history/watch', { enabled: false }]]) assert.equal((await call(route, body)).status, 403);
  assert.equal((await call('/api/history/status')).status, 403);
  const detail = await (await call('/api/projects/one')).json();
  assert.equal((await call('/api/projects/one/overview', { revision: detail.overview_revision, content: '# LAN changed\n' })).status, 200);
  assert.equal(fs.readFileSync(path.join(root, 'projects/one/README.md'), 'utf8'), '# LAN changed\n');
});
test('service captures center documents; web save is independent and history is bounded', async () => {
  let before;
  for (let i = 0; i < 100; i++) { before = await (await api('/api/history/status')).json(); if (before.scan_state === 'ready') break; await new Promise(r => setTimeout(r, 25)); }
  assert.equal(before.scan_state, 'ready'); assert.equal(before.active, true);
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  const docs = await (await api('/api/history/documents')).json(); assert.equal(docs.total, 4);
  const file = encodeURIComponent('projects/one/README.md');
  const versions = await (await api(`/api/history/versions?file=${file}`)).json(); assert.equal(versions.versions.length, 1);
  const version = await (await api(`/api/history/version?file=${file}&id=${versions.versions[0].id}`)).json(); assert.equal(version.content, '# 项目一\n');
  assert.equal((await api('/api/history/version?file=..%2FSKILL.md&id=invalid')).status, 400);
  assert.equal((await api('/api/history/documents?offset=-1')).status, 400);
  const project = await (await api('/api/projects/one')).json();
  const saved = await (await api('/api/projects/one/overview', { revision: project.overview_revision, content: '# Native web save\n' })).json();
  assert.equal(saved.git_history, undefined);
  for (let i = 0; i < 150; i++) { const v = await (await api(`/api/history/versions?file=${file}`)).json(); if (v.versions.length === 2) break; await new Promise(r => setTimeout(r, 25)); }
  assert.equal((await (await api(`/api/history/versions?file=${file}`)).json()).versions.length, 2);
  const paused = await (await api('/api/history/watch', { enabled: false })).json(); assert.equal(paused.watcher.active, false);
  const resumed = await (await api('/api/history/watch', { enabled: true })).json(); assert.equal(resumed.watcher.active, true);
  const policy = await (await api('/api/service/policy', { auto_start: true })).json(); assert.equal(policy.service_policy.auto_start, true);
  assert.equal((await api('/api/service/health')).status, 403);
});
test('disabling LAN closes private access and leaves loopback available', async () => {
  const call = await lanCall();
  assert.equal((await call('/api/dashboard')).status, 200);
  assert.equal((await api('/api/network', { enabled: false })).status, 200);
  await assert.rejects(call('/api/dashboard'));
  assert.equal((await api('/api/session')).status, 200);
  assert.equal((await api('/api/dashboard')).status, 200);
});
test('record editing detects stale revisions and returns a conflict instead of overwriting', async () => {
  const detail = await (await api('/api/projects/one/features/search')).json();
  const body = { revision: detail.revision, title: '搜索', owner: 'me', status: 'verified', content: '中文新内容' };
  assert.equal((await api('/api/projects/one/features/search', body)).status, 200);
  assert.equal((await api('/api/projects/one/features/search', { ...body, content: 'stale' })).status, 409);
  assert.match(fs.readFileSync(path.join(root, 'projects/one/features/search/README.md'), 'utf8'), /中文新内容/);
});
test('updates, creation and search share the same existing records', async () => {
  const created = await (await api('/api/projects/one/features', { title: '浏览器新功能', owner: 'me' })).json(); assert.equal(created.feature.status, 'planned');
  const response = await api(`/api/projects/one/features/${created.feature.id}/updates`, { agent: 'cursor', content: '还未上线的证据' }); assert.equal(response.status, 200);
  const results = await (await api('/api/search?q=' + encodeURIComponent('还未上线'))).json(); assert.equal(results.results[0].kind, 'update');
});
test('arbitrary file APIs and oversized request bodies are rejected', async () => {
  assert.equal((await api('/api/directories?path=C:/')).status, 404);
  assert.equal((await api('/api/projects/not-registered')).status, 404);
  assert.equal((await api('/api/projects/one/overview', { content: 'x'.repeat(1100000) })).status, 413);
  assert.equal((await api('/api/dashboard')).status, 200);
});
test('local installer is still loopback-only and does not perform installation', async () => {
  const before = fs.readFileSync(path.join(root, 'registry.json'), 'utf8');
  const response = await api('/api/installer', {}); assert.equal(response.status, 200);
  const { url } = await response.json(); assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.equal((await fetch(url)).status, 200); assert.equal(fs.readFileSync(path.join(root, 'registry.json'), 'utf8'), before);
});
test('concurrent owner network requests share one LAN listener', async () => {
  const responses = await Promise.all([api('/api/network', { enabled: true }), api('/api/network', { enabled: true })]);
  const values = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(values[0].lan_urls, values[1].lan_urls);
  await api('/api/network', { enabled: false });
});
test('a real LAN address never becomes the loopback owner', async () => {
  const session = await (await api('/api/session')).json();
  assert.equal(session.lan_enabled, true);
  const lanOrigin = new URL(session.lan_urls[0]).origin;
  const response = await fetch(lanOrigin + '/api/session', { headers: { 'X-Biz-Token': token, Origin: lanOrigin } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.local, false); assert.equal(data.access_key, undefined);
  assert.equal((await fetch(lanOrigin + '/api/installer', { method: 'POST', headers: { Origin: lanOrigin, 'Content-Type': 'application/json', 'X-Biz-Token': token }, body: '{}' })).status, 403);
});
test('renaming, stopping and deleting a project keeps records until deletion and removes only chosen rules', async () => {
  const projectDir = path.join(sandbox, 'work');
  fs.mkdirSync(projectDir);
  const canonical = fs.realpathSync(projectDir);
  const identity = process.platform === 'win32' ? `directory:${canonical}`.toLowerCase() : `directory:${canonical}`;
  const agents = path.join(canonical, 'AGENTS.md');
  const guidance = 'Keep this line.\n<!-- biz-project:start -->\n## Biz Project\n<!-- biz-project:end -->\n<!-- biz-project:rules:start -->\n# 开发规则\nKeep the rule.\n<!-- biz-project:rules:end -->\nTail.\n';
  fs.writeFileSync(agents, guidance);
  const registryFile = path.join(root, 'registry.json');
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  registry.projects.one.paths = [canonical];
  registry.projects.one.identity = identity;
  registry.projects.one.hosts = { codex: { rules_file: 'AGENTS.md', rules_selection: 'default' } };
  fs.writeFileSync(registryFile, JSON.stringify(registry));
  const call = await lanCall();
  assert.equal((await call('/api/projects/one/rename', { name: '新名称', profile_revision: 'x' })).status, 403);
  assert.equal((await call('/api/projects/one/stop', {})).status, 403);
  assert.equal((await call('/api/projects/one/delete', { confirm: true, remove_rules: false })).status, 403);
  const detail = await (await api('/api/projects/one')).json();
  const renamed = await (await api('/api/projects/one/rename', { name: '新名称', profile_revision: detail.profile_revision })).json();
  assert.equal(renamed.project.name, '新名称');
  assert.equal(renamed.project.id, 'one');
  assert.match(fs.readFileSync(path.join(root, 'projects/one/README.md'), 'utf8'), /^# 新名称\r?$/m);
  assert.equal(JSON.parse(fs.readFileSync(registryFile, 'utf8')).projects.one.name, '新名称');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'projects/one/project.json'), 'utf8')).id, 'one');
  const rules = await (await api('/api/projects/one/rules')).json();
  assert.deepEqual(rules.rule_files, ['AGENTS.md']);
  assert.equal((await api('/api/projects/one/stop', {})).status, 200);
  const stopped = await (await api('/api/dashboard')).json();
  assert.equal(stopped.projects.some(project => project.id === 'one'), false);
  assert.equal(stopped.stopped.some(project => project.id === 'one' && project.name === '新名称'), true);
  assert.equal((await (await api(`/api/search?q=${encodeURIComponent('新名称')}`)).json()).results.length, 0);
  const hidden = fs.readFileSync(agents, 'utf8');
  assert.equal(hidden.includes('biz-project:start'), false);
  assert.match(hidden, /Keep this line/);
  assert.match(hidden, /biz-project:rules:start/);
  assert.match(hidden, /Keep the rule/);
  assert.match(hidden, /Tail/);
  assert.equal(fs.existsSync(path.join(root, 'projects/one/features/search/feature.json')), true);
  assert.equal((await api('/api/projects/one/resume', {})).status, 200);
  const resumed = await (await api('/api/dashboard')).json();
  assert.equal(resumed.projects.some(project => project.id === 'one'), true);
  assert.equal(resumed.stopped.some(project => project.id === 'one'), false);
  assert.match(fs.readFileSync(agents, 'utf8'), /biz-project:start/);
  assert.match(fs.readFileSync(agents, 'utf8'), /Keep the rule/);
  assert.equal((await api('/api/projects/one/delete', {})).status, 400);
  assert.equal((await api('/api/projects/one/delete', { confirm: true, remove_rules: false })).status, 200);
  assert.equal(fs.existsSync(path.join(root, 'projects/one')), false);
  assert.equal(JSON.parse(fs.readFileSync(registryFile, 'utf8')).projects.one, undefined);
  const kept = fs.readFileSync(agents, 'utf8');
  assert.equal(kept.includes('biz-project:start'), false);
  assert.match(kept, /Keep this line/);
  assert.match(kept, /Keep the rule/);
  assert.match(kept, /Tail/);
  const other = path.join(canonical, 'AGENTS.md');
  fs.writeFileSync(other, guidance);
  const again = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  again.projects.two = { name: '项目二', identity: `${identity}-two`, paths: [canonical], hosts: { codex: { rules_file: 'AGENTS.md', rules_selection: 'default' } } };
  fs.writeFileSync(registryFile, JSON.stringify(again));
  put(path.join(root, 'projects/two/project.json'), { schema_version: 1, id: 'two', name: '项目二' });
  put(path.join(root, 'projects/two/README.md'), '# 项目二\n');
  assert.equal((await api('/api/projects/two/delete', { confirm: true, remove_rules: true })).status, 200);
  const removed = fs.readFileSync(agents, 'utf8');
  assert.equal(removed.includes('biz-project:rules:start'), false);
  assert.equal(removed.includes('Keep the rule'), false);
  assert.match(removed, /Keep this line/);
  assert.match(removed, /Tail/);
  assert.equal(fs.existsSync(path.join(canonical, 'AGENTS.md')), true);
});
const openssl = process.platform === 'win32' && fs.existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : null;
test('explicit TLS certificate and key serve an authenticated encrypted platform', { skip: openssl ? false : 'Optional development OpenSSL is unavailable' }, async () => {
  const cert = path.join(sandbox, 'cert.pem'), key = path.join(sandbox, 'key.pem');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'pipe', windowsHide: true });
  const { startPlatformWeb } = await import('../scripts/lib/platform-web.mjs');
  const platform = await startPlatformWeb({ recordsRoot: root, tlsCert: cert, tlsKey: key });
  try {
    const url = new URL(platform.url), keyToken = new URLSearchParams(url.hash.slice(1)).get('token');
    assert.equal(url.protocol, 'https:');
    const data = await new Promise((resolve, reject) => {
      https.get(url.origin + '/api/session', { ca: fs.readFileSync(cert), headers: { Origin: url.origin, 'X-Biz-Token': keyToken } }, response => {
        let content = ''; response.on('data', chunk => { content += chunk; });
        response.on('end', () => { try { assert.equal(response.statusCode, 200); resolve(JSON.parse(content)); } catch (cause) { reject(cause); } });
      }).on('error', reject);
    });
    assert.equal(data.secure, true); assert.equal(data.local, true);
  } finally { await platform.close(); }
});
