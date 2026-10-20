import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { atomicWrite, canonical, isInside, jsonText, readJson, sourceDirectory } from './storage.mjs';
import { digest } from './history-files.mjs';
import { acquireLease, processAlive } from './process-lease.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function servicePaths(state) {
  if (!state.records_root || !state.config_file) throw new Error('A confirmed center and config profile are required.');
  const center = canonical(state.records_root), key = process.platform === 'win32' ? center.toLowerCase() : center;
  const directory = path.join(path.dirname(state.config_file), 'services', digest(Buffer.from(key)));
  if (isInside(center, directory) || isInside(sourceDirectory, directory)) throw new Error('Private service state must stay outside records and source.');
  let current = path.dirname(state.config_file);
  for (const part of path.relative(current, directory).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Unsafe service state directory.');
  }
  return { directory, runtime: path.join(directory, 'runtime.json'), policy: path.join(directory, 'policy.json'),
    lease: path.join(directory, 'service.lock'), startup: path.join(directory, 'startup.lock'), log: path.join(directory, 'service.log') };
}
function boundedJson(filename) {
  if (!fs.existsSync(filename)) return null;
  const stat = fs.lstatSync(filename); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Unsafe service descriptor or policy.');
  return readJson(filename);
}
export function servicePolicy(state) {
  const value = boundedJson(servicePaths(state).policy);
  if (!value) return { schema_version: 1, auto_start: null, stopped: false, failure_until: 0 };
  if (value.schema_version !== 1 || ![true, false, null].includes(value.auto_start) || typeof value.stopped !== 'boolean'
    || !Number.isFinite(value.failure_until)
    || (value.companion_resume !== undefined && typeof value.companion_resume !== 'boolean')
    || (value.stop_id !== undefined && !/^[a-f0-9-]{36}$/.test(value.stop_id))) throw new Error('Invalid service startup policy.');
  return value;
}
function updatePolicy(state, changes) {
  const files = servicePaths(state); fs.mkdirSync(files.directory, { recursive: true });
  const release = acquireLease(path.join(files.directory, 'policy.lock'));
  try {
    const current = servicePolicy(state), patch = typeof changes === 'function' ? changes(current) : changes;
    if (!patch) return current;
    const value = { ...current, ...patch }; atomicWrite(files.policy, jsonText(value)); return value;
  } finally { release(); }
}
export function setServicePolicy(state, decision) {
  if (!['yes', 'no'].includes(decision)) throw new Error('--decision must be yes or no after the user explicitly chooses.');
  return updatePolicy(state, { auto_start: decision === 'yes', failure_until: 0 });
}
export function resumeService(state) { return updatePolicy(state, { stopped: false, companion_resume: false, failure_until: 0 }); }
export function markServiceStopped(state, stopId = randomUUID()) {
  if (!/^[a-f0-9-]{36}$/.test(stopId)) throw new Error('Invalid stop request.');
  return updatePolicy(state, { stopped: true, companion_resume: false, stop_id: stopId });
}
export function descriptor(state) {
  const value = boundedJson(servicePaths(state).runtime); if (!value) return null;
  const url = new URL(value.url);
  if (value.schema_version !== 1 || value.records_root !== state.records_root || !['http:', 'https:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1' || url.username || url.password || !url.port || url.pathname !== '/'
    || !/^[a-f0-9-]{36}$/.test(value.instance_id) || !/^[A-Za-z0-9_-]{43}$/.test(value.service_token)
    || !Number.isSafeInteger(value.pid) || value.pid < 1) throw new Error('Invalid service identity descriptor.');
  return value;
}
async function requestRuntime(value, route, method = 'GET', headers = {}) {
  const base = new URL(value.url), target = new URL(route, base); target.hash = '';
  return new Promise(resolve => {
    let settled = false, timer;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const request = (base.protocol === 'https:' ? https : http).request(target, { method, rejectUnauthorized: false,
      headers: { ...headers, 'x-biz-service-token': value.service_token, Origin: base.origin, Host: base.host } }, response => {
      let text = ''; response.on('data', data => { text += data; if (text.length > 16384) { finish(null); request.destroy(); } });
      response.on('end', () => { try { finish(response.statusCode === 200 ? JSON.parse(text) : null); } catch { finish(null); } });
      response.once('error', () => finish(null)); response.once('aborted', () => finish(null));
    });
    timer = setTimeout(() => { finish(null); request.destroy(); }, 350); timer.unref();
    request.once('close', () => finish(null)); request.once('error', () => finish(null)); request.end();
  });
}
export async function serviceConnection(probe) {
  const reply = await requestRuntime(probe.value, '/api/service/connection');
  if (reply?.kind !== 'biz-project-connection-handshake' || reply.protocol_version !== 1
    || reply.instance_id !== probe.value.instance_id || reply.pid !== probe.value.pid) return null;
  return reply.profile ?? null;
}
export async function probeService(state) {
  const value = descriptor(state); if (!value) return null;
  const health = await requestRuntime(value, '/api/service/health');
  if (health?.kind !== 'biz-project-service' || health.protocol_version !== 1 || health.instance_id !== value.instance_id
    || health.records_root !== state.records_root || health.pid !== value.pid) return null;
  return { value, health };
}
function summary(probe, started = false) {
  return { state: 'running', started, pid: probe.health.pid, instance_id: probe.health.instance_id,
    snapshot_state: probe.health.watcher?.scan_state ?? null, watcher_active: probe.health.watcher?.active ?? false };
}
const applicable = state => state.initialized && !state.skip_recording && !state.project_confirmation_required && !state.records_root_confirmation_required;
export async function serviceStatus(state) {
  if (!applicable(state)) return { state: 'not_applicable', started: false };
  const probe = await probeService(state); if (probe) return summary(probe);
  const policy = servicePolicy(state);
  return { state: policy.stopped ? 'stopped' : policy.auto_start === null ? 'confirmation_required' : policy.auto_start ? 'not_running' : 'disabled', started: false };
}
export async function ensureService(state) {
  if (!applicable(state)) return { state: 'not_applicable', started: false };
  return ensureRuntime(state, false);
}
export async function ensureCenterService(state, { resumeCompanion = false } = {}) {
  if (!state.registry || state.records_root_confirmation_required || !state.records_root) return { state: 'not_applicable', started: false };
  if (resumeCompanion) {
    const eligible = policy => policy.stopped && policy.companion_resume === true && policy.auto_start === true;
    if (eligible(servicePolicy(state))) updatePolicy(state, current => eligible(current) ? { stopped: false, companion_resume: false } : null);
  }
  return ensureRuntime(state, true);
}
// Companion stops are reversible only by a caller explicitly authorized to link startup.
// A separate stop invalidates the receipt; ordinary ensure/status/open never consume it.
export async function stopCenterService(state) {
  const probe = await probeService(state);
  if (!probe) {
    const current = descriptor(state);
    if (current && processAlive(current.pid)) return { state: 'unavailable', message: '无法核实运行中的服务身份，未执行停止，请稍后刷新状态。' };
    return { state: servicePolicy(state).stopped ? 'stopped' : 'not_running' };
  }
  if (!probe.health.capabilities?.includes('service-control-v1')) return { state: 'incompatible', message: '共享服务版本不兼容，请保存草稿后手动停止。' };
  const marker = markServiceStopped(state);
  const reply = await requestRuntime(probe.value, '/api/service/stop', 'POST', { 'x-biz-stop-request': marker.stop_id });
  if (!reply?.stopping) return { state: 'unavailable', message: '停止请求未确认，请稍后刷新状态；未强制终止任何进程。' };
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = descriptor(state);
    if (!current) {
      updatePolicy(state, policy => policy.stopped && policy.stop_id === marker.stop_id ? { companion_resume: true } : null);
      return { state: 'stopped' };
    }
    if (current.instance_id !== probe.value.instance_id) return { state: 'unavailable', message: '服务实例已变化，请刷新状态后重试。' };
    await delay(100);
  }
  return { state: 'unavailable', message: '服务尚未完成停止，请稍后刷新状态；未强制终止任何进程。' };
}
async function ensureRuntime(state, localOnly) {
  const existing = await probeService(state); if (existing) return summary(existing);
  const policy = servicePolicy(state);
  if (policy.stopped) return { state: 'stopped', started: false };
  if (policy.auto_start !== true) return { state: policy.auto_start === null ? 'confirmation_required' : 'disabled', started: false };
  if (policy.failure_until > Date.now()) return { state: 'cooldown', started: false, warning: 'Service startup failed recently; retry after the cooldown.' };
  const files = servicePaths(state), deadline = Date.now() + 5000; let release;
  try { release = acquireLease(files.startup); }
  catch (error) {
    while (Date.now() < deadline) { const probe = await probeService(state); if (probe) return summary(probe); await delay(100); }
    updatePolicy(state, { failure_until: Date.now() + 30000 });
    return { state: 'unavailable', started: false, warning: error.message };
  }
  try {
    const checked = await probeService(state); if (checked) return summary(checked);
    if (servicePolicy(state).stopped) return { state: 'stopped', started: false };
    const old = descriptor(state);
    if (old && processAlive(old.pid)) throw new Error('Existing service process is not responding; no duplicate was started.');
    if (fs.existsSync(files.log) && (fs.lstatSync(files.log).isSymbolicLink() || !fs.statSync(files.log).isFile())) throw new Error('Unsafe service log.');
    const log = fs.openSync(files.log, 'w', 0o600);
    try {
      const child = spawn(process.execPath, [path.join(sourceDirectory, 'scripts/platform-web.mjs'), '--background', '--no-open',
        '--config', state.config_file, '--records-root', state.records_root, ...(localOnly ? ['--no-lan'] : [])], { cwd: sourceDirectory, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    } finally { fs.closeSync(log); }
    while (Date.now() < deadline) { const probe = await probeService(state); if (probe) return summary(probe, true); await delay(100); }
    throw new Error('Service startup timed out; inspect the private service log.');
  } catch (error) {
    updatePolicy(state, { failure_until: Date.now() + 30000 }); return { state: 'unavailable', started: false, warning: error.message };
  } finally { release(); }
}
export function claimService(state) {
  const files = servicePaths(state), release = acquireLease(files.lease);
  const identity = { instance_id: randomUUID(), service_token: randomBytes(32).toString('base64url') };
  let published = false;
  return { identity,
    publish(url) { atomicWrite(files.runtime, jsonText({ schema_version: 1, ...identity, url, records_root: state.records_root,
      pid: process.pid, created_at: new Date().toISOString() })); published = true; },
    release() { if (published) { const current = descriptor(state); if (current?.instance_id === identity.instance_id) fs.unlinkSync(files.runtime); }
      release(); } };
}
export async function stopService(state) {
  if (!applicable(state)) return { state: 'not_applicable' };
  markServiceStopped(state); const probe = await probeService(state);
  if (probe) await requestRuntime(probe.value, '/api/service/stop', 'POST');
  const until = Date.now() + 5000;
  while (Date.now() < until) { if (!await probeService(state)) { await delay(100); return { state: 'stopped' }; } await delay(100); }
  return { state: 'stopping', warning: 'Service shutdown is still in progress.' };
}
