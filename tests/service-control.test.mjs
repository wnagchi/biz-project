import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { sourceDirectory } from '../scripts/lib/storage.mjs';
import { servicePaths, servicePolicy, setServicePolicy, stopService, markServiceStopped, probeService } from '../scripts/lib/service-runtime.mjs';
import { controlService } from '../scripts/lib/service-control.mjs';

const script = path.join(sourceDirectory, 'scripts/service-control.mjs');
function run(action, config, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, action, '--config', config], { env, windowsHide: true });
    let out = '', err = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    child.on('error', reject); child.on('close', code => resolve({ code, out, err, value: (() => { try { return JSON.parse(out); } catch { return null; } })() }));
  });
}
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-companion-'));
  const home = path.join(base, 'home'), config = path.join(home, 'profile & space/config.json'), root = path.join(base, 'records');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const name of ['BIZ_PROJECT_HOME', 'PROJECT_RECORDS_HOME', 'CODEX_HOME', 'BIZ_PROJECT_OWNER_TOKEN']) delete env[name];
  const state = { initialized: true, records_root: root, config_file: config };
  t.after(async () => { if (fs.existsSync(config)) await stopService(state); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, home, config, root, state, env, prepare() {
    fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({ kind: 'biz-project', schema_version: 1, projects: {} }));
    fs.writeFileSync(config, JSON.stringify({ schema_version: 1, records_root: root }));
  } };
}
test('companion status with missing configuration creates nothing and never enrolls a project', async t => {
  const f = fixture(t), r = await run('status', f.config, f.env);
  assert.equal(r.code, 0, r.err); assert.equal(r.value?.state, 'not_configured');
  assert.equal(r.value.kind, 'biz-project-service-control'); assert.equal(r.value.protocol_version, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(f.config)), []); assert.equal(fs.existsSync(f.root), false);
});
test('companion ensure respects separate consent, explicit stop and one shared detached service', async t => {
  const f = fixture(t); f.prepare();
  const registry = fs.readFileSync(path.join(f.root, 'registry.json'));
  assert.equal((await run('ensure', f.config, f.env)).value?.state, 'confirmation_required');
  setServicePolicy(f.state, 'yes');
  f.env.BIZ_PROJECT_HOME = path.join(f.base, 'unselected-environment-center');
  const starts = await Promise.all(Array.from({ length: 3 }, () => run('ensure', f.config, f.env)));
  for (const item of starts) assert.equal(item.value?.state, 'running', item.out + item.err);
  assert.equal(starts.filter(item => item.value.started).length, 1, 'Concurrent callers launch one detached service');
  const b = await run('ensure', f.config, f.env);
  assert.equal(b.value?.state, 'running', b.out + b.err);
  assert.equal(b.value.started, false); assert.ok(await probeService(f.state), 'Service survives the short-lived caller');
  const connections = path.join(f.home, '.config/biz-project/connections');
  const profiles = fs.readdirSync(connections).filter(file => file.endsWith('.json'));
  assert.equal(profiles.length, 1);
  const profile = JSON.parse(fs.readFileSync(path.join(connections, profiles[0])));
  assert.equal(profile.node_executable, process.execPath); assert.equal(profile.config_file, f.config);
  const url = new URL(b.value.url); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.hash, '');
  assert.equal(/token|access_key|service_token/.test(b.out), false);
  const probe = await probeService(f.state), session = await fetch(new URL('/api/session', probe.value.url)).then(r => r.json());
  assert.equal(session.lan_enabled, false, 'Companion launch does not expose an additional LAN listener');
  const opened = [], options = { openBrowser: url => opened.push(url) };
  await controlService('status', f.config, options); assert.equal(opened.length, 0);
  const openResult = await controlService('open', f.config, options);
  assert.equal(opened.length, 1); assert.ok(new URL(opened[0]).hash.startsWith('#token='));
  assert.equal(new URL(openResult.url).hash, '', 'Only the explicit opener sees private credentials');
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'registry.json')), registry);
  assert.equal(fs.existsSync(path.join(path.dirname(f.config), 'project-preferences.json')), false);
  assert.equal(fs.existsSync(f.env.BIZ_PROJECT_HOME), false, 'Environment candidates never replace the explicitly chosen config');
  await stopService(f.state);
  assert.ok(fs.existsSync(path.join(connections, profiles[0])), 'Actual launcher leaves durable offline startup metadata');
  assert.equal((await run('ensure', f.config, f.env)).value?.state, 'stopped');
});
test('companion never re-enables a disabled startup policy', async t => {
  const f = fixture(t); f.prepare(); setServicePolicy(f.state, 'no');
  const before = fs.readFileSync(servicePaths(f.state).policy);
  assert.equal((await run('ensure', f.config, f.env)).value?.state, 'disabled');
  assert.deepEqual(fs.readFileSync(servicePaths(f.state).policy), before);
  assert.equal(fs.existsSync(servicePaths(f.state).runtime), false);
});
test('a companion stop lasts until its next linked startup, without allowing Agent startup or losing pause', async t => {
  const f = fixture(t); f.prepare(); setServicePolicy(f.state, 'yes');
  const registry = fs.readFileSync(path.join(f.root, 'registry.json'));
  fs.mkdirSync(path.join(f.root, '.biz-project-history'), { recursive: true });
  const watcherFile = path.join(f.root, '.biz-project-history/watcher.json');
  fs.writeFileSync(watcherFile, JSON.stringify({ schema_version: 2, paused: true }));
  assert.equal((await run('ensure', f.config, f.env)).value?.state, 'running');
  const first = await probeService(f.state);
  const stopped = await run('stop', f.config, f.env);
  assert.equal(stopped.code, 0, stopped.out + stopped.err);
  assert.equal(stopped.value?.state, 'stopped');
  assert.equal(fs.existsSync(servicePaths(f.state).runtime), false, 'A stop is complete only after the runtime is released');
  assert.equal((await run('status', f.config, f.env)).value?.state, 'stopped');
  assert.equal((await run('ensure', f.config, f.env)).value?.state, 'stopped', 'Agents must not undo the manual stop');
  assert.equal((await run('stop', f.config, f.env)).value?.state, 'stopped', 'Repeated stop preserves the pending linked restart');
  const resumed = await run('ensure-companion', f.config, f.env);
  assert.equal(resumed.code, 0, resumed.out + resumed.err);
  assert.equal(resumed.value?.state, 'running'); assert.equal(resumed.value.started, true);
  const next = await probeService(f.state);
  assert.notEqual(next.value.instance_id, first.value.instance_id);
  assert.equal(next.health.watcher?.active ?? false, false, 'Service resume does not resume snapshot watching');
  assert.equal(JSON.parse(fs.readFileSync(watcherFile)).paused, true);
  assert.equal(servicePolicy(f.state).auto_start, true);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'registry.json')), registry);
  assert.equal(/service_token|#token=|stop_id/.test(stopped.out + resumed.out), false);
  await stopService(f.state);
  const policy = fs.readFileSync(servicePaths(f.state).policy);
  assert.equal((await run('ensure-companion', f.config, f.env)).value?.state, 'stopped', 'A later explicit Biz stop cancels companion resume');
  assert.deepEqual(fs.readFileSync(servicePaths(f.state).policy), policy);
});
test('companion resume keeps center consent independent and status/open read-only', async t => {
  const f = fixture(t); f.prepare(); setServicePolicy(f.state, 'yes');
  await run('ensure', f.config, f.env); await run('stop', f.config, f.env);
  for (const decision of ['no', 'yes']) {
    setServicePolicy(f.state, decision);
    const before = fs.readFileSync(servicePaths(f.state).policy);
    assert.equal((await run('status', f.config, f.env)).value?.state, 'stopped');
    assert.equal((await run('open', f.config, f.env)).value?.state, 'stopped');
    assert.deepEqual(fs.readFileSync(servicePaths(f.state).policy), before);
    if (decision === 'no') {
      assert.notEqual((await run('ensure-companion', f.config, f.env)).value?.state, 'running');
      assert.deepEqual(fs.readFileSync(servicePaths(f.state).policy), before);
    }
  }
  assert.equal((await run('ensure-companion', f.config, f.env)).value?.state, 'running');
});
test('an unverified live service cannot be stopped or marked for automatic resume', async t => {
  const f = fixture(t); f.prepare(); setServicePolicy(f.state, 'yes');
  let stopRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/api/service/stop') stopRequests++;
    res.end(JSON.stringify({ kind: 'biz-project-service', protocol_version: 1, instance_id: 'wrong' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const files = servicePaths(f.state); fs.mkdirSync(files.directory, { recursive: true });
  fs.writeFileSync(files.runtime, JSON.stringify({ schema_version: 1, instance_id: randomUUID(),
    service_token: randomBytes(32).toString('base64url'), pid: process.pid, records_root: f.root,
    url: `http://127.0.0.1:${server.address().port}/` }));
  const policy = fs.readFileSync(files.policy), runtime = fs.readFileSync(files.runtime);
  const result = await run('stop', f.config, f.env);
  assert.equal(result.value?.state, 'unavailable', result.out + result.err);
  assert.equal(stopRequests, 0);
  assert.deepEqual(fs.readFileSync(files.policy), policy); assert.deepEqual(fs.readFileSync(files.runtime), runtime);
  fs.unlinkSync(files.runtime);
});
test('an old live service is incompatible, not killed or silently replaced', async t => {
  const f = fixture(t); f.prepare();
  const identity = { instance_id: randomUUID(), service_token: randomBytes(32).toString('base64url') };
  const server = http.createServer((_req, res) => res.end(JSON.stringify({ kind: 'biz-project-service', protocol_version: 1,
    ...identity, pid: process.pid, records_root: f.root })));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const files = servicePaths(f.state); fs.mkdirSync(files.directory, { recursive: true });
  fs.writeFileSync(files.runtime, JSON.stringify({ schema_version: 1, ...identity, pid: process.pid, records_root: f.root,
    url: `http://127.0.0.1:${server.address().port}/` }));
  const before = fs.readFileSync(files.runtime);
  for (const action of ['ensure', 'stop', 'ensure-companion']) {
    const r = await run(action, f.config, f.env);
    assert.equal(r.value?.state, 'incompatible', r.out + r.err); assert.deepEqual(fs.readFileSync(files.runtime), before);
  }
  assert.equal(fs.existsSync(files.policy), false); assert.equal(server.listening, true);
  fs.unlinkSync(files.runtime);
});
test('stop acknowledgement and failed health do not count as a released service', async t => {
  const f = fixture(t); f.prepare(); setServicePolicy(f.state, 'yes');
  const identity = { instance_id: randomUUID(), service_token: randomBytes(32).toString('base64url') };
  let stopping = false;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['x-biz-service-token'], identity.service_token);
    if (req.url === '/api/service/stop') {
      assert.equal(req.method, 'POST'); stopping = true; res.end(JSON.stringify({ stopping: true }));
    } else res.end(JSON.stringify(stopping ? {} : { kind: 'biz-project-service', protocol_version: 1,
      capabilities: ['service-control-v1'], instance_id: identity.instance_id, pid: process.pid, records_root: f.root }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const files = servicePaths(f.state); fs.mkdirSync(files.directory, { recursive: true });
  fs.writeFileSync(files.runtime, JSON.stringify({ schema_version: 1, ...identity, pid: process.pid,
    records_root: f.root, url: `http://127.0.0.1:${server.address().port}/#token=private` }));
  const before = fs.readFileSync(files.runtime), result = await run('stop', f.config, f.env);
  assert.equal(result.code, 0, result.out + result.err); assert.equal(result.value?.state, 'unavailable');
  assert.deepEqual(fs.readFileSync(files.runtime), before);
  assert.equal(servicePolicy(f.state).stopped, true);
  assert.equal(servicePolicy(f.state).companion_resume, false, 'An incomplete stop must not authorize another start');
  assert.equal((await run('ensure-companion', f.config, f.env)).value?.state, 'stopped');
  assert.equal(/private|service_token|#token=/.test(result.out), false);
  fs.unlinkSync(files.runtime);
});
test('a competing explicit stop invalidates the pending companion resume receipt', async t => {
  const f = fixture(t); f.prepare(); setServicePolicy(f.state, 'yes');
  const identity = { instance_id: randomUUID(), service_token: randomBytes(32).toString('base64url') };
  const files = servicePaths(f.state);
  const server = http.createServer((req, res) => {
    if (req.url === '/api/service/stop') {
      assert.match(req.headers['x-biz-stop-request'], /^[a-f0-9-]{36}$/);
      markServiceStopped(f.state); // Another explicit stop must win over this caller's receipt.
      fs.unlinkSync(files.runtime); res.end(JSON.stringify({ stopping: true }));
    } else res.end(JSON.stringify({ kind: 'biz-project-service', protocol_version: 1, capabilities: ['service-control-v1'],
      instance_id: identity.instance_id, pid: process.pid, records_root: f.root }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  fs.mkdirSync(files.directory, { recursive: true });
  fs.writeFileSync(files.runtime, JSON.stringify({ schema_version: 1, ...identity, pid: process.pid,
    records_root: f.root, url: `http://127.0.0.1:${server.address().port}/` }));
  assert.equal((await run('stop', f.config, f.env)).value?.state, 'stopped');
  assert.equal(servicePolicy(f.state).companion_resume, false);
  assert.equal((await run('ensure-companion', f.config, f.env)).value?.state, 'stopped');
});
