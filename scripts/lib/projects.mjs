import fs from 'node:fs';
import { historyStatus } from './records-history.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { atomicWrite, assertDataRoot, canonical, contained, fail, homeDirectory,
  jsonText, loadRegistry, readJson, sourceDirectory, withLock } from './storage.mjs';
import { participation, saveParticipation } from './participation.mjs';
import { connectionProfile, publishConnection } from './service-connection.mjs';

const hookStart = '<!-- biz-project:start -->';
const hookEnd = '<!-- biz-project:end -->';
const legacyHookStart = '<!-- project-records:start -->';
const legacyHookEnd = '<!-- project-records:end -->';
const rulesNames = ['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md',
  '.cursorrules', '.github/copilot-instructions.md'];

function gitRead(project, args) {
  const result = spawnSync('git', ['-C', project, ...args], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function identifyProject(directory) {
  const requested = canonical(directory);
  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) fail(`Project does not exist: ${requested}`);
  const gitRoot = gitRead(requested, ['rev-parse', '--show-toplevel']);
  const root = gitRoot ? canonical(gitRoot) : requested;
  const common = gitRoot ? gitRead(root, ['rev-parse', '--git-common-dir']) : null;
  if (gitRoot && !common) fail('Cannot identify the shared Git directory.');
  let identity = common ? `git:${canonical(path.resolve(root, common))}` : `directory:${root}`;
  if (process.platform === 'win32') identity = identity.toLowerCase();
  return { root, identity, git: Boolean(gitRoot) };
}

function configPath(options) {
  return canonical(options.config ?? path.join(homeDirectory, '.config', 'biz-project', 'config.json'));
}

function discoverRoot(options, config) {
  const filename = configPath(options);
  const chosen = options['records-root'] ?? process.env.BIZ_PROJECT_HOME ?? config?.records_root;
  if (chosen !== undefined) {
    if (typeof chosen !== 'string' || !chosen.trim()) fail('The records root must be a nonempty path.');
    return { root: canonical(chosen), source: options['records-root'] ? 'argument'
      : process.env.BIZ_PROJECT_HOME ? 'environment' : 'config', config_file: filename };
  }
  const candidates = ['.biz-project', 'biz-project'].map((name) => path.join(homeDirectory, name));
  const discovered = [...new Set(candidates.filter((candidate) => fs.existsSync(path.join(candidate, 'registry.json')))
    .map((candidate) => { loadRegistry(candidate); return canonical(candidate); }))];
  if (discovered.length > 1) fail(`Multiple records centers found. Select --records-root explicitly: ${discovered.join(', ')}`);
  return { root: discovered[0] ?? null, source: discovered.length ? 'discovered' : null, config_file: filename };
}

function legacyCenters() {
  const candidates = ['.project-records', 'project-records'].map((name) => ({
    records_root: path.join(homeDirectory, name), source: 'legacy-directory'
  }));
  if (process.env.PROJECT_RECORDS_HOME) candidates.push({
    records_root: process.env.PROJECT_RECORDS_HOME, source: 'legacy-environment'
  });
  const filename = path.join(homeDirectory, '.config', 'project-records', 'config.json');
  if (fs.existsSync(filename)) {
    const config = readJson(filename);
    if (config.schema_version !== 1 || typeof config.records_root !== 'string' || !config.records_root.trim()) {
      fail(`Invalid legacy configuration; original file preserved: ${filename}`);
    }
    candidates.push({ records_root: config.records_root, source: 'legacy-config', config_file: filename });
  }
  const found = new Map();
  for (const candidate of candidates) {
    const root = canonical(candidate.records_root);
    const registry = loadRegistry(root);
    if (registry) found.set(root, { ...candidate, records_root: root, kind: registry.kind });
  }
  return [...found.values()];
}

function knownRules(directory) {
  const files = rulesNames.map((name) => path.join(directory, name)).filter(fs.existsSync);
  for (const relative of ['.cursor/rules', '.claude/rules']) {
    const folder = path.join(directory, relative);
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      files.push(...fs.readdirSync(folder).filter((name) => /\.(md|mdc)$/.test(name))
        .sort().map((name) => path.join(folder, name)));
    }
  }
  return files;
}

