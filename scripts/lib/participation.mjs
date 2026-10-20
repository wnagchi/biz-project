import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite, canonical, fail, isInside, jsonText, readJson, sourceDirectory, withLock } from './storage.mjs';

export const preferencesPath = configFile => canonical(path.join(path.dirname(configFile), 'project-preferences.json'));
const pathKey = value => {
  if (process.platform !== 'win32') return value;
  // Git expands Windows 8.3 aliases while the JS realpath implementation may not.
  // Compare native aliases without rewriting persisted identities or missing paths.
  let resolved = value;
  try { resolved = fs.realpathSync.native(value); }
  catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  return resolved.toLowerCase();
};

function load(filename) {
  if (!fs.existsSync(filename)) return { kind: 'biz-project-preferences', schema_version: 1, projects: {} };
  const data = readJson(filename);
  if (data.kind !== 'biz-project-preferences' || data.schema_version !== 1 || !data.projects
    || typeof data.projects !== 'object' || Array.isArray(data.projects)
    || Object.values(data.projects).some(item => !item || typeof item !== 'object'
      || typeof item.identity !== 'string' || !item.identity || !['yes', 'no'].includes(item.decision)
      || !Array.isArray(item.paths) || !item.paths.length
      || item.paths.some(p => typeof p !== 'string' || !path.isAbsolute(p)))) {
    fail(`Invalid project preferences; original file preserved: ${filename}`);
  }
  return data;
}

function matching(data, project) {
  return Object.entries(data.projects).filter(([, item]) => item.identity === project.identity
    || item.paths.some(p => pathKey(canonical(p)) === pathKey(project.root)));
}

export function participation(project, configFile) {
  const filename = preferencesPath(configFile), matches = matching(load(filename), project);
  const status = matches.some(([, item]) => item.decision === 'no') ? 'declined'
    : matches.length ? 'accepted' : 'unanswered';
  return { status, preferences_file: filename };
}

export function saveParticipation(project, configFile, decision, recordsRoot) {
  if (!['yes', 'no'].includes(decision)) fail('--decision must be yes or no, based on the user\'s explicit answer.');
  const filename = preferencesPath(configFile);
  let savedRoot = null;
  if (fs.existsSync(configFile)) {
    // A broken center pointer must not prevent recording a refusal.
    try { const config = readJson(configFile); if (typeof config.records_root === 'string' && config.records_root.trim()) savedRoot = config.records_root; }
    catch { /* Do not repair or replace the pointer. */ }
  }
  if (pathKey(filename) === pathKey(configFile) || [project.root, sourceDirectory, recordsRoot, savedRoot].filter(Boolean)
    .some(root => isInside(canonical(root), filename))) {
    fail('Keep project preferences outside the project, skill source and records center, separate from the configuration pointer.');
  }
  // Validate before creating the lock directory; corrupt data is never replaced.
  load(filename);
  return withLock(path.dirname(filename), () => {
    const data = load(filename), matches = matching(data, project);
    const paths = [...new Set([...matches.flatMap(([, item]) => item.paths), project.root])];
    const key = createHash('sha256').update(project.identity).digest('hex');
    const previous = data.projects[key];
    if (!(matches.length === 1 && matches[0][0] === key && previous.decision === decision
      && JSON.stringify(previous.paths) === JSON.stringify(paths))) {
      for (const [oldKey] of matches) delete data.projects[oldKey];
      data.projects[key] = { ...(previous ?? matches[0]?.[1]), identity: project.identity, paths, decision, updated_at: new Date().toISOString() };
      atomicWrite(filename, jsonText(data));
    }
    return { project_root: project.root, project_identity: project.identity,
      participation: { status: decision === 'no' ? 'declined' : 'accepted', preferences_file: filename },
      skip_recording: decision === 'no' };
  });
}

export function declined(configFile, project) {
  const filename = preferencesPath(configFile);
  if (!configFile || !fs.existsSync(filename)) return false;
  const paths = new Set((project.paths ?? []).map(pathKey));
  return Object.values(load(filename).projects).some(item => item.decision === 'no'
    && (item.identity === project.identity || item.paths.some(saved => paths.has(pathKey(saved)))));
}
