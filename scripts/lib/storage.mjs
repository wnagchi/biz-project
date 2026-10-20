import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const homeDirectory = os.homedir();

export function fail(message) {
  throw new Error(message);
}

export function canonical(filename) {
  let existing = path.resolve(filename);
  const tail = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) fail(`Cannot resolve path: ${filename}`);
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...tail);
}

export function isInside(directory, filename) {
  const relative = path.relative(canonical(directory), canonical(filename));
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

export function contained(directory, filename) {
  if (!isInside(directory, filename)) fail(`Path must stay inside ${directory}: ${filename}`);
  return canonical(filename);
}

export function readJson(filename) {
  try {
    const value = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a JSON object');
    return value;
  } catch (error) {
    fail(`Cannot read JSON ${filename}: ${error.message}`);
  }
}

export function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function atomicWrite(filename, content) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    if (fs.existsSync(filename)) fs.chmodSync(temporary, fs.statSync(filename).mode);
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function publishOnce(filename, content) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    try {
      // Linking a completed file publishes it without replacing another writer.
      fs.linkSync(temporary, filename);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function withLock(directory, action) {
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, '.write.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') fail(`Records are busy; lock retained at ${lock}. Retry after its owner finishes.`);
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, jsonText({ pid: process.pid, created_at: new Date().toISOString() }));
    return action();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

export function validateId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    fail('IDs must contain 1-64 lowercase letters, digits or hyphens and start with a letter or digit.');
  }
  return value;
}

export function assertDataRoot(directory, projectRoot) {
  if (isInside(sourceDirectory, directory) || isInside(directory, sourceDirectory)) {
    fail('Live records must be outside the skill engineering directory.');
  }
  if (isInside(projectRoot, directory) || isInside(directory, projectRoot)) {
    fail('Live records must be outside the managed project directory.');
  }
}

export function loadRegistry(directory) {
  const filename = path.join(directory, 'registry.json');
  if (!fs.existsSync(filename)) return null;
  const registry = readJson(filename);
  if (!['biz-project', 'project-records'].includes(registry.kind) || registry.schema_version !== 1
    || !registry.projects || typeof registry.projects !== 'object' || Array.isArray(registry.projects)) {
    fail(`Unrecognized records registry: ${filename}`);
  }
  for (const [id, project] of Object.entries(registry.projects)) {
    validateId(id);
    if (!project || typeof project !== 'object' || typeof project.identity !== 'string'
      || !Array.isArray(project.paths) || project.paths.some((item) => typeof item !== 'string')) {
      fail(`Invalid project registration: ${id}`);
    }
    if (project.hosts !== undefined) {
      if (!project.hosts || typeof project.hosts !== 'object' || Array.isArray(project.hosts)) {
        fail(`Invalid host registrations: ${id}`);
      }
      for (const [host, hook] of Object.entries(project.hosts)) {
        if (!hook || typeof hook !== 'object' || Array.isArray(hook)
          || typeof hook.rules_file !== 'string' || !hook.rules_file.trim()
          || !['default', 'explicit'].includes(hook.rules_selection)) {
          fail(`Invalid host registration ${host}: ${id}`);
        }
      }
    }
  }
  return registry;
}
