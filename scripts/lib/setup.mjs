import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectProject, initializeProject } from './projects.mjs';
import { assertDataRoot, canonical, fail, homeDirectory, isInside, loadRegistry,
  readJson, sourceDirectory } from './storage.mjs';

function statOrNull(filename) {
  try { return fs.lstatSync(filename); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function snapshot(filename) {
  const stat = statOrNull(filename);
  if (!stat) return { path: filename, kind: 'missing', resolved: canonical(filename) };
  if (stat.isSymbolicLink()) {
    return { path: filename, kind: 'link', target: fs.readlinkSync(filename), resolved: canonical(filename) };
  }
  if (stat.isDirectory()) {
    return { path: filename, kind: 'directory', resolved: canonical(filename),
      entries: fs.readdirSync(filename).sort() };
  }
  if (!stat.isFile()) fail(`Unsupported filesystem entry: ${filename}`);
  return { path: filename, kind: 'file', resolved: canonical(filename), hash: digest(fs.readFileSync(filename)) };
}

function projectOptions(options, project, host) {
  return { project, host, config: options.configFile, 'records-root': options.recordsRoot };
}

function registered(state) {
  const hook = state.registration?.hosts?.[state.host]
    ?? (state.host === 'codex' ? state.registration : null);
  return Boolean(hook?.rules_file && canonical(path.resolve(state.project_root, hook.rules_file)) === state.rules_file);
}

function ready(state) {
  return state.initialized && registered(state)
    && state.registration.paths.includes(state.project_root) && fs.existsSync(state.config_file);
}

export function prepareSetup(input) {
  if (typeof input.recordsRoot !== 'string' || !input.recordsRoot.trim()) {
    fail('An explicitly selected recordsRoot is required. No default center will be created.');
  }
  if (!Array.isArray(input.projects) || !input.projects.length
    || input.projects.some(p => typeof p !== 'string' || !p.trim())) fail('Select at least one project directory.');
  if (!Array.isArray(input.hosts) || !input.hosts.length
    || input.hosts.some(h => !['codex', 'cursor'].includes(h))) fail('Select codex, cursor or both.');

  const options = {
    projects: [...new Set(input.projects.map(p => canonical(p)))],
    hosts: [...new Set(input.hosts)], recordsRoot: canonical(input.recordsRoot),
    configFile: canonical(input.configFile ?? path.join(homeDirectory, '.config/biz-project/config.json')),
    skillsDirectory: path.resolve(input.skillsDirectory ?? path.join(homeDirectory, '.agents/skills'))
  };
  if (input.projectHosts !== undefined) {
    if (!input.projectHosts || typeof input.projectHosts !== 'object' || Array.isArray(input.projectHosts)) {
      fail('projectHosts must map selected project directories to tool selections.');
    }
    options.projectHosts = Object.create(null);
    for (const [project, hosts] of Object.entries(input.projectHosts)) {
      const root = canonical(project);
      if (!options.projects.includes(root) || !Array.isArray(hosts) || !hosts.length
        || hosts.some(host => !options.hosts.includes(host))) fail('Invalid per-project tool selection.');
      options.projectHosts[root] = [...new Set(hosts)];
    }
  }
  const root = options.recordsRoot;
  if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) fail(`Records root must be a directory: ${root}`);
  const registry = loadRegistry(root);
  if (fs.existsSync(root) && !registry && fs.readdirSync(root).length) {
    fail('Selected directory is nonempty and is not a recognized records center.');
  }
  if (fs.existsSync(options.configFile)) {
    const config = readJson(options.configFile);
    if (config.schema_version !== 1 || typeof config.records_root !== 'string' || !config.records_root.trim()) {
      fail(`Invalid configuration: ${options.configFile}`);
    }
    if (canonical(config.records_root) !== root) {
      fail('Selected root differs from the saved config. Use a separate --config; the existing pointer will not be replaced.');
    }
  }
  for (const project of options.projects) assertDataRoot(root, project);

  const source = canonical(sourceDirectory);
  for (const filename of ['SKILL.md', 'scripts/biz-project.mjs']) {
    if (!fs.statSync(path.join(source, filename)).isFile()) fail(`Incomplete skill source: ${filename}`);
  }
  // Keep the link pathname; canonicalizing it would replace it with the source path.
  const target = path.join(options.skillsDirectory, 'biz-project');
  if (isInside(root, options.configFile) || isInside(root, target)) {
    fail('Keep the records center separate from the configuration pointer and shared skill installation.');
  }
  const targetStat = statOrNull(target);
  if (targetStat && (!fs.existsSync(target) || canonical(target) !== source)) {
    fail(`Another skill already occupies ${target}. It will not be replaced.`);
  }
  const installation = { source, target, action: targetStat ? 'skip' : 'link' };
  const watched = new Set([root, path.join(root, 'registry.json'), options.configFile, target,
    ...['SKILL.md', 'package.json', 'install.cmd', 'install-terminal.cmd', 'scripts/setup.mjs',
      'scripts/setup-web.mjs', 'scripts/biz-project.mjs', 'scripts/lib/setup-web.mjs',
      'scripts/lib/setup.mjs', 'scripts/lib/projects.mjs', 'scripts/lib/participation.mjs', 'scripts/lib/storage.mjs',
      'scripts/lib/records-history.mjs', 'scripts/lib/history-files.mjs',
      'web/index.html', 'web/app.js', 'web/styles.css', 'web/icons.svg']
      .map(p => path.join(source, p))]);
  const items = [], seen = new Set();
  for (const project of options.projects) {
    for (const host of options.projectHosts?.[project] ?? options.hosts) {
      try {
        const state = inspectProject(projectOptions(options, project, host));
        watched.add(state.participation.preferences_file);
        if (state.skip_recording) {
          items.push({ project: state.project_root, host, action: 'blocked', participation: 'declined',
            error: 'This project declined recording. Only an explicit request to join and set-participation --decision yes can restore it.' });
          continue;
        }
        assertDataRoot(root, state.project_root);
        const key = JSON.stringify([state.project_root, host]);
        if (seen.has(key)) continue;
        seen.add(key);
        watched.add(state.project_root);
        watched.add(path.join(state.project_root, 'AGENTS.override.md'));
        watched.add(state.rules_file);
        for (const filename of [...state.existing_rule_files, ...state.global_rule_files]) watched.add(filename);
        if (state.project_directory) {
          watched.add(path.join(state.project_directory, 'project.json'));
          watched.add(path.join(state.project_directory, 'README.md'));
        }
        items.push({ project: state.project_root, host, rules_file: state.rules_file,
          project_id: state.project_id, project_directory: state.project_directory,
          action: state.rules_error ? 'blocked' : ready(state) ? 'skip' : 'initialize',
          error: state.rules_error, legacy_record_directories: state.legacy_record_directories });
      } catch (error) {
        items.push({ project, host, action: 'blocked', error: error.message });
      }
    }
  }
  const plan = { options, installation, records_root: root, config_file: options.configFile,
    registry_file: path.join(root, 'registry.json'), items,
    snapshots: [...watched].sort().map(snapshot) };
  return plan;
}

export function applySetup(plan, approvals = {}) {
  if (approvals.confirmed !== true || approvals.recordsRootConfirmed !== true) {
    fail('Confirm the selected records root and the final change preview before installation. No files changed.');
  }
  const current = prepareSetup(plan.options);
  if (JSON.stringify(current) !== JSON.stringify(plan)) {
    fail('Setup inputs or files changed after the preview. Review a fresh preview before installation. No files changed.');
  }
  if (!current.items.some(item => item.action !== 'blocked')) {
    fail('No project entry can proceed. Resolve the reported errors before installation. No files changed.');
  }

  let installation;
  try {
    if (current.installation.action === 'link') {
      fs.mkdirSync(path.dirname(current.installation.target), { recursive: true });
      fs.symlinkSync(current.installation.source, current.installation.target,
        process.platform === 'win32' ? 'junction' : 'dir');
    }
    installation = { ...current.installation,
      status: current.installation.action === 'link' ? 'installed' : 'skipped' };
  } catch (error) {
    return { ok: false, installation: { ...current.installation, status: 'failed', error: error.message },
      items: current.items.map(item => ({ ...item, status: 'failed', error: item.error ?? 'Skill installation failed; project not changed.' })) };
  }

  const items = current.items.map(item => {
    if (item.action === 'blocked') return { ...item, status: 'failed' };
    const options = projectOptions(current.options, item.project, item.host);
    try {
      // Earlier entries may have created this project's shared identity and pointer.
      const state = inspectProject(options);
      if (ready(state)) return { ...item, project_id: state.project_id, status: 'skipped' };
      const result = initializeProject({ ...options, 'join-confirmed': true });
      if (!ready(inspectProject(options))) fail('Initialization is incomplete; inspect and retry this entry.');
      return { ...item, ...result, status: 'initialized' };
    } catch (error) {
      return { ...item, status: 'failed', error: error.message };
    }
  });
  return { ok: items.every(item => item.status !== 'failed'), installation, items };
}
