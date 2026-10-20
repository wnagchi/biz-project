import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(source, 'scripts', 'biz-project.mjs');
let sandbox, home, project, records, config, environment;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), 'biz-project-test-'));
  home = path.join(sandbox, 'home');
  project = path.join(sandbox, 'sample-project');
  records = path.join(sandbox, 'central-records');
  config = path.join(home, '.config', 'biz-project', 'config.json');
  await mkdir(home);
  await mkdir(project);
  environment = { ...process.env, HOME: home, USERPROFILE: home };
  delete environment.BIZ_PROJECT_HOME;
  delete environment.PROJECT_RECORDS_HOME;
  delete environment.CODEX_HOME;
});

afterEach(async () => {
  assert.ok(path.basename(sandbox).startsWith('biz-project-test-'));
  assert.equal(path.dirname(sandbox), os.tmpdir());
  await rm(sandbox, { recursive: true, force: true });
});

function run(command, ...args) {
  return spawnSync(process.execPath, [cli, command, '--project', project,
    '--config', config, ...(command === 'init' ? ['--join-confirmed'] : []), ...args], { env: environment, encoding: 'utf8' });
}

async function runAsync(command, ...args) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await runAsyncOnce(command, ...args);
    if (result.status === 0 || !/Records are busy/.test(result.stderr)) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return runAsyncOnce(command, ...args);
}
function runAsyncOnce(command, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, command, '--project', project,
      '--config', config, ...(command === 'init' ? ['--join-confirmed'] : []), ...args], { env: environment });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function successful(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function rejected(result) {
  assert.notEqual(result.status, 0, result.stdout);
  const error = JSON.parse(result.stderr);
  assert.ok(error.error);
  return error;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function seedCenter(directory, kind = 'biz-project') {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'registry.json'), JSON.stringify({
    kind, schema_version: 1, projects: {}
  }));
}

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('inspect reports first use without creating files', async () => {
  const state = successful(run('inspect'));
  assert.equal(state.initialized, false);
  assert.equal(state.records_root, null);
  assert.equal(state.project_root, project);
  assert.deepEqual(await readdir(project), []);
  assert.deepEqual(await readdir(home), []);
});

test('init registers one project and preserves the same registration on retry', async () => {
  const first = successful(run('init', '--records-root', records));
  const registryFile = path.join(records, 'registry.json');
  const registryBefore = await readFile(registryFile);
  const guidanceBefore = await readFile(path.join(project, 'AGENTS.md'));
  const second = successful(run('init'));
  assert.equal(second.project_id, first.project_id);
  assert.deepEqual(await readFile(registryFile), registryBefore);
  assert.deepEqual(await readFile(path.join(project, 'AGENTS.md')), guidanceBefore);
  assert.equal(Object.keys((await readJson(registryFile)).projects).length, 1);
  assert.equal(successful(run('inspect')).initialized, true);
  assert.equal((await readJson(config)).records_root, records);
});

test('init preserves existing Unicode, BOM and CRLF rule bytes', async () => {
  const original = Buffer.from('\uFEFF# \u9879\u76ee\u89c4\u5219\r\n\r\nNever commit local records.\r\n');
  await writeFile(path.join(project, 'AGENTS.md'), original);
  successful(run('init', '--records-root', records));
  const actual = await readFile(path.join(project, 'AGENTS.md'));
  assert.deepEqual(actual.subarray(0, original.length), original);
  assert.ok(actual.toString('utf8').includes('$biz-project'));
  assert.ok(!actual.toString('utf8').replaceAll('\r\n', '').includes('\n'));
});

test('init reuses a configured center for another project', async () => {
  successful(run('init', '--records-root', records));
  project = path.join(sandbox, 'another-project');
  await mkdir(project);
  const result = successful(run('init'));
  assert.equal(result.records_root, records);
  assert.equal(Object.keys((await readJson(path.join(records, 'registry.json'))).projects).length, 2);
});

test('init discovers a recognized existing center before selecting a new one', async () => {
  const existing = path.join(home, 'biz-project');
  await seedCenter(existing);
  assert.equal(successful(run('inspect')).records_root, existing);
  assert.equal(successful(run('init')).records_root, existing);
  assert.ok(!(await readdir(home)).includes('.biz-project'));
});

test('ambiguous discovered centers require explicit selection without writes', async () => {
  await seedCenter(path.join(home, '.biz-project'));
  await seedCenter(path.join(home, 'biz-project'));
  rejected(run('init'));
  assert.deepEqual(await readdir(project), []);
  assert.ok(!(await readdir(home)).includes('.config'));
});

test('init refuses to put private data in the skill engineering directory', async () => {
  rejected(run('init', '--records-root', source));
  assert.deepEqual(await readdir(project), []);
});

