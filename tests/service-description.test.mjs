import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeConnections } from '../scripts/lib/service-description.mjs';
import { startSharedPlatform } from '../scripts/lib/shared-platform.mjs';
import { probeService, markServiceStopped, servicePaths } from '../scripts/lib/service-runtime.mjs';
import { claimService } from '../scripts/lib/service-runtime.mjs';
import { startPlatformWeb } from '../scripts/lib/platform-web.mjs';
import { connectionProfile, publishConnection } from '../scripts/lib/service-connection.mjs';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-describe-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const config = path.join(home, '.config/biz-project/config.json');
  const root = path.join(home, 'confirmed-records');
  const confirm = () => {
    fs.mkdirSync(path.dirname(config), { recursive: true }); fs.mkdirSync(root);
    fs.writeFileSync(config, JSON.stringify({ schema_version: 1, records_root: root }));
    fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({ schema_version: 1, kind: 'biz-project', projects: {} }));
  };
  return { home, config, root, confirm, state: { config_file: config, records_root: root } };
}

test('offline describe uses only confirmed configuration, never creates defaults or policies', async t => {
  const f = fixture(t);
  assert.equal((await describeConnections(undefined, { home: f.home })).state, 'center_required');
  assert.deepEqual(fs.readdirSync(f.home), []);
  f.confirm();
  const result = await describeConnections(undefined, { home: f.home });
  assert.equal(result.state, 'ready'); assert.equal(result.connections.length, 1);
  const item = result.connections[0];
  assert.equal(item.state, 'confirmation_required'); assert.equal(item.identity, 'startup');
  assert.equal(item.profile.node_executable, process.execPath);
  assert.equal(item.profile.config_file, f.config); assert.equal(item.profile.records_root, f.root);
  assert.equal(fs.existsSync(servicePaths(f.state).directory), false);
  assert.equal(/token|password|owner/.test(JSON.stringify(result)), false);
});

test('managed platform registers, reuses one lease and leaves durable metadata on close', async t => {
  const f = fixture(t); f.confirm();
  const options = { configFile: f.config, connectionHome: f.home };
  const first = await startSharedPlatform(options); t.after(() => first.close());
  assert.ok(await probeService(f.state));
  const result = await describeConnections(f.config, { home: f.home });
  assert.equal(result.connections[0].state, 'running'); assert.equal(result.connections[0].identity, 'running');
  const second = await startSharedPlatform(options);
  assert.equal(second.url, first.url); assert.equal(second.owned, false);
  await second.close(); assert.ok(await probeService(f.state));
  await first.close();
  assert.equal(fs.existsSync(servicePaths(f.state).runtime), false);
  assert.equal(fs.readdirSync(path.join(f.home, '.config/biz-project/connections')).length, 1);
  markServiceStopped(f.state);
  assert.equal((await describeConnections(f.config, { home: f.home })).connections[0].state, 'stopped');
});

test('management opened before confirmation registers lazily without a second server', async t => {
  const f = fixture(t);
  const platform = await startSharedPlatform({ configFile: f.config, connectionHome: f.home });
  t.after(() => platform.close());
  assert.equal(await probeService(f.state), null);
  f.confirm();
  const response = await fetch(new URL('/api/dashboard', platform.url));
  assert.equal(response.status, 200);
  assert.ok(await probeService(f.state));
  assert.equal((await describeConnections(f.config, { home: f.home })).connections[0].identity, 'running');
});

test('old healthy services describe future startup paths without replacing or trusting running identity', async t => {
  const f = fixture(t); f.confirm();
  const lease = claimService(f.state);
  const old = await startPlatformWeb({ configFile: f.config, serviceIdentity: lease.identity });
  t.after(async () => { await old.close(); lease.release(); }); lease.publish(old.url);
  const before = fs.readFileSync(servicePaths(f.state).runtime, 'utf8');
  const result = await describeConnections(f.config, { home: f.home });
  assert.equal(result.connections[0].state, 'upgrade_required');
  assert.equal(result.connections[0].identity, 'startup');
  assert.equal(fs.readFileSync(servicePaths(f.state).runtime, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(f.home, '.config/biz-project/connections')), false);
  assert.ok(await probeService(f.state));
});

test('malformed configuration and environment roots never select another center', async t => {
  const f = fixture(t); f.confirm();
  fs.writeFileSync(f.config, JSON.stringify({ schema_version: 1, records_root: 'relative' }));
  assert.equal((await describeConnections(f.config, { home: f.home })).state, 'center_required');
  assert.equal(fs.existsSync(servicePaths(f.state).directory), false);
});

test('multiple confirmed profiles stay distinct and explicit config does not enumerate alternatives', async t => {
  const f = fixture(t); f.confirm();
  const second = path.join(path.dirname(f.config), 'second.json'); fs.copyFileSync(f.config, second);
  publishConnection(connectionProfile({ ...f.state, config_file: second }), f.home);
  const both = await describeConnections(undefined, { home: f.home });
  assert.equal(both.connections.length, 2);
  assert.notEqual(both.connections[0].profile.id, both.connections[1].profile.id);
  assert.equal((await describeConnections(second, { home: f.home })).connections.length, 1);
  fs.writeFileSync(second, ' '.repeat(8193));
  const changed = await describeConnections(undefined, { home: f.home });
  assert.equal(changed.connections.length, 1); assert.ok(changed.ignored >= 1);
});

test('describe returns actual authenticated Node metadata instead of claiming the bootstrap Node is running', async t => {
  const f = fixture(t); f.confirm();
  const lease = claimService(f.state), actual = { ...connectionProfile(f.state), node_executable: path.join(f.home, 'actual-node.exe'), private_token: 'never-forward-this-field' };
  const platform = await startPlatformWeb({ configFile: f.config, serviceIdentity: lease.identity, connectionProfile: actual });
  t.after(async () => { await platform.close(); lease.release(); }); lease.publish(platform.url);
  const item = (await describeConnections(f.config, { home: f.home })).connections[0];
  assert.equal(item.identity, 'running'); assert.equal(item.profile.node_executable, actual.node_executable);
  assert.equal(JSON.stringify(item).includes(actual.private_token), false);
});

test('late confirmation cannot acquire another live center lease or start another watcher', async t => {
  const f = fixture(t), options = { configFile: f.config, connectionHome: f.home };
  const early = await startSharedPlatform(options); t.after(() => early.close());
  f.confirm();
  const owner = await startSharedPlatform(options); t.after(() => owner.close());
  assert.notEqual((await fetch(new URL('/api/dashboard', early.url))).status, 200);
  assert.equal(early.historyWatcher, null);
  await early.close(); assert.ok(await probeService(f.state));
});
