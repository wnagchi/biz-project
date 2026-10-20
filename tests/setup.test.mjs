import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleUrl = pathToFileURL(path.join(source, 'scripts/lib/setup.mjs')).href;
const wizard = path.join(source, 'scripts/setup.mjs');
let sandbox, home, project, otherProject, records, config, options, environment;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-setup-test-'));
  home = path.join(sandbox, 'home');
  project = path.join(sandbox, 'project with spaces');
  otherProject = path.join(sandbox, 'second-project');
  records = path.join(sandbox, 'records');
  config = path.join(home, '.config/biz-project/config.json');
  [home, project, otherProject].forEach(p => fs.mkdirSync(p));
  environment = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of ['BIZ_PROJECT_HOME', 'PROJECT_RECORDS_HOME', 'CODEX_HOME']) delete environment[key];
  options = { projects: [project, otherProject], hosts: ['codex', 'cursor'],
    recordsRoot: records, configFile: config };
});

afterEach(() => {
  assert.equal(path.dirname(sandbox), os.tmpdir());
  assert.ok(path.basename(sandbox).startsWith('biz-project-setup-test-'));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function tree(directory) {
  if (!fs.existsSync(directory)) return null;
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name => {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename);
    return [name, stat.isSymbolicLink() ? { link: fs.readlinkSync(filename) }
      : stat.isDirectory() ? tree(filename) : fs.readFileSync(filename).toString('base64')];
  }));
}