test('init does not reinterpret a nonempty unrelated directory as a center', async () => {
  await mkdir(records);
  await writeFile(path.join(records, 'important.txt'), 'keep me');
  rejected(run('init', '--records-root', records));
  assert.deepEqual(await readdir(records), ['important.txt']);
  assert.deepEqual(await readdir(project), []);
});

test('init respects the active AGENTS.override file', async () => {
  await writeFile(path.join(project, 'AGENTS.md'), '# base\n');
  await writeFile(path.join(project, 'AGENTS.override.md'), '# override\n');
  successful(run('init', '--records-root', records));
  assert.equal(await readFile(path.join(project, 'AGENTS.md'), 'utf8'), '# base\n');
  assert.ok((await readFile(path.join(project, 'AGENTS.override.md'), 'utf8')).includes('$biz-project'));
});

test('an explicit alternative rule file is remembered on subsequent runs', async () => {
  await writeFile(path.join(project, 'CLAUDE.md'), '# existing guidance\n');
  successful(run('init', '--records-root', records, '--rules-file', 'CLAUDE.md'));
  assert.ok((await readFile(path.join(project, 'CLAUDE.md'), 'utf8')).startsWith('# existing guidance\n'));
  assert.ok(!(await readdir(project)).includes('AGENTS.md'));
  assert.equal(successful(run('inspect')).initialized, true);
  assert.equal(successful(run('init')).rules_file, path.join(project, 'CLAUDE.md'));
});

test('an alternative rule path cannot escape the project', async () => {
  rejected(run('init', '--records-root', records, '--rules-file', '../outside.md'));
  assert.deepEqual(await readdir(project), []);
  assert.ok(!(await readdir(sandbox)).includes('outside.md'));
});

test('a malformed managed hook stops initialization before creating records', async () => {
  const original = '# rules\n<!-- project-records:start -->\nunfinished\n';
  await writeFile(path.join(project, 'AGENTS.md'), original);
  rejected(run('init', '--records-root', records));
  assert.equal(await readFile(path.join(project, 'AGENTS.md'), 'utf8'), original);
  assert.ok(!(await readdir(sandbox)).includes('central-records'));
});

test('a lock owned by another process is retained and blocks registration', async () => {
  await seedCenter(records);
  await writeFile(path.join(records, '.write.lock'), 'another process');
  rejected(run('init', '--records-root', records));
  assert.equal(await readFile(path.join(records, '.write.lock'), 'utf8'), 'another process');
  assert.deepEqual((await readJson(path.join(records, 'registry.json'))).projects, {});
  assert.deepEqual(await readdir(project), []);
});

test('linked Git worktrees share one project registration', async () => {
  git('init', '-b', 'new_cms_develop', project);
  git('-C', project, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-m', 'fixture');
  const first = successful(run('init', '--records-root', records));
  const linked = path.join(sandbox, 'linked-worktree');
  git('-C', project, 'worktree', 'add', '--detach', linked, 'HEAD');
  project = linked;
  const second = successful(run('init'));
  assert.equal(second.project_id, first.project_id);
  assert.equal(Object.keys((await readJson(path.join(records, 'registry.json'))).projects).length, 1);
});

test('feature creation requires an initialized project', () => {
  rejected(run('create-feature', '--title', 'A feature', '--owner', 'coordinator'));
});

test('feature and update records keep evidence separate from overall status', async () => {
  const registration = successful(run('init', '--records-root', records));
  const feature = successful(run('create-feature', '--title', 'Coupon fix', '--owner', 'coordinator'));
  const bodyFile = path.join(sandbox, 'update.md');
  await writeFile(bodyFile, 'Verified the coupon flow.\nCommit: abc123\n');
  const update = successful(run('add-update', '--feature', feature.feature_id,
    '--agent', 'worker-a', '--body-file', bodyFile, '--update-id', 'worker-a-checkpoint-1'));
  const saved = await readJson(update.update_file);
  assert.equal(saved.project_id, registration.project_id);
  assert.equal(saved.feature_id, feature.feature_id);
  assert.equal(saved.agent, 'worker-a');
  assert.equal(saved.content, 'Verified the coupon flow.\nCommit: abc123\n');
  assert.equal((await readJson(path.join(feature.feature_directory, 'feature.json'))).status, 'planned');
});

test('retrying an update keeps the same file and rejects changed content', async () => {
  successful(run('init', '--records-root', records));
  const feature = successful(run('create-feature', '--title', 'Shared task', '--owner', 'owner'));
  const bodyFile = path.join(sandbox, 'update.md');
  await writeFile(bodyFile, 'First evidence.');
  const args = ['--feature', feature.feature_id, '--agent', 'worker',
    '--body-file', bodyFile, '--update-id', 'checkpoint-1'];
  const first = successful(run('add-update', ...args));
  const original = await readFile(first.update_file);
  assert.equal(successful(run('add-update', ...args)).update_file, first.update_file);
  await writeFile(bodyFile, 'Contradictory evidence.');
  rejected(run('add-update', ...args));
  assert.deepEqual(await readFile(first.update_file), original);
});

test('parallel contributors publish distinct complete update files', async () => {
  successful(run('init', '--records-root', records));
  const feature = successful(run('create-feature', '--title', 'Parallel work', '--owner', 'owner'));
  const bodyFile = path.join(sandbox, 'update.md');
  await writeFile(bodyFile, 'Independent result.');
  const outcomes = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    runAsync('add-update', '--feature', feature.feature_id, '--agent', `worker-${index}`,
      '--body-file', bodyFile).then(successful)));
  assert.equal(new Set(outcomes.map((item) => item.update_file)).size, 4);
  for (const item of outcomes) {
    assert.equal((await readJson(item.update_file)).content, 'Independent result.');
  }
  assert.equal((await readdir(path.join(feature.feature_directory, 'updates'))).length, 4);
});

