import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { connectionProfile, publishConnection } from '../scripts/lib/service-connection.mjs';
import { startPlatformWeb } from '../scripts/lib/platform-web.mjs';
import { sourceDirectory } from '../scripts/lib/storage.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-connection-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'records'), config = path.join(base, 'private/config.json');
  fs.mkdirSync(root); fs.mkdirSync(path.dirname(config));
  fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({ kind: 'biz-project', schema_version: 1, projects: {} }));
  fs.writeFileSync(config, JSON.stringify({ records_root: root }));
  return { base, state: { records_root: root, config_file: config } };
}

test('durable profiles publish actual startup paths outside source/records without credentials', t => {
  const f = fixture(t), home = path.join(f.base, 'home');
  const profile = connectionProfile(f.state);
  assert.equal(profile.kind, 'biz-project-connection'); assert.equal(profile.protocol_version, 1);
  assert.equal(profile.installation_directory, sourceDirectory); assert.equal(profile.node_executable, process.execPath);
  assert.equal(profile.config_file, f.state.config_file); assert.equal(profile.records_root, f.state.records_root);
  assert.match(profile.id, /^[a-f0-9]{64}$/);
  const file = publishConnection(profile, home);
  assert.equal(file, path.join(home, '.config/biz-project/connections', `${profile.id}.json`));
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), profile);
  assert.equal(/token|password|owner|access_key/.test(fs.readFileSync(file, 'utf8')), false);
  fs.utimesSync(file, 1000, 1000); const before = fs.statSync(file).mtimeMs;
  assert.equal(publishConnection(profile, home), file, 'The same profile replaces one file, not an unbounded history');
  assert.equal(fs.statSync(file).mtimeMs, before, 'Unchanged publication does not rewrite the file');
  const secondConfig = path.join(f.base, 'private/second.json'); fs.copyFileSync(f.state.config_file, secondConfig);
  assert.notEqual(connectionProfile({ ...f.state, config_file: secondConfig }).id, profile.id);
  assert.throws(() => publishConnection(profile, f.state.records_root), /outside/);
  assert.throws(() => publishConnection({ ...profile, id: '../other' }, home), /identity/);
});

test('connection metadata needs service credentials even for local owners and is unavailable on LAN', async t => {
  const f = fixture(t), profile = connectionProfile(f.state);
  const identity = { instance_id: randomUUID(), service_token: randomBytes(32).toString('base64url') };
  const server = await startPlatformWeb({ configFile: f.state.config_file, recordsRoot: f.state.records_root,
    serviceIdentity: identity, connectionProfile: profile, lan: true });
  t.after(() => server.close());
  const origin = new URL(server.url).origin, route = '/api/service/connection';
  assert.equal((await fetch(origin + route)).status, 403);
  const headers = { Origin: origin, 'x-biz-service-token': identity.service_token };
  const response = await fetch(origin + route, { headers });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.deepEqual(value.profile, profile); assert.equal(value.instance_id, identity.instance_id);
  assert.equal(value.pid, process.pid); assert.equal(JSON.stringify(value).includes(identity.service_token), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(origin + route, { headers: { ...headers, Origin: 'https://evil.invalid' } })).status, 403);
  for (const url of server.lanUrls) {
    const lan = new URL(url).origin;
    assert.equal((await fetch(lan + route, { headers: { ...headers, Origin: lan } })).status, 403);
  }
  const file = publishConnection(profile, path.join(f.base, 'home'));
  await server.close(); assert.ok(fs.existsSync(file), 'Offline startup metadata survives service shutdown');
});