function core(body, selected = options) {
  const script = `import { prepareSetup, applySetup } from ${JSON.stringify(moduleUrl)};
    import { setParticipation } from ${JSON.stringify(pathToFileURL(path.join(source, 'scripts/lib/projects.mjs')).href)};
    import fs from 'node:fs';
    const options = JSON.parse(process.env.SETUP_OPTIONS);
    try { const result = (() => { ${body} })();
      console.log(JSON.stringify(result));
    } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...environment, SETUP_OPTIONS: JSON.stringify(selected) }, encoding: 'utf8', timeout: 20000
  });
}

function success(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function failure(result) {
  assert.notEqual(result.status, 0);
  return result.stderr;
}

function install(selected = options) {
  return success(core('return applySetup(prepareSetup(options), { confirmed: true, recordsRootConfirmed: true });', selected));
}

function runWizard(input, args = []) {
  return spawnSync(process.execPath, [wizard, '--config', config, ...args], {
    env: environment, input, encoding: 'utf8', timeout: 20000
  });
}

test('setup preview never creates a center, pointer, installation or hook', () => {
  const before = tree(sandbox);
  const plan = success(core('return prepareSetup(options);'));
  assert.equal(plan.installation.action, 'link');
  assert.equal(plan.items.length, 4);
  assert.ok(plan.items.every(item => item.action === 'initialize'));
  assert.deepEqual(tree(sandbox), before);
});

test('declined projects remain blocked in previews and approved batches without disturbing other projects', () => {
  success(core("return setParticipation({ project: options.projects[0], config: options.configFile, decision: 'no' });"));
  const before = tree(sandbox);
  const plan = success(core('return prepareSetup(options);'));
  assert.ok(plan.items.filter(item => item.project === project).every(item => item.action === 'blocked' && item.participation === 'declined'));
  assert.deepEqual(tree(sandbox), before);
  const result = install();
  assert.equal(result.ok, false);
  assert.ok(result.items.filter(item => item.project === project).every(item => item.status === 'failed'));
  assert.deepEqual(fs.readdirSync(project), []);
  const registry = JSON.parse(fs.readFileSync(path.join(records, 'registry.json')));
  assert.equal(Object.keys(registry.projects).length, 1);
  assert.equal(Object.values(registry.projects)[0].paths[0], otherProject);
});

test('a refusal after preview invalidates the approved plan before installation writes', () => {
  const result = success(core(`const plan = prepareSetup(options);
    setParticipation({ project: options.projects[0], config: options.configFile, decision: 'no' });
    try { applySetup(plan, { confirmed: true, recordsRootConfirmed: true }); return { unexpected: true }; }
    catch (error) { return { error: error.message }; }`));
  assert.match(result.error, /changed after the preview/i);
  assert.equal(fs.existsSync(records), false); assert.equal(fs.existsSync(config), false);
  assert.equal(fs.existsSync(path.join(home, '.agents')), false);
  assert.deepEqual(fs.readdirSync(project), []); assert.deepEqual(fs.readdirSync(otherProject), []);
});

test('setup requires both final approval and records-root confirmation before writing', () => {
  const before = tree(sandbox);
  for (const approval of ['{}', '{ confirmed: true }', '{ recordsRootConfirmed: true }']) {
    failure(core(`return applySetup(prepareSetup(options), ${approval});`));
    assert.deepEqual(tree(sandbox), before);
  }
});

test('one setup installs one shared skill and registers two tools per project', () => {
  const original = Buffer.from('\uFEFF# Original guidance\r\nKeep local docs.\r\n');
  fs.writeFileSync(path.join(project, 'AGENTS.md'), original);
  const result = install();
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 4);
  const registry = JSON.parse(fs.readFileSync(path.join(records, 'registry.json')));
  assert.equal(Object.keys(registry.projects).length, 2);
  for (const registration of Object.values(registry.projects)) {
    assert.deepEqual(Object.keys(registration.hosts).sort(), ['codex', 'cursor']);
  }
  for (const directory of [project, otherProject]) {
    const codex = result.items.find(item => item.project === directory && item.host === 'codex');
    const cursor = result.items.find(item => item.project === directory && item.host === 'cursor');
    assert.equal(codex.project_id, cursor.project_id);
    assert.ok(fs.readFileSync(path.join(directory, '.cursor/rules/biz-project.mdc'), 'utf8').includes('alwaysApply: true'));
  }
  assert.deepEqual(fs.readFileSync(path.join(project, 'AGENTS.md')).subarray(0, original.length), original);
  assert.equal(fs.realpathSync(path.join(home, '.agents/skills/biz-project')), fs.realpathSync(source));
  assert.equal(JSON.parse(fs.readFileSync(config)).records_root, records);
});

test('repeated setup preserves complete records and installation without new IDs', () => {
  install();
  const before = tree(sandbox);
  const result = install();
  assert.equal(result.ok, true);
  assert.equal(result.installation.status, 'skipped');
  assert.ok(result.items.every(item => item.status === 'skipped'));
  assert.deepEqual(tree(sandbox), before);
});

test('setup deduplicates the same project path and host instead of multiplying entries', () => {
  const result = install({ ...options, projects: [project, project], hosts: ['cursor', 'codex', 'cursor'] });
  assert.equal(result.items.length, 2);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(records, 'registry.json'))).projects).length, 1);
});

test('a foreign existing skill installation is never overwritten', () => {
  const target = path.join(home, '.agents/skills/biz-project');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'keep.txt'), 'foreign installation');
  const before = tree(sandbox);
  failure(core('return prepareSetup(options);'));
  assert.deepEqual(tree(sandbox), before);
});

test('nonempty unrelated centers and mismatched saved pointers fail before global installation', () => {
  fs.mkdirSync(records);
  fs.writeFileSync(path.join(records, 'keep.txt'), 'not a records center');
  const first = tree(sandbox);
  failure(core('return prepareSetup(options);'));
  assert.deepEqual(tree(sandbox), first);
  const differentRoot = path.join(sandbox, 'different-center');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ schema_version: 1, records_root: differentRoot }));
  const second = tree(sandbox);
  failure(core('return prepareSetup({ ...options, recordsRoot: differentRoot + "-new" });'));
  assert.deepEqual(tree(sandbox), second);
});

test('missing explicit records path is not replaced with a default center', () => {
  const before = tree(sandbox);
  failure(core('return prepareSetup({ ...options, recordsRoot: undefined });'));
  assert.deepEqual(tree(sandbox), before);
});

test('changed guidance after preview requires a new preview before any installation', () => {
  const result = core(`const plan = prepareSetup(options);
    fs.writeFileSync(options.projects[0] + '/AGENTS.md', '# Added after preview\\n');
    return applySetup(plan, { confirmed: true, recordsRootConfirmed: true });`);
  failure(result);
  assert.equal(fs.existsSync(path.join(home, '.agents')), false);
  assert.equal(fs.existsSync(records), false);
  assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), '# Added after preview\n');
});

test('an inactive Cursor hook is reported separately while approved Codex entries proceed', () => {
  const filename = path.join(project, '.cursor/rules/biz-project.mdc');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const original = '---\nalwaysApply: false\n---\nManual rule\n';
  fs.writeFileSync(filename, original);
  const result = install();
  assert.equal(result.ok, false);
  assert.equal(result.items.find(item => item.project === project && item.host === 'cursor').status, 'failed');
  assert.equal(result.items.find(item => item.project === project && item.host === 'codex').status, 'initialized');
  assert.equal(fs.readFileSync(filename, 'utf8'), original);
});

test('installer leaves reviewed profiles, features and legacy notes unchanged', () => {
  install({ ...options, projects: [project], hosts: ['codex'] });
  const registry = JSON.parse(fs.readFileSync(path.join(records, 'registry.json')));
  const id = Object.keys(registry.projects)[0];
  const profileFile = path.join(records, 'projects', id, 'project.json');
  const profile = { ...JSON.parse(fs.readFileSync(profileFile)), development_branch: 'fixture-dev', extra: { keep: true } };
  fs.writeFileSync(profileFile, JSON.stringify(profile));
  const notes = path.join(project, 'unpublished-docs');
  fs.mkdirSync(notes);
  fs.writeFileSync(path.join(notes, 'history.md'), '# Original history\n');
  const feature = path.join(records, 'projects', id, 'features/existing/README.md');
  fs.mkdirSync(path.dirname(feature), { recursive: true });
  fs.writeFileSync(feature, '# Existing feature\n');
  install({ ...options, projects: [project] });
  assert.deepEqual(JSON.parse(fs.readFileSync(profileFile)), profile);
  assert.equal(fs.readFileSync(path.join(notes, 'history.md'), 'utf8'), '# Original history\n');
  assert.equal(fs.readFileSync(feature, 'utf8'), '# Existing feature\n');
});

test('a records lock causes an accurate failure report and is never removed', () => {
  install();
  fs.unlinkSync(path.join(project, 'AGENTS.md'));
  const lock = path.join(records, '.write.lock');
  fs.writeFileSync(lock, 'another process');
  const result = install();
  assert.equal(result.ok, false);
  assert.equal(result.items.find(item => item.project === project && item.host === 'codex').status, 'failed');
  assert.equal(fs.readFileSync(lock, 'utf8'), 'another process');
  assert.equal(fs.existsSync(path.join(project, 'AGENTS.md')), false);
});

test('wizard cancellation and end of input leave all directories unchanged', () => {
  const before = tree(sandbox);
  const input = ['3', project, '', records, 'no', ''].join('\n');
  assert.equal(runWizard(input).status, 0);
  assert.deepEqual(tree(sandbox), before);
  assert.equal(runWizard('').status, 0);
  assert.deepEqual(tree(sandbox), before);
});

test('wizard confirms an explicitly entered center and installs all selected projects', () => {
  const input = ['3', project, otherProject, '', records, 'INSTALL', ''].join('\n');
  const result = runWizard(input);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(records, 'registry.json'))).projects).length, 2);
  assert.equal(fs.realpathSync(path.join(home, '.agents/skills/biz-project')), fs.realpathSync(source));
});

test('wizard can reuse an established center without recreating records', () => {
  install();
  const before = tree(sandbox);
  const input = ['3', project, otherProject, '', '', 'INSTALL', ''].join('\n');
  const result = runWizard(input);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(tree(sandbox), before);
});

test('wizard reports partial failures with a nonzero process exit code', () => {
  const filename = path.join(project, '.cursor/rules/biz-project.mdc');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, '---\nalwaysApply: false\n---\nkeep\n');
  const input = ['3', project, '', records, 'INSTALL', ''].join('\n');
  const result = runWizard(input);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(project, 'AGENTS.md')));
  assert.equal(fs.readFileSync(filename, 'utf8'), '---\nalwaysApply: false\n---\nkeep\n');
});

test('wizard help and the Windows launcher help run without installation', () => {
  const before = tree(sandbox);
  const help = runWizard('', ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.length > 0);
  if (process.platform === 'win32') {
    const linked = path.join(sandbox, 'launcher folder & spaces');
    fs.symlinkSync(source, linked, 'junction');
    const launcher = path.join(linked, 'install-terminal.cmd');
    const launched = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${launcher}" --help"`], {
      windowsVerbatimArguments: true, env: environment, cwd: home, input: '', encoding: 'utf8', timeout: 15000
    });
    assert.equal(launched.status, 0, launched.stderr + launched.stdout);
    assert.ok(launched.stdout.length > 0);
    fs.unlinkSync(linked);
  }
  assert.deepEqual(tree(sandbox), before);
});