test('center consent: unconfigured init refuses all writes until the user selects a path', async () => {
  const original = '# Existing project agreements\n';
  await writeFile(path.join(project, 'AGENTS.md'), original);
  const error = rejected(run('init'));
  assert.match(error.error, /confirm/i);
  assert.match(error.error, /--records-root/);
  assert.equal(await readFile(path.join(project, 'AGENTS.md'), 'utf8'), original);
  assert.deepEqual(await readdir(home), []);
  assert.deepEqual((await readdir(sandbox)).sort(), ['home', 'sample-project']);
});

test('biz namespace: inspection suggests the new name but never selects the suggestion', async () => {
  const state = successful(run('inspect'));
  assert.equal(state.records_root, null);
  assert.equal(state.suggested_records_root, path.join(home, '.biz-project'));
  assert.equal(state.records_root_confirmation_required, true);
  assert.deepEqual(await readdir(home), []);
});

test('biz namespace: default user pointer, new registry and new guidance use biz-project', async () => {
  const result = successful(spawnSync(process.execPath,
    [cli, 'init', '--join-confirmed', '--project', project, '--records-root', records],
    { env: environment, encoding: 'utf8' }));
  assert.equal(result.config_file, path.join(home, '.config', 'biz-project', 'config.json'));
  assert.equal((await readJson(result.config_file)).records_root, records);
  assert.equal((await readJson(path.join(records, 'registry.json'))).kind, 'biz-project');
  const guidance = await readFile(result.rules_file, 'utf8');
  assert.ok(guidance.includes('<!-- biz-project:start -->'));
  assert.ok(!guidance.includes('<!-- project-records:start -->'));
  assert.deepEqual(await readdir(path.join(home, '.config')), ['biz-project']);
});

test('biz namespace: BIZ_PROJECT_HOME reuses a recognized center', async () => {
  await mkdir(records);
  await writeFile(path.join(records, 'registry.json'), JSON.stringify({
    kind: 'biz-project', schema_version: 1, projects: {}
  }));
  environment.BIZ_PROJECT_HOME = records;
  const state = successful(run('inspect'));
  assert.equal(state.records_root, records);
  assert.equal(state.records_root_source, 'environment');
  assert.equal(successful(run('init')).records_root, records);
});

test('center consent: a missing environment-selected center is not silently created', async () => {
  environment.BIZ_PROJECT_HOME = records;
  const error = rejected(run('init'));
  assert.match(error.error, /confirm/i);
  assert.deepEqual(await readdir(home), []);
  assert.deepEqual(await readdir(project), []);
  assert.ok(!(await readdir(sandbox)).includes('central-records'));
  assert.equal(successful(run('init', '--records-root', records)).records_root, records);
});

test('center consent: a missing configured center must be explicitly confirmed before recreation', async () => {
  await mkdir(path.dirname(config), { recursive: true });
  const original = JSON.stringify({ schema_version: 1, records_root: records });
  await writeFile(config, original);
  const error = rejected(run('init'));
  assert.match(error.error, /confirm/i);
  assert.equal(await readFile(config, 'utf8'), original);
  assert.deepEqual(await readdir(project), []);
  assert.ok(!(await readdir(sandbox)).includes('central-records'));
});

test('center consent: legacy centers and their pointer are reported without selection or mutation', async () => {
  const legacyRoot = path.join(home, '.project-records');
  await seedCenter(legacyRoot, 'project-records');
  const legacyConfig = path.join(home, '.config', 'project-records', 'config.json');
  await mkdir(path.dirname(legacyConfig), { recursive: true });
  const pointer = JSON.stringify({ schema_version: 1, records_root: legacyRoot });
  await writeFile(legacyConfig, pointer);
  const before = await readFile(path.join(legacyRoot, 'registry.json'));
  const state = successful(run('inspect'));
  assert.equal(state.records_root, null);
  assert.ok(state.legacy_records_centers.some((item) => item.records_root === legacyRoot));
  assert.equal(state.records_root_confirmation_required, true);
  assert.match(rejected(run('init')).error, /confirm/i);
  assert.deepEqual(await readFile(path.join(legacyRoot, 'registry.json')), before);
  assert.equal(await readFile(legacyConfig, 'utf8'), pointer);
  assert.deepEqual(await readdir(project), []);
  assert.deepEqual(await readdir(path.join(home, '.config')), ['project-records']);
});