function stripMarked(content, start, end) {
  const opening = content.indexOf(start), closing = content.indexOf(end);
  if (opening === -1 && closing === -1) return content;
  if (opening === -1 || closing < opening || content.indexOf(start, opening + start.length) !== -1
    || content.indexOf(end, closing + end.length) !== -1) fail('标记损坏或重复，原文件未修改。');
  return content.slice(0, opening) + content.slice(closing + end.length);
}
export function stripInvocation(content) { return stripMarked(content, hookStart, hookEnd); }
export function stripDevelopmentRules(content) {
  return stripMarked(content, '<!-- biz-project:rules:start -->', '<!-- biz-project:rules:end -->');
}
function hookBounds(content) {
  let bounds = null;
  for (const [start, end] of [[hookStart, hookEnd], [legacyHookStart, legacyHookEnd]]) {
    const starts = content.split(start).length - 1;
    const ends = content.split(end).length - 1;
    if (starts !== ends || starts > 1 || (starts && content.indexOf(end) < content.indexOf(start))
      || (starts && bounds)) fail('Malformed or mixed biz-project invocation blocks; original file preserved.');
    if (starts) bounds = { start: content.indexOf(start), end: content.indexOf(end) + end.length };
  }
  return bounds;
}

function guidanceText(filename) {
  if (!fs.existsSync(filename)) return '';
  const bytes = fs.readFileSync(filename);
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(`Rule file must be UTF-8; original file preserved: ${filename}`); }
  const content = bytes.toString('utf8');
  hookBounds(content);
  return content;
}

function selectHost(options) {
  const host = options.host ?? 'codex';
  if (!['codex', 'cursor', 'generic'].includes(host)) fail('--host must be codex, cursor or generic.');
  return host;
}

function registeredHook(registration, host) {
  const hook = registration?.hosts?.[host];
  if (hook) return hook;
  return host === 'codex' && registration?.rules_file ? registration : null;
}

function selectRules(options, project, registration, host) {
  const hook = registeredHook(registration, host);
  const legacyCursorFile = '.cursor/rules/project-records.mdc';
  const cursorFile = hook?.rules_selection === 'default' && hook.rules_file === legacyCursorFile
    && fs.existsSync(path.join(project, legacyCursorFile)) ? legacyCursorFile : '.cursor/rules/biz-project.mdc';
  const defaultFile = host === 'cursor' ? cursorFile
    : host === 'codex' ? (fs.existsSync(path.join(project, 'AGENTS.override.md'))
      ? 'AGENTS.override.md' : 'AGENTS.md') : null;
  const relative = options['rules-file'] ?? (hook?.rules_selection === 'explicit' ? hook.rules_file : defaultFile);
  if (!relative) fail('A generic host requires --rules-file pointing to guidance it actually loads.');
  return contained(project, path.resolve(project, relative));
}

