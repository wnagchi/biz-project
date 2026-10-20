import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { sourceDirectory } from '../scripts/lib/storage.mjs';
import { fixture } from './helpers/records-fixture.mjs';
import { ensureService, probeService, servicePaths, setServicePolicy } from '../scripts/lib/service-runtime.mjs';
import { acquireLease } from '../scripts/lib/process-lease.mjs';

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(sourceDirectory, 'scripts/biz-project.mjs'), ...args], { env, windowsHide: true });
    let out = '', err = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    child.once('error', reject); child.once('close', code => resolve({ code, out, err, value: (() => { try { return JSON.parse(out || err); } catch { return null; } })() }));
  });
}
test('skill service checks honor consent, reuse one instance and respect explicit stop', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-service-test-'));
  const project = path.join(base, 'work'), root = path.join(base, 'records'), home = path.join(base, 'home');
  fs.mkdirSync(project); fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home }; delete env.BIZ_PROJECT_HOME; delete env.PROJECT_RECORDS_HOME; delete env.CODEX_HOME;
  const args = ['--project', project, '--host', 'codex'];
  t.after(async () => { await run(['stop-service', ...args], env); fs.rmSync(base, { recursive: true, force: true }); });
  const init = await run(['init', ...args, '--records-root', root, '--join-confirmed'], env); assert.equal(init.code, 0, init.err);
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  const first = await run(['ensure-service', ...args], env); assert.equal(first.code, 0, first.err);
  assert.equal(first.value.service.state, 'confirmation_required'); assert.equal(fs.existsSync(path.join(root, '.biz-project-history')), false);
  const policy = await run(['set-service-policy', ...args, '--decision', 'yes'], env); assert.equal(policy.code, 0, policy.err);
  const checks = await Promise.all(Array.from({ length: 3 }, () => run(['ensure-service', ...args], env)));
  for (const item of checks) { assert.equal(item.code, 0, item.err); assert.equal(item.value.service.state, 'running'); assert.equal(item.value.service.url, undefined); }
  assert.equal(new Set(checks.map(item => item.value.service.pid)).size, 1);
  const started = performance.now(), again = await run(['ensure-service', ...args], env), elapsed = performance.now() - started;
  assert.equal(again.value.service.pid, checks[0].value.service.pid); assert.equal(again.value.service.started, false);
  t.diagnostic(`Running service check including Node/CLI launch: ${elapsed.toFixed(1)} ms`);
  const stopped = await run(['stop-service', ...args], env); assert.equal(stopped.code, 0, stopped.err);
  const blocked = await run(['ensure-service', ...args], env); assert.equal(blocked.value.service.state, 'stopped');
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
});
test('unregistered and declined projects do not launch services or initialize centers', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-service-gates-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = path.join(base, 'work'), home = path.join(base, 'home'); fs.mkdirSync(project); fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home }; delete env.BIZ_PROJECT_HOME; delete env.PROJECT_RECORDS_HOME; delete env.CODEX_HOME;
  const args = ['--project', project];
  const unknown = await run(['ensure-service', ...args], env); assert.equal(unknown.code, 0, unknown.err);
  assert.equal(unknown.value.project_confirmation_required, true); assert.equal(unknown.value.service.state, 'not_applicable');
  assert.equal(fs.readdirSync(home).length, 0);
  await run(['set-participation', ...args, '--decision', 'no'], env);
  const no = await run(['ensure-service', ...args], env); assert.equal(no.value.skip_recording, true); assert.equal(no.value.service.state, 'not_applicable');
  assert.equal(fs.existsSync(path.join(home, '.config/biz-project/services')), false);
});

async function fakeService(t, handler) {
  const f = fixture(t), state = { initialized: true, records_root: f.root, config_file: path.join(f.base, 'home/config.json') };
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const value = { schema_version: 1, records_root: f.root, pid: process.pid, instance_id: randomUUID(),
    service_token: randomBytes(32).toString('base64url'), url: `http://127.0.0.1:${server.address().port}/` };
  const files = servicePaths(state); fs.mkdirSync(files.directory, { recursive: true });
  fs.writeFileSync(files.runtime, JSON.stringify(value));
  return { state, value, files };
}

test('health has a total deadline even after an incomplete response body', async t => {
  const f = await fakeService(t, (_req, res) => { res.writeHead(200); res.write('{"kind":'); });
  const started = performance.now();
  const value = await Promise.race([probeService(f.state), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Health deadline did not settle')), 1500); timer.unref(); })]);
  assert.equal(value, null); assert.ok(performance.now() - started < 1000);
});

test('wrong service identity cannot be reused, killed or replaced; repeated failure backs off', async t => {
  const f = await fakeService(t, (_req, res) => res.end(JSON.stringify({ kind: 'biz-project-service', protocol_version: 1,
    instance_id: 'wrong-service', records_root: 'wrong-center', pid: process.pid })));
  assert.equal(await probeService(f.state), null);
  setServicePolicy(f.state, 'yes');
  const first = await ensureService(f.state);
  assert.equal(first.state, 'unavailable'); assert.match(first.warning, /no duplicate/);
  assert.equal((await ensureService(f.state)).state, 'cooldown');
  assert.equal(fs.existsSync(f.files.log), false); assert.equal(JSON.parse(fs.readFileSync(f.files.runtime)).instance_id, f.value.instance_id);
});

test('only a dead process lease is reclaimed; a live owner is never replaced', async t => {
  const f = fixture(t), filename = path.join(f.base, 'owner.lock');
  const release = acquireLease(filename), original = fs.readFileSync(filename);
  assert.throws(() => acquireLease(filename), /running owner/); assert.deepEqual(fs.readFileSync(filename), original); release();
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true });
  const deadPid = child.pid; await new Promise(resolve => child.once('exit', resolve));
  fs.writeFileSync(filename, JSON.stringify({ pid: deadPid }));
  const recovery = `${filename}.reclaim`, ticket = randomUUID(); fs.mkdirSync(recovery);
  fs.writeFileSync(path.join(recovery, `${ticket}.json`), JSON.stringify({ pid: deadPid, id: ticket }));
  const recovered = acquireLease(filename); assert.equal(JSON.parse(fs.readFileSync(filename)).pid, process.pid); recovered();
  assert.equal(fs.existsSync(filename), false);
  assert.equal(fs.existsSync(recovery), false, 'A crash in recovery must not permanently block startup');
  fs.writeFileSync(filename, JSON.stringify({ pid: deadPid })); fs.mkdirSync(recovery);
  const liveTicket = randomUUID(), liveFile = path.join(recovery, `${liveTicket}.json`);
  fs.writeFileSync(liveFile, JSON.stringify({ pid: process.pid, id: liveTicket }));
  assert.throws(() => acquireLease(filename), /busy recovering/); assert.equal(fs.existsSync(liveFile), true);
  fs.unlinkSync(liveFile);
  const emptyRecovery = acquireLease(filename); emptyRecovery();
  assert.equal(fs.existsSync(recovery), false, 'A crash before publishing a recovery ticket is recoverable');
});

test('failed startup ownership is bounded and repeated checks use cooldown', async t => {
  const f = await fakeService(t, (_req, res) => res.end('{}'));
  setServicePolicy(f.state, 'yes');
  const lease = JSON.stringify({ pid: process.pid }); fs.writeFileSync(f.files.startup, lease);
  const first = await ensureService(f.state); assert.equal(first.state, 'unavailable');
  const started = performance.now(); assert.equal((await ensureService(f.state)).state, 'cooldown');
  assert.ok(performance.now() - started < 1000); assert.equal(fs.readFileSync(f.files.startup, 'utf8'), lease);
});