test('center consent: PROJECT_RECORDS_HOME is only a legacy candidate', async () => {
  await seedCenter(records, 'project-records');
  environment.PROJECT_RECORDS_HOME = records;
  const state = successful(run('inspect'));
  assert.equal(state.records_root, null);
  assert.ok(state.legacy_records_centers.some((item) => item.records_root === records));
  assert.match(rejected(run('init')).error, /confirm/i);
  assert.deepEqual((await readJson(path.join(records, 'registry.json'))).projects, {});
});

test('center consent: a legacy registry in the new config is not implicitly reused', async () => {
  await seedCenter(records, 'project-records');
  await mkdir(path.dirname(config), { recursive: true });
  const pointer = JSON.stringify({ schema_version: 1, records_root: records });
  await writeFile(config, pointer);
  const before = await readFile(path.join(records, 'registry.json'));
  assert.match(rejected(run('init')).error, /confirm/i);
  assert.deepEqual(await readFile(path.join(records, 'registry.json')), before);
  assert.equal(await readFile(config, 'utf8'), pointer);
  assert.deepEqual(await readdir(project), []);
  assert.equal(successful(run('init', '--records-root', records)).records_root, records);
});

test('center consent: unconfigured new and legacy candidates require the user to choose', async () => {
  const current = path.join(home, '.biz-project');
  const legacy = path.join(home, '.project-records');
  await seedCenter(current);
  await seedCenter(legacy, 'project-records');
  const before = await readFile(path.join(current, 'registry.json'));
  const state = successful(run('inspect'));
  assert.equal(state.records_root_confirmation_required, true);
  assert.match(rejected(run('init')).error, /confirm/i);
  assert.deepEqual(await readFile(path.join(current, 'registry.json')), before);
  assert.deepEqual(await readdir(project), []);
  assert.ok(!(await readdir(home)).includes('.config'));
  assert.equal(successful(run('init', '--records-root', current)).records_root, current);
  assert.deepEqual((await readJson(path.join(legacy, 'registry.json'))).projects, {});
});

test('biz namespace: malformed new hook markers fail before any records are written', async () => {
  const original = '# Rules\n<!-- biz-project:start -->\nunfinished\n';
  await writeFile(path.join(project, 'AGENTS.md'), original);
  rejected(run('init', '--records-root', records));
  assert.equal(await readFile(path.join(project, 'AGENTS.md'), 'utf8'), original);
  assert.ok(!(await readdir(sandbox)).includes('central-records'));
  assert.deepEqual(await readdir(home), []);
});

test('biz namespace: mixed old and new managed blocks are rejected without changes', async () => {
  const original = '<!-- project-records:start -->\n<!-- project-records:end -->\n'
    + '<!-- biz-project:start -->\n<!-- biz-project:end -->\n';
  await writeFile(path.join(project, 'AGENTS.md'), original);
  rejected(run('init', '--records-root', records));
  assert.equal(await readFile(path.join(project, 'AGENTS.md'), 'utf8'), original);
  assert.ok(!(await readdir(sandbox)).includes('central-records'));
});

test('an explicit records root takes precedence over the environment', async () => {
  environment.BIZ_PROJECT_HOME = path.join(sandbox, 'environment-records');
  await seedCenter(environment.BIZ_PROJECT_HOME);
  const result = successful(run('init', '--records-root', records));
  assert.equal(result.records_root, records);
  assert.deepEqual((await readJson(path.join(environment.BIZ_PROJECT_HOME, 'registry.json'))).projects, {});
});

test('invalid configuration is reported instead of silently creating another center', async () => {
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, '{broken');
  rejected(run('init'));
  assert.deepEqual(await readdir(project), []);
  assert.ok(!(await readdir(home)).includes('.biz-project'));
});

test('repairing a missing hook retains reviewed profile and migration status', async () => {
  const first = successful(run('init', '--records-root', records));
  const profileFile = path.join(first.project_directory, 'project.json');
  const profile = await readJson(profileFile);
  profile.migration_status = 'complete';
  profile.development_branch = 'develop';
  await writeFile(profileFile, JSON.stringify(profile));
  const profileBytes = await readFile(profileFile);
  await writeFile(path.join(project, 'AGENTS.md'), '# restored rules\n');
  assert.equal(successful(run('inspect')).initialized, false);
  const repaired = successful(run('init'));
  assert.equal(repaired.project_id, first.project_id);
  assert.equal(repaired.migration_status, 'complete');
  assert.deepEqual(await readFile(profileFile), profileBytes);
});