export function cursorRuleError(project, filename, content) {
  const relative = path.relative(project, filename).split(path.sep).join('/');
  if (relative === 'AGENTS.md') return null;
  if (!relative.startsWith('.cursor/rules/') || !relative.endsWith('.mdc')) {
    return 'Cursor guidance must be root AGENTS.md or an .mdc file inside .cursor/rules.';
  }
  if (!content.replace(/^\uFEFF/, '').trim()) return null;
  const metadata = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!metadata) return 'Existing Cursor MDC needs frontmatter with alwaysApply: true; original file preserved.';

  // Accept only flat scalar metadata; complex YAML must be reviewed, not guessed.
  const fields = new Map();
  for (const line of metadata[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const field = line.match(/^(description|globs|alwaysApply):(?:[ \t]+(.*))?$/);
    if (!field || fields.has(field[1])) return 'Unsupported or duplicate Cursor frontmatter fields; original file preserved.';
    const key = field[1];
    const value = field[2] ?? '';
    if (key === 'alwaysApply') {
      if (!/^(true|false)(?:[ \t]+#.*)?[ \t]*$/.test(value)) return 'Cursor alwaysApply must be a literal boolean; original file preserved.';
      fields.set(key, /^true\b/.test(value));
      continue;
    }
    let valid = value === '' || /^[a-zA-Z0-9_][a-zA-Z0-9_\- ./,*]*(?:[ \t]+#.*)?$/.test(value);
    if (value.startsWith('"')) {
      try { valid = typeof JSON.parse(value) === 'string'; } catch { valid = false; }
    } else if (value.startsWith("'")) valid = /^'(?:[^']|'')*'$/.test(value);
    if (!valid) return 'Complex Cursor frontmatter needs review; use root AGENTS.md or a separate simple MDC rule.';
    fields.set(key, value);
  }
  return fields.get('alwaysApply') === true ? null
    : 'Cursor MDC must set alwaysApply: true for this entry point; original file preserved.';
}

export function inspectProject(options) {
  if (!options.project) fail('--project is required.');
  const host = selectHost(options);
  const identity = identifyProject(options.project);
  const configFile = configPath(options);
  const preference = participation(identity, configFile);
  if (preference.status === 'declined') {
    return { initialized: false, records_initialized: false, host,
      project_root: identity.root, project_identity: identity.identity, is_git_project: identity.git,
      project_id: null, participation: preference, skip_recording: true, project_confirmation_required: false,
      records_root: null, records_root_source: null, records_root_confirmation_required: false,
      config_file: configFile, rules_file: null, hook_present: false, rules_error: null,
      legacy_records_centers: [], existing_rule_files: [], global_rule_files: [], legacy_record_directories: [],
      project_directory: null, registration: null, project_profile: null };
  }
  const center = inspectRecordsCenter(options);
  const location = { root: center.records_root, source: center.records_root_source };
  if (location.root) assertDataRoot(location.root, identity.root);
  const registry = center.registry, legacy = center.legacy_records_centers;
  const confirmationRequired = center.records_root_confirmation_required;
  const matches = Object.entries(registry?.projects ?? {}).filter(([, item]) => item.identity === identity.identity);
  if (matches.length > 1) fail('Duplicate project identities found; reconcile the registry before continuing.');
  const [id, registration] = matches[0] ?? [];
  const rulesFile = selectRules(options, identity.root, registration, host);
  const content = guidanceText(rulesFile);
  const rulesError = host === 'cursor' ? cursorRuleError(identity.root, rulesFile, content) : null;
  const bounds = hookBounds(content);
  const block = bounds ? content.slice(bounds.start, bounds.end) : '';
  const invocation = host === 'cursor' ? '/biz-project' : host === 'codex' ? '$biz-project' : 'biz-project skill';
  const hookPresent = Boolean(id && content.includes(hookStart) && content.includes(hookEnd)
    && block.includes(invocation) && block.includes(`Project records ID: ${id}`) && !rulesError);
  const projectDirectory = id ? contained(location.root, path.join(location.root, 'projects', id)) : null;
  const projectFile = projectDirectory ? path.join(projectDirectory, 'project.json') : null;
  const projectProfile = projectFile && fs.existsSync(projectFile) ? readJson(projectFile) : null;
  const overviewFile = projectDirectory ? path.join(projectDirectory, 'README.md') : null;
  const overviewPresent = Boolean(overviewFile && fs.existsSync(overviewFile) && fs.statSync(overviewFile).isFile());
  if (projectProfile && (projectProfile.schema_version !== 1 || projectProfile.id !== id)) fail('Project profile identity does not match the registry.');
  const codexHome = process.env.CODEX_HOME ?? path.join(homeDirectory, '.codex');
  return {
    initialized: Boolean(id && hookPresent && projectProfile && overviewPresent && !confirmationRequired),
    participation: { ...preference, status: id ? 'registered' : preference.status }, skip_recording: false,
    project_confirmation_required: !id && preference.status === 'unanswered',
    records_initialized: Boolean(id && projectProfile && overviewPresent), host, invocation,
    project_id: id ?? null,
    project_root: identity.root, project_identity: identity.identity, is_git_project: identity.git,
    records_root: location.root, records_root_source: location.source,
    suggested_records_root: canonical(path.join(homeDirectory, '.biz-project')),
    records_root_confirmation_required: confirmationRequired,
    legacy_records_centers: legacy,
    config_file: configFile, rules_file: rulesFile, hook_present: hookPresent, rules_error: rulesError,
    existing_rule_files: knownRules(identity.root),
    global_rule_files: host === 'codex'
      ? ['AGENTS.override.md', 'AGENTS.md'].map((name) => path.join(codexHome, name)).filter(fs.existsSync) : [],
    global_guidance_source: host === 'codex' ? 'codex-home' : 'host-context',
    legacy_record_directories: ['unpublished-docs', 'docs/features', 'docs/records'].map((name) => path.join(identity.root, name)).filter(fs.existsSync),
    project_directory: projectDirectory,
    registration: registration ?? null,
    project_profile: projectProfile,
    history: location.root && !confirmationRequired ? historyStatus(location.root) : undefined
  };
}

function invocationBlock(id, newline) {
  return [hookStart, '## Biz Project', '',
    'Use the biz-project skill when developing, fixing, reviewing or handing off project',
    'work, synchronizing features between branches, or checking release status.',
    'In Codex invoke $biz-project; in Cursor invoke /biz-project.',
    'Pass --host codex or --host cursor to the bundled helper to match the active tool.',
    'Other tools use --host generic with their explicitly selected active --rules-file.',
    'Before work, inspect the central records using the helper bundled with the skill.',
    'If skip_recording is true, skip this skill without creating records or asking again.',
    'Unregistered projects require an explicit user answer before joining.',
    'If no records center exists, ask the user to confirm its path before any writes.',
    'Do not initialize from a suggested path or silently reuse a legacy center.',
    'Initialize missing registration or invocation guidance before continuing.',
    `Project records ID: ${id}`,
    'Read the registered project profile and existing feature record. Keep changes,',
    'verification evidence and handoff updates in that central record. Follow existing',
    'project-specific branch, release and delegation rules. Existing local notes are',
    'migrated only within the authorized task scope.', hookEnd].join(newline);
}

function mergeGuidance(original, id) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const block = invocationBlock(id, newline);
  const bounds = hookBounds(original);
  if (bounds) return original.slice(0, bounds.start) + block + original.slice(bounds.end);
  const separator = !original ? '' : original.endsWith(newline + newline) ? ''
    : original.endsWith(newline) ? newline : newline + newline;
  return original + separator + block + newline;
}