test('retry after a partial failure reuses the identity and leaves completed entries untouched', () => {
  const filename = path.join(project, '.cursor/rules/biz-project.mdc');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, '---\nalwaysApply: false\n---\nKeep this text\n');
  const first = install({ ...options, projects: [project] });
  assert.equal(first.ok, false);
  const id = first.items.find(item => item.host === 'codex').project_id;
  const originalCodex = fs.readFileSync(path.join(project, 'AGENTS.md'));
  fs.writeFileSync(filename, '---\nalwaysApply: true\n---\nKeep this text\n');
  const retry = install({ ...options, projects: [project] });
  assert.equal(retry.ok, true);
  assert.equal(retry.items.find(item => item.host === 'codex').status, 'skipped');
  assert.equal(retry.items.find(item => item.host === 'cursor').project_id, id);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(records, 'registry.json'))).projects).length, 1);
  assert.deepEqual(fs.readFileSync(path.join(project, 'AGENTS.md')), originalCodex);
  assert.ok(fs.readFileSync(filename, 'utf8').includes('Keep this text\n'));
});

test('an entirely blocked plan fails without creating a shared installation', () => {
  const filename = path.join(project, '.cursor/rules/biz-project.mdc');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, '---\nalwaysApply: false\n---\nKeep\n');
  const before = tree(sandbox);
  failure(core('return applySetup(prepareSetup(options), { confirmed: true, recordsRootConfirmed: true });', {
    ...options, projects: [project], hosts: ['cursor']
  }));
  assert.deepEqual(tree(sandbox), before);
});