test('init responds to a newly active AGENTS override without modifying base rules', async () => {
  successful(run('init', '--records-root', records));
  const original = await readFile(path.join(project, 'AGENTS.md'));
  await writeFile(path.join(project, 'AGENTS.override.md'), '# active override\n');
  assert.equal(successful(run('inspect')).initialized, false);
  successful(run('init'));
  assert.deepEqual(await readFile(path.join(project, 'AGENTS.md')), original);
  assert.ok((await readFile(path.join(project, 'AGENTS.override.md'), 'utf8')).includes('$biz-project'));
});

test('duplicate feature IDs never replace an existing feature', async () => {
  successful(run('init', '--records-root', records));
  const args = ['--title', 'Original task', '--owner', 'owner', '--feature-id', 'shared-task'];
  const feature = successful(run('create-feature', ...args));
  const before = await readFile(path.join(feature.feature_directory, 'feature.json'));
  rejected(run('create-feature', '--title', 'Replacement task', '--owner', 'other', '--feature-id', 'shared-task'));
  assert.deepEqual(await readFile(path.join(feature.feature_directory, 'feature.json')), before);
});

test('feature IDs cannot traverse out of the records directory', async () => {
  successful(run('init', '--records-root', records));
  rejected(run('create-feature', '--title', 'Task', '--owner', 'owner', '--feature-id', '../escape'));
  assert.ok(!(await readdir(sandbox)).includes('escape'));
});

test('duplicate hook markers are rejected without changing guidance', async () => {
  const original = '<!-- project-records:start -->\n<!-- project-records:end -->\n'
    + '<!-- project-records:start -->\n<!-- project-records:end -->\n';
  await writeFile(path.join(project, 'AGENTS.md'), original);
  rejected(run('init', '--records-root', records));
  assert.equal(await readFile(path.join(project, 'AGENTS.md'), 'utf8'), original);
  assert.ok(!(await readdir(sandbox)).includes('central-records'));
});

test('an interrupted profile write leaves a registration that can be resumed', async () => {
  await seedCenter(records);
  const obstruction = path.join(records, 'projects');
  await writeFile(obstruction, 'temporary obstruction');
  rejected(run('init', '--records-root', records));
  const pending = Object.keys((await readJson(path.join(records, 'registry.json'))).projects);
  assert.equal(pending.length, 1);
  await unlink(obstruction);
  const result = successful(run('init', '--records-root', records));
  assert.equal(result.project_id, pending[0]);
  assert.equal(successful(run('inspect')).initialized, true);
});

test('parallel retries of the same update publish only one complete record', async () => {
  successful(run('init', '--records-root', records));
  const feature = successful(run('create-feature', '--title', 'Retry test', '--owner', 'owner'));
  const bodyFile = path.join(sandbox, 'update.md');
  await writeFile(bodyFile, 'Same checkpoint evidence.');
  const outcomes = await Promise.all(Array.from({ length: 4 }, () =>
    runAsync('add-update', '--feature', feature.feature_id, '--agent', 'same-worker',
      '--body-file', bodyFile, '--update-id', 'one-checkpoint').then(successful)));
  assert.equal(outcomes.filter((item) => item.created).length, 1);
  assert.equal((await readdir(path.join(feature.feature_directory, 'updates'))).length, 1);
  assert.equal((await readJson(outcomes[0].update_file)).content, 'Same checkpoint evidence.');
});

test('inherited object property names are not accepted as CLI commands', () => {
  rejected(run('constructor'));
});

test('a missing project overview is detected and repaired without changing identity', async () => {
  const first = successful(run('init', '--records-root', records));
  const overview = path.join(first.project_directory, 'README.md');
  await unlink(overview);
  assert.equal(successful(run('inspect')).initialized, false);
  assert.equal(successful(run('init')).project_id, first.project_id);
  assert.ok((await readFile(overview, 'utf8')).includes('Project agreements'));
});

test('Cursor inspection selects its own entry point without writing files', async () => {
  await writeFile(path.join(project, 'AGENTS.override.md'), '# Codex only\n');
  const state = successful(run('inspect', '--host', 'cursor'));
  assert.equal(state.host, 'cursor');
  assert.equal(state.rules_file, path.join(project, '.cursor', 'rules', 'biz-project.mdc'));
  assert.equal(state.initialized, false);
  assert.deepEqual(await readdir(project), ['AGENTS.override.md']);
  assert.deepEqual(await readdir(home), []);
});

test('Cursor initialization creates an always-applied MDC entry and is retryable', async () => {
  const first = successful(run('init', '--records-root', records, '--host', 'cursor'));
  const before = await readFile(first.rules_file);
  assert.match(before.toString('utf8'), /^---\r?\nalwaysApply: true\r?\n---\r?\n/);
  assert.ok(before.toString('utf8').includes('/biz-project'));
  assert.ok(!(await readdir(project)).includes('AGENTS.md'));
  assert.equal(successful(run('inspect', '--host', 'cursor')).initialized, true);
  assert.equal(successful(run('init', '--host', 'cursor')).project_id, first.project_id);
  assert.deepEqual(await readFile(first.rules_file), before);
});