export function initializeProject(options) {
  const state = inspectProject(options);
  requireParticipation(state, options['join-confirmed'] === true);
  if (state.rules_error) fail(state.rules_error);
  if (!state.records_root || state.records_root_confirmation_required) {
    fail('Records center requires user confirmation. Ask the user, then pass --records-root with the confirmed path. No files changed.');
  }
  const root = state.records_root;
  assertDataRoot(root, state.project_root);
  if (fs.existsSync(root) && !loadRegistry(root) && fs.readdirSync(root).length) {
    fail('Selected directory is nonempty and is not a recognized records center.');
  }
  const savedConfig = fs.existsSync(state.config_file) ? readJson(state.config_file) : null;
  if (savedConfig && canonical(savedConfig.records_root) !== root) {
    fail('Selected root differs from the saved config. Use a separate --config or deliberately update the existing config.');
  }
  const result = withLock(root, () => {
    requireParticipation(inspectProject(options), options['join-confirmed'] === true);
    const original = guidanceText(state.rules_file);
    if (state.host === 'cursor') {
      const error = cursorRuleError(state.project_root, state.rules_file, original);
      if (error) fail(error);
    }
    const existingRegistry = loadRegistry(root);
    const registry = existingRegistry ?? { kind: 'biz-project', schema_version: 1, projects: {} };
    const match = Object.entries(registry.projects).find(([, item]) => item.identity === state.project_identity);
    const id = match?.[0] ?? randomUUID();
    const projectDirectory = contained(root, path.join(root, 'projects', id));
    const profileFile = contained(root, path.join(projectDirectory, 'project.json'));
    const readmeFile = contained(root, path.join(projectDirectory, 'README.md'));
    const now = new Date().toISOString();
    const registration = match?.[1] ?? {
      name: options.name ?? path.basename(state.project_root), identity: state.project_identity,
      paths: [], created_at: now
    };
    if (!registration.paths.includes(state.project_root)) registration.paths.push(state.project_root);
    const previousHook = registeredHook(registration, state.host);
    const hook = { rules_file: path.relative(state.project_root, state.rules_file).split(path.sep).join('/'),
      rules_selection: options['rules-file'] ? 'explicit' : previousHook?.rules_selection ?? 'default' };
    registration.hosts ??= {};
    registration.hosts[state.host] = hook;
    if (state.host === 'codex') {
      registration.rules_file = hook.rules_file;
      registration.rules_selection = hook.rules_selection;
    }
    registry.projects[id] = registration;
    const registryFile = path.join(root, 'registry.json'), nextRegistry = jsonText(registry);
    // Persist identity first so a partially created profile can resume with its ID.
    if (!fs.existsSync(registryFile) || fs.readFileSync(registryFile, 'utf8') !== nextRegistry) atomicWrite(registryFile, nextRegistry);
    if (!fs.existsSync(profileFile)) {
      atomicWrite(profileFile, jsonText({ schema_version: 1, id, name: registration.name,
        development_branch: null, release_branch: null, release_criterion: null,
        verification_commands: [], delegation_policy: 'Follow the project rules and current user authorization.',
        legacy_records: state.legacy_record_directories, migration_status: 'not-migrated', created_at: now }));
    }
    if (!fs.existsSync(readmeFile)) atomicWrite(readmeFile, `# ${registration.name}\n\n## Project agreements\n\nRead the original project rules and fill project.json before development.\n\n## Features\n\nFeature records live in features/. Each feature has one owner and separate agent updates.\n\n## Migration\n\nExisting project notes have not been moved or deleted by initialization.\n`);
    let prepared = original;
    if (state.host === 'cursor' && state.rules_file.endsWith('.mdc') && !original.replace(/^\uFEFF/, '').trim()) {
      const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
      const newline = original.includes('\r\n') ? '\r\n' : '\n';
      prepared = bom + ['---', 'alwaysApply: true', '---', ''].join(newline) + original.slice(bom.length);
    }
    const nextGuidance = mergeGuidance(prepared, id);
    if (nextGuidance !== original) atomicWrite(state.rules_file, nextGuidance);
    if (!savedConfig) atomicWrite(state.config_file, jsonText({ schema_version: 1, records_root: root }));
    const profile = readJson(profileFile);
    return { initialized: true, host: state.host, project_id: id, project_directory: projectDirectory,
      records_root: root, rules_file: state.rules_file, config_file: state.config_file,
      profile_review_required: true, migration_status: profile.migration_status };
  });
  try {
    const profile = connectionProfile(result);
    // Do not overwrite the identity published by a running (or unverified) process.
    if (loadRegistry(root)?.kind === 'biz-project' && !fs.existsSync(profile.runtime_file)) publishConnection(profile, undefined,
      path.join(path.dirname(result.config_file), 'connections'));
  } catch { result.connection_warning = '本机连接资料未能登记；可通过工程目录重新发现，不影响项目初始化。'; }
  return result;
}

