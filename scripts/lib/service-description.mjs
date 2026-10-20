import fs from 'node:fs';
import path from 'node:path';
import { canonical, homeDirectory, sourceDirectory } from './storage.mjs';
import { connectionProfile } from './service-connection.mjs';
import { descriptor, probeService, serviceConnection, servicePolicy } from './service-runtime.mjs';
import { processAlive } from './process-lease.mjs';

const local = value => typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f]/.test(value)
  && path.isAbsolute(value) && (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value));
function read(file, limit) {
  if (!local(file)) throw new Error('Expected a local absolute path.');
  for (let item = path.resolve(file); ; item = path.dirname(item)) {
    if (fs.existsSync(item) && fs.lstatSync(item).isSymbolicLink()) throw new Error('Unsafe connection path.');
    if (item === path.dirname(item)) break;
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > limit) throw new Error('Invalid connection file.');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(limit + 1, stat.size + 1));
    const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (size > limit) throw new Error('Connection file grew beyond its limit.');
    return JSON.parse(buffer.subarray(0, size).toString('utf8').replace(/^\uFEFF/, ''));
  } finally { fs.closeSync(fd); }
}
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

async function describe(config) {
  const saved = read(config, 8192);
  if (saved.schema_version !== 1 || !local(saved.records_root)) throw new Error('Unconfirmed center.');
  const root = canonical(saved.records_root), registry = read(path.join(root, 'registry.json'), 4 * 1024 * 1024);
  if (registry.kind !== 'biz-project' || registry.schema_version !== 1) throw new Error('Unconfirmed center.');
  const state = { records_root: root, config_file: canonical(config) }, profile = connectionProfile(state);
  const probe = await probeService(state);
  if (probe) {
    if (!probe.health.capabilities?.includes('local-connection-v1')) return { profile, state: 'upgrade_required', identity: 'startup' };
    const actual = await serviceConnection(probe);
    if (!actual || actual.kind !== profile.kind || actual.protocol_version !== 1 || actual.id !== profile.id
      || !same(actual.config_file ?? '', profile.config_file) || !same(actual.records_root ?? '', profile.records_root)
      || !same(actual.installation_directory ?? '', sourceDirectory) || !same(actual.runtime_file ?? '', profile.runtime_file)
      || !local(actual.node_executable) || typeof actual.version !== 'string' || !/^[\x20-\x7e]{1,64}$/.test(actual.version)
      || !Array.isArray(actual.capabilities) || actual.capabilities.length > 32
      || actual.capabilities.some(value => typeof value !== 'string' || value.length > 128)
      || !profile.capabilities.every(value => actual.capabilities.includes(value))) throw new Error('Service identity differs from selected source.');
    const safe = Object.fromEntries(Object.keys(profile).map(key => [key, actual[key]]));
    return { profile: safe, state: 'running', identity: 'running' };
  }
  const runtime = descriptor(state);
  if (runtime && processAlive(runtime.pid)) return { profile, state: 'unavailable', identity: 'startup' };
  const policy = servicePolicy(state);
  return { profile, state: policy.stopped ? 'stopped' : policy.auto_start === null ? 'confirmation_required'
    : policy.auto_start ? 'not_running' : 'disabled', identity: 'startup' };
}

// This command is a read-only bootstrap, not a service start or directory scan.
export async function describeConnections(configFile, { home = homeDirectory } = {}) {
  const configs = new Set(), result = { kind: 'biz-project-connection-description', protocol_version: 1,
    state: 'center_required', connections: [], ignored: 0, truncated: false };
  if (configFile !== undefined) {
    if (!local(configFile)) throw new Error('Expected a local absolute config.');
    configs.add(canonical(configFile));
  } else {
    configs.add(path.join(home, '.config/biz-project/config.json'));
    const directory = path.join(home, '.config/biz-project/connections');
    try {
      // Bounded iteration: never recursively search projects or drives.
      const dir = fs.opendirSync(directory);
      try {
        let entry, count = 0;
        while ((entry = dir.readSync())) {
          if (++count > 128 || configs.size >= 16) { result.truncated = true; break; }
          if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
          try {
            const p = read(path.join(directory, entry.name), 32768);
            if (p.kind === 'biz-project-connection' && p.protocol_version === 1 && same(p.installation_directory ?? '', sourceDirectory)
              && local(p.config_file)) configs.add(canonical(p.config_file));
          } catch { result.ignored++; }
        }
      } finally { dir.closeSync(); }
    } catch (error) { if (error.code !== 'ENOENT') result.ignored++; }
  }
  const deadline = Date.now() + 2500;
  for (const config of configs) {
    if (Date.now() >= deadline) { result.truncated = true; break; }
    try {
      const item = await describe(config);
      if (Buffer.byteLength(JSON.stringify(result)) + Buffer.byteLength(JSON.stringify(item)) > 60000) { result.truncated = true; break; }
      result.connections.push(item);
    } catch { result.ignored++; }
  }
  if (result.connections.length) result.state = 'ready';
  else result.message = '请先在 Biz Project 中确认记录中心，再重新连接；不会创建默认中心。';
  return result;
}