test('Codex and Cursor keep separate hooks for one project identity', async () => {
  await writeFile(path.join(project, 'AGENTS.override.md'), '# Codex agreements\n');
  const codex = successful(run('init', '--records-root', records));
  const before = await readFile(codex.rules_file);
  const profileFile = path.join(codex.project_directory, 'project.json');
  const profileBefore = await readFile(profileFile);
  const pending = successful(run('inspect', '--host', 'cursor'));
  assert.equal(pending.records_initialized, true);
  assert.equal(pending.initialized, false);
  const cursor = successful(run('init', '--host', 'cursor'));
  assert.equal(cursor.project_id, codex.project_id);
  assert.deepEqual(await readFile(codex.rules_file), before);
  assert.deepEqual(await readFile(profileFile), profileBefore);
  const registrations = (await readJson(path.join(records, 'registry.json'))).projects;
  assert.equal(Object.keys(registrations).length, 1);
  assert.equal(registrations[codex.project_id].hosts.codex.rules_file, 'AGENTS.override.md');
  assert.equal(registrations[codex.project_id].hosts.cursor.rules_file, '.cursor/rules/biz-project.mdc');
  assert.equal(successful(run('inspect')).initialized, true);
});

test('Cursor and Codex contribute to the same feature without advancing status', async () => {
  successful(run('init', '--records-root', records, '--host', 'cursor'));
  const feature = successful(run('create-feature', '--host', 'cursor',
    '--title', 'Shared workflow', '--owner', 'owner', '--feature-id', 'shared-workflow'));
  successful(run('init', '--host', 'codex'));
  const bodyFile = path.join(sandbox, 'update.md');
  await writeFile(bodyFile, 'Cursor implementation evidence.');
  const cursor = successful(run('add-update', '--host', 'cursor', '--feature', feature.feature_id,
    '--agent', 'cursor-worker', '--body-file', bodyFile, '--update-id', 'cursor-implementation'));
  await writeFile(bodyFile, 'Codex review evidence.');
  const codex = successful(run('add-update', '--host', 'codex', '--feature', feature.feature_id,
    '--agent', 'codex-reviewer', '--body-file', bodyFile, '--update-id', 'codex-review'));
  assert.equal(cursor.project_id, codex.project_id);
  assert.equal(cursor.feature_id, codex.feature_id);
  assert.equal((await readJson(cursor.update_file)).agent, 'cursor-worker');
  assert.equal((await readJson(codex.update_file)).agent, 'codex-reviewer');
  assert.equal((await readJson(path.join(feature.feature_directory, 'feature.json'))).status, 'planned');
});

test('host-specific explicit guidance selections do not replace each other', async () => {
  const codex = successful(run('init', '--records-root', records, '--rules-file', 'TEAM_GUIDE.md'));
  const cursor = successful(run('init', '--host', 'cursor', '--rules-file', 'AGENTS.md'));
  assert.equal(cursor.project_id, codex.project_id);
  assert.equal(successful(run('inspect')).rules_file, path.join(project, 'TEAM_GUIDE.md'));
  assert.equal(successful(run('inspect', '--host', 'cursor')).rules_file, path.join(project, 'AGENTS.md'));
  assert.equal(successful(run('init', '--host', 'cursor')).rules_file, cursor.rules_file);
});

test('a deliberately shared AGENTS hook stays usable by both hosts', async () => {
  const codex = successful(run('init', '--records-root', records));
  const cursor = successful(run('init', '--host', 'cursor', '--rules-file', 'AGENTS.md'));
  assert.equal(cursor.rules_file, codex.rules_file);
  const content = await readFile(codex.rules_file, 'utf8');
  assert.equal(content.split('<!-- biz-project:start -->').length - 1, 1);
  assert.equal(successful(run('inspect')).initialized, true);
  assert.equal(successful(run('inspect', '--host', 'cursor')).initialized, true);
});

test('Cursor preserves existing MDC metadata, BOM, CRLF and surrounding rules', async () => {
  const filename = path.join(project, '.cursor', 'rules', 'biz-project.mdc');
  const original = Buffer.from('\uFEFF---\r\ndescription: "Project rules"\r\nglobs: "**/*"\r\nalwaysApply: true\r\n---\r\n# Original agreements\r\n');
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, original);
  successful(run('init', '--records-root', records, '--host', 'cursor'));
  const actual = await readFile(filename);
  assert.deepEqual(actual.subarray(0, original.length), original);
  assert.ok(!actual.toString('utf8').replaceAll('\r\n', '').includes('\n'));
  assert.equal(successful(run('inspect', '--host', 'cursor')).initialized, true);
});

