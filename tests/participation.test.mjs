import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, test } from 'node:test';
import { participation, saveParticipation } from '../scripts/lib/participation.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let sandbox, project, home, records, config, preferences, env;
function tree(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    return [name, stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isDirectory() ? tree(file) : fs.readFileSync(file).toString('base64')];
  }));
}
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-participation-'));
  home = path.join(sandbox, 'home'); project = path.join(sandbox, 'project'); records = path.join(sandbox, 'records');
  config = path.join(home, '.config/biz-project/config.json'); preferences = path.join(path.dirname(config), 'project-preferences.json');
  [home, project].forEach(p => fs.mkdirSync(p, { recursive: true }));
  env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of ['BIZ_PROJECT_HOME', 'PROJECT_RECORDS_HOME', 'CODEX_HOME']) delete env[key];
});
afterEach(() => {
  assert.equal(path.dirname(sandbox), os.tmpdir()); assert.ok(path.basename(sandbox).startsWith('biz-project-participation-'));
  fs.rmSync(sandbox, { recursive: true, force: true });
});
const run = (command, ...args) => spawnSync(process.execPath, [path.join(source, 'scripts/biz-project.mjs'), command,
  '--project', project, '--config', config, ...args], { encoding: 'utf8', env });
function ok(result) { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
function denied(result, pattern) { assert.equal(result.status, 1, result.stdout); assert.match(JSON.parse(result.stderr).error, pattern); }
const decide = decision => ok(run('set-participation', '--decision', decision));

test('unanswered enrollment is read-only and a confirmed center alone cannot initialize a new project', () => {
  const before = tree(sandbox), state = ok(run('inspect'));
  assert.equal(state.project_confirmation_required, true);
  assert.equal(state.participation.status, 'unanswered');
  denied(run('init', '--records-root', records), /project.*confirm|ask.*join/i);
  assert.deepEqual(tree(sandbox), before);
});

test('declining writes only shared local preferences and suppresses subsequent calls on all hosts', () => {
  const result = decide('no'); assert.equal(result.participation.status, 'declined');
  assert.equal(fs.existsSync(config), false); assert.equal(fs.existsSync(records), false);
  assert.deepEqual(fs.readdirSync(project), []); assert.ok(fs.existsSync(preferences));
  const before = tree(sandbox);
  for (const host of ['codex', 'cursor', 'generic']) {
    const state = ok(run('inspect', '--host', host));
    assert.equal(state.skip_recording, true); assert.equal(state.project_confirmation_required, false);
    assert.equal(state.records_root_confirmation_required, false);
    denied(run('init', '--host', host, '--records-root', records, '--join-confirmed'), /declined/i);
    denied(run('create-feature', '--host', host, '--title', 'No files', '--owner', 'test'), /declined/i);
    denied(run('add-update', '--host', host, '--feature', 'anything', '--agent', 'test', '--body-file', 'missing'), /declined/i);
  }
  decide('no'); assert.deepEqual(tree(sandbox), before, 'Retries must not change refusal timestamps or create hooks');
});

test('declined projects skip broken center configuration and malformed guidance without prompting', () => {
  decide('no'); fs.writeFileSync(config, '{broken');
  fs.writeFileSync(path.join(project, 'AGENTS.md'), '<!-- biz-project:start -->');
  const before = tree(sandbox);
  assert.equal(ok(run('inspect')).skip_recording, true);
  assert.deepEqual(tree(sandbox), before);
});

test('explicit yes allows joining but does not confirm a missing center', () => {
  decide('yes'); const before = tree(sandbox);
  denied(run('init'), /center.*confirm/i); assert.deepEqual(tree(sandbox), before);
  const first = ok(run('init', '--records-root', records));
  assert.equal(ok(run('inspect')).participation.status, 'registered');
  assert.equal(ok(run('init')).project_id, first.project_id);
  assert.equal(ok(run('init', '--host', 'cursor')).project_id, first.project_id);
});

test('declined projects cannot be restored by invoking init with a confirmation flag', () => {
  decide('no'); const before = tree(sandbox);
  denied(run('init', '--join-confirmed', '--records-root', records), /declined/i);
  assert.deepEqual(tree(sandbox), before);
  decide('yes'); assert.equal(ok(run('init', '--records-root', records)).initialized, true);
});

test('registered projects need no new enrollment confirmation when adding another host', () => {
  const first = ok(run('init', '--join-confirmed', '--records-root', records));
  assert.equal(fs.existsSync(preferences), false);
  assert.equal(ok(run('init', '--host', 'cursor')).project_id, first.project_id);
});

test('refusal survives a non-Git project later becoming a Git repository', () => {
  decide('no'); const git = spawnSync('git', ['init', project], { encoding: 'utf8' }); assert.equal(git.status, 0, git.stderr);
  assert.equal(ok(run('inspect')).skip_recording, true);
  decide('yes'); assert.equal(ok(run('init', '--records-root', records)).initialized, true);
});

test('Windows refusal matches short and long aliases after project identity changes', { skip: process.platform !== 'win32' }, t => {
  const longPath = fs.realpathSync.native(process.env.ProgramFiles);
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `for %I in ("${longPath}") do @echo %~sI`],
    { encoding: 'utf8', windowsVerbatimArguments: true });
  assert.equal(result.status, 0, result.stderr);
  const shortPath = result.stdout.trim();
  assert.ok(fs.existsSync(shortPath));
  if (shortPath.toLowerCase() === longPath.toLowerCase()) { t.skip('This Windows volume has no 8.3 alias'); return; }
  // Read the existing aliases only; all preference writes stay in the temporary fixture.
  saveParticipation({ root: shortPath, identity: 'directory:short-alias-fixture' }, config, 'no');
  const state = participation({ root: longPath, identity: 'git:long-alias-fixture' }, config);
  assert.equal(state.status, 'declined');
});

test('Git worktrees share the same refusal and explicit restoration', () => {
  const git = (...args) => { const result = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
  git('init'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--allow-empty', '-m', 'Fixture');
  const linked = path.join(sandbox, 'linked'); git('worktree', 'add', '-b', 'fixture-linked', linked);
  decide('no'); project = linked;
  assert.equal(ok(run('inspect', '--host', 'cursor')).skip_recording, true);
  decide('yes'); assert.equal(ok(run('init', '--records-root', records)).initialized, true);
});

test('malformed preferences fail closed without overwriting private data', () => {
  fs.mkdirSync(path.dirname(preferences), { recursive: true }); fs.writeFileSync(preferences, '{broken');
  const before = tree(sandbox);
  denied(run('inspect'), /JSON|preferences/i); denied(run('set-participation', '--decision', 'no'), /JSON|preferences/i);
  assert.deepEqual(tree(sandbox), before);
});

test('refusal cannot store preferences inside the project or confirmed records directory', () => {
  const before = tree(sandbox);
  denied(run('set-participation', '--decision', 'no', '--config', path.join(project, 'config.json')), /separate|outside/i);
  denied(run('set-participation', '--decision', 'no', '--config', path.join(records, 'config.json'), '--records-root', records), /separate|outside/i);
  assert.deepEqual(tree(sandbox), before);
});

test('a records center selected through the environment cannot contain the preference file', () => {
  env.BIZ_PROJECT_HOME = path.dirname(config); const before = tree(sandbox);
  denied(run('set-participation', '--decision', 'no'), /outside|separate/i);
  assert.deepEqual(tree(sandbox), before);
});