export function requireProject(options) {
  const state = inspectProject(options);
  requireParticipation(state);
  if (state.records_root_confirmation_required) {
    fail('Records center requires user confirmation. Ask the user, then pass --records-root with the confirmed path. No files changed.');
  }
  if (!state.initialized) fail('Project initialization is missing or incomplete. Run inspect, then init.');
  return state;
}

function requireParticipation(state, confirmed = false) {
  if (state.skip_recording) fail('Project participation was declined. Skip recording; only an explicit user request to join permits set-participation --decision yes. No project or record files changed.');
  if (state.project_confirmation_required && !confirmed) fail('Project participation requires confirmation. Ask whether the user wants this project to join before initialization. No files changed.');
}

export function setParticipation(options) {
  if (!options.project) fail('--project is required.');
  return saveParticipation(identifyProject(options.project), configPath(options), options.decision,
    options['records-root'] ?? process.env.BIZ_PROJECT_HOME);
}

export function inspectRecordsCenter(options = {}) {
  const configFile = configPath(options);
  const config = fs.existsSync(configFile) ? readJson(configFile) : null;
  if (config && (config.schema_version !== 1 || typeof config.records_root !== 'string')) fail(`Invalid configuration: ${configFile}`);
  const location = discoverRoot(options, config);
  if (location.root) assertDataRoot(location.root, sourceDirectory);
  const registry = location.root ? loadRegistry(location.root) : null;
  const legacy = legacyCenters();
  const competing = location.source === 'discovered' && legacy.some(item => item.records_root !== location.root);
  return { records_root: location.root, records_root_source: location.source, config_file: configFile, registry,
    legacy_records_centers: legacy,
    records_root_confirmation_required: !options['records-root'] && (!registry || registry.kind !== 'biz-project' || competing) };
}