test('Cursor refuses inactive or ambiguous MDC metadata without changing it', async () => {
  const filename = path.join(project, '.cursor', 'rules', 'biz-project.mdc');
  await mkdir(path.dirname(filename), { recursive: true });
  for (const original of ['# no frontmatter\n', '---\nalwaysApply: false\n---\n# manual\n',
    '---\nalwaysApply: true\nalwaysApply: false\n---\n# duplicate\n']) {
    await writeFile(filename, original);
    rejected(run('init', '--records-root', records, '--host', 'cursor'));
    assert.equal(await readFile(filename, 'utf8'), original);
    assert.ok(!(await readdir(sandbox)).includes('central-records'));
  }
});

test('unsupported Cursor rule destinations are rejected before writes', async () => {
  for (const relative of ['AGENTS.override.md', '.cursor/rules/project-records.md', '../outside.mdc']) {
    rejected(run('init', '--records-root', records, '--host', 'cursor', '--rules-file', relative));
  }
  assert.deepEqual(await readdir(project), []);
  assert.ok(!(await readdir(sandbox)).includes('central-records'));
});

test('Cursor discovery does not substitute Codex global guidance for User Rules', async () => {
  const codexHome = path.join(home, '.codex');
  await mkdir(codexHome);
  await writeFile(path.join(codexHome, 'AGENTS.md'), '# global Codex guidance\n');
  const codex = successful(run('inspect'));
  const cursor = successful(run('inspect', '--host', 'cursor'));
  assert.deepEqual(codex.global_rule_files, [path.join(codexHome, 'AGENTS.md')]);
  assert.deepEqual(cursor.global_rule_files, []);
  assert.equal(cursor.global_guidance_source, 'host-context');
});

test('old registrations remain usable while new host entries are added', async () => {
  await seedCenter(records, 'biz-project');
  const first = successful(run('init', '--records-root', records, '--rules-file', 'TEAM_GUIDE.md'));
  const registryFile = path.join(records, 'registry.json');
  const registry = await readJson(registryFile);
  delete registry.projects[first.project_id].hosts;
  await writeFile(registryFile, JSON.stringify(registry));
  assert.equal(successful(run('inspect')).rules_file, path.join(project, 'TEAM_GUIDE.md'));
  successful(run('init', '--host', 'cursor'));
  assert.equal(successful(run('inspect')).initialized, true);
  assert.equal(successful(run('inspect')).rules_file, path.join(project, 'TEAM_GUIDE.md'));
});

test('unknown host names are rejected without creating a center', async () => {
  const error = rejected(run('init', '--host', 'unknown-tool'));
  assert.match(error.error, /host/i);
  assert.deepEqual(await readdir(project), []);
  assert.ok(!(await readdir(sandbox)).includes('central-records'));
});

test('generic hosts require an explicit active rule file and remember it', async () => {
  rejected(run('init', '--records-root', records, '--host', 'generic'));
  const first = successful(run('init', '--records-root', records, '--host', 'generic', '--rules-file', 'CLAUDE.md'));
  assert.equal(successful(run('inspect', '--host', 'generic')).initialized, true);
  assert.equal(successful(run('init', '--host', 'generic')).project_id, first.project_id);
});

test('invalid host registration metadata is rejected without rewriting the registry', async () => {
  const first = successful(run('init', '--records-root', records));
  const filename = path.join(records, 'registry.json');
  const registry = await readJson(filename);
  for (const hosts of [[], { cursor: { rules_file: 123, rules_selection: 'explicit' } },
    { codex: { rules_file: 'AGENTS.md', rules_selection: 'invalid' } }]) {
    registry.projects[first.project_id].hosts = hosts;
    const original = JSON.stringify(registry);
    await writeFile(filename, original);
    const error = rejected(run('init'));
    assert.match(error.error, /host/i);
    assert.equal(await readFile(filename, 'utf8'), original);
  }
});

test('a pre-rename Codex block needs refresh without automatic rewriting', async () => {
  const first = successful(run('init', '--records-root', records));
  const original = '# existing guidance\n<!-- project-records:start -->\nUse $project-records.\n'
    + `Project records ID: ${first.project_id}\n<!-- project-records:end -->\n`;
  await writeFile(first.rules_file, original);
  const state = successful(run('inspect'));
  assert.equal(state.records_initialized, true);
  assert.equal(state.initialized, false);
  assert.equal(await readFile(first.rules_file, 'utf8'), original);
  assert.equal(successful(run('inspect', '--host', 'cursor')).initialized, false);
});

test('inactive Cursor metadata blocks updates even when the managed hook is intact', async () => {
  const first = successful(run('init', '--records-root', records, '--host', 'cursor'));
  const feature = successful(run('create-feature', '--host', 'cursor', '--title', 'Review', '--owner', 'owner'));
  const content = await readFile(first.rules_file, 'utf8');
  await writeFile(first.rules_file, content.replace('alwaysApply: true', 'alwaysApply: false'));
  const state = successful(run('inspect', '--host', 'cursor'));
  assert.equal(state.records_initialized, true);
  assert.equal(state.initialized, false);
  assert.ok(state.rules_error);
  const bodyFile = path.join(sandbox, 'update.md');
  await writeFile(bodyFile, 'Evidence');
  rejected(run('add-update', '--host', 'cursor', '--feature', feature.feature_id,
    '--agent', 'worker', '--body-file', bodyFile));
  assert.deepEqual(await readdir(path.join(feature.feature_directory, 'updates')), []);
});