test('a center inside a managed project is rejected before any writes', () => {
  const before = tree(sandbox);
  failure(core('return prepareSetup(options);', { ...options, recordsRoot: path.join(project, 'records') }));
  assert.deepEqual(tree(sandbox), before);
});

test('end of input after preview does not approve any installation', () => {
  const before = tree(sandbox);
  const result = runWizard(['3', project, '', records, ''].join('\n'));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(tree(sandbox), before);
});

test('no existing center and a blank center choice never use a fallback', () => {
  const before = tree(sandbox);
  const result = runWizard(['3', project, '', '', ''].join('\n'));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(tree(sandbox), before);
});

test('a center must not contain the config pointer or shared installation', () => {
  const before = tree(sandbox);
  failure(core('return prepareSetup(options);', { ...options, recordsRoot: path.join(home, '.config') }));
  failure(core('return prepareSetup(options);', { ...options, recordsRoot: path.join(home, '.agents') }));
  assert.deepEqual(tree(sandbox), before);
});

test('wizard can process valid projects even when the first project has invalid guidance', () => {
  const original = '<!-- biz-project:start -->\nUnfinished rule\n';
  fs.writeFileSync(path.join(project, 'AGENTS.md'), original);
  const input = ['1', project, otherProject, '', records, 'INSTALL', ''].join('\n');
  const result = runWizard(input);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(fs.existsSync(path.join(otherProject, 'AGENTS.md')));
  assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), original);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(records, 'registry.json'))).projects).length, 1);
});

test('setup registers a new worktree path even when its rule is copied from the same project', () => {
  const git = (...args) => {
    const result = spawnSync('git', args, { env: environment, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-b', 'fixture-dev', project);
  git('-C', project, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-m', 'fixture');
  const first = install({ ...options, projects: [project], hosts: ['codex'] });
  const linked = path.join(sandbox, 'linked-worktree');
  git('-C', project, 'worktree', 'add', '--detach', linked, 'HEAD');
  fs.copyFileSync(path.join(project, 'AGENTS.md'), path.join(linked, 'AGENTS.md'));
  const second = install({ ...options, projects: [linked], hosts: ['codex'] });
  assert.equal(second.ok, true);
  const registry = JSON.parse(fs.readFileSync(path.join(records, 'registry.json')));
  assert.equal(Object.keys(registry.projects).length, 1);
  assert.equal(second.items[0].project_id, first.items[0].project_id);
  assert.ok(registry.projects[first.items[0].project_id].paths.includes(linked));
});

test('a missing center passed as a candidate still requires directory selection', () => {
  const before = tree(sandbox);
  const input = ['1', project, '', '', ''].join('\n');
  const result = runWizard(input, ['--records-root', records]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('请明确填写记录中心路径'));
  assert.deepEqual(tree(sandbox), before);
});

test('Windows launcher runs full setup and preserves partial-failure exit codes', { skip: process.platform !== 'win32' }, () => {
  const linked = path.join(sandbox, 'launcher folder & spaces');
  fs.symlinkSync(source, linked, 'junction');
  const launch = input => spawnSync(process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', `""${path.join(linked, 'install-terminal.cmd')}""`], {
      windowsVerbatimArguments: true, env: environment, cwd: home, input, encoding: 'utf8', timeout: 20000
    });
  const first = launch(['1', project, '', records, 'INSTALL', ''].join('\n'));
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.ok(fs.existsSync(path.join(project, 'AGENTS.md')));
  assert.equal(fs.realpathSync(path.join(home, '.agents/skills/biz-project')), fs.realpathSync(source));
  const cursorFile = path.join(project, '.cursor/rules/biz-project.mdc');
  fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
  fs.writeFileSync(cursorFile, '---\nalwaysApply: false\n---\nKeep\n');
  const second = launch(['3', project, '', '', 'INSTALL', ''].join('\n'));
  assert.equal(second.status, 1, second.stderr + second.stdout);
  assert.equal(fs.readFileSync(cursorFile, 'utf8'), '---\nalwaysApply: false\n---\nKeep\n');
});