test('Cursor does not mistake malformed YAML scalars for active metadata', async () => {
  const filename = path.join(project, '.cursor', 'rules', 'biz-project.mdc');
  await mkdir(path.dirname(filename), { recursive: true });
  for (const metadata of ['alwaysApply: true#not-a-comment', 'alwaysApply:true',
    'description: broken: value\nalwaysApply: true']) {
    const original = `---\n${metadata}\n---\n# Original rules\n`;
    await writeFile(filename, original);
    assert.ok(successful(run('inspect', '--host', 'cursor')).rules_error);
    rejected(run('init', '--records-root', records, '--host', 'cursor'));
    assert.equal(await readFile(filename, 'utf8'), original);
    assert.ok(!(await readdir(sandbox)).includes('central-records'));
  }
});

test('the renamed skill exposes biz-project invocations for both tools', () => {
  assert.equal(successful(run('inspect')).invocation, '$biz-project');
  const cursor = successful(run('inspect', '--host', 'cursor'));
  assert.equal(cursor.invocation, '/biz-project');
  assert.equal(cursor.rules_file, path.join(project, '.cursor', 'rules', 'biz-project.mdc'));
  assert.match(run('--help').stdout, /^biz-project \(Node\.js 20\+\)/);
});

test('renaming refreshes old Codex invocation guidance without changing records', async () => {
  const first = successful(run('init', '--records-root', records));
  const feature = successful(run('create-feature', '--title', 'Existing work', '--owner', 'owner'));
  const profileFile = path.join(first.project_directory, 'project.json');
  const featureFile = path.join(feature.feature_directory, 'feature.json');
  const profileBefore = await readFile(profileFile);
  const featureBefore = await readFile(featureFile);
  const original = '# Existing agreements\n<!-- project-records:start -->\nUse $project-records.\n'
    + `Project records ID: ${first.project_id}\n<!-- project-records:end -->\n# Keep this suffix\n`;
  await writeFile(first.rules_file, original);
  const state = successful(run('inspect'));
  assert.equal(state.records_initialized, true);
  assert.equal(state.initialized, false);
  const refreshed = successful(run('init'));
  assert.equal(refreshed.project_id, first.project_id);
  const guidance = await readFile(first.rules_file, 'utf8');
  assert.ok(guidance.includes('$biz-project'));
  assert.ok(!guidance.includes('$project-records'));
  assert.ok(guidance.startsWith('# Existing agreements\n'));
  assert.ok(guidance.endsWith('# Keep this suffix\n'));
  assert.equal(guidance.split('<!-- biz-project:start -->').length - 1, 1);
  assert.ok(!guidance.includes('<!-- project-records:start -->'));
  assert.deepEqual(await readFile(profileFile), profileBefore);
  assert.deepEqual(await readFile(featureFile), featureBefore);
  assert.equal((await readJson(path.join(records, 'registry.json'))).kind, 'biz-project');
});

test('renaming refreshes an already registered Cursor rule in place', async () => {
  await seedCenter(records, 'biz-project');
  const first = successful(run('init', '--records-root', records, '--host', 'cursor'));
  const legacyFile = path.join(project, '.cursor', 'rules', 'project-records.mdc');
  const original = '---\nalwaysApply: true\n---\n# Keep original rules\n'
    + '<!-- project-records:start -->\nUse /project-records.\n'
    + `Project records ID: ${first.project_id}\n<!-- project-records:end -->\n`;
  await writeFile(legacyFile, original);
  const registryFile = path.join(records, 'registry.json');
  const registry = await readJson(registryFile);
  registry.projects[first.project_id].hosts.cursor = {
    rules_file: '.cursor/rules/project-records.mdc', rules_selection: 'default'
  };
  await writeFile(registryFile, JSON.stringify(registry));
  if (first.rules_file !== legacyFile) await unlink(first.rules_file);
  const state = successful(run('inspect', '--host', 'cursor'));
  assert.equal(state.rules_file, legacyFile);
  assert.equal(state.records_initialized, true);
  assert.equal(state.initialized, false);
  const refreshed = successful(run('init', '--host', 'cursor'));
  assert.equal(refreshed.project_id, first.project_id);
  assert.equal(refreshed.rules_file, legacyFile);
  assert.ok((await readFile(legacyFile, 'utf8')).includes('/biz-project'));
  assert.equal(successful(run('inspect', '--host', 'cursor')).initialized, true);
  assert.deepEqual(await readdir(path.dirname(legacyFile)), ['project-records.mdc']);
});
