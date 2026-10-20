import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadRegistry } from './storage.mjs';

export const digest = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
export const historyDirectory = root => path.join(root, '.biz-project-history');
export const MAX_DOCUMENTS = 10000;
export const MAX_BYTES = 2 * 1024 * 1024;
export function isDocument(file) {
  if (typeof file !== 'string' || file.length > 1024 || file.includes('\\') || /[\0\r\n]/.test(file)) return false;
  const parts = file.split('/');
  if (parts.some(p => !p || p.startsWith('.') || ['history', 'node_modules'].includes(p))) return false;
  if (['agents.md', 'skill.md'].includes(parts.at(-1).toLowerCase())) return false;
  if (parts[0] !== 'projects' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(parts[1] ?? '')) return false;
  return /\.md$/i.test(file) || /^projects\/[a-z0-9-]+\/(?:project\.json|features\/[a-z0-9-]+\/(?:feature\.json|updates\/[a-z0-9-]+\.json))$/.test(file);
}
export function safePath(root, relative) {
  let current = path.resolve(root);
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Unsafe records root.');
  for (const part of relative.split('/')) {
    if (!part || part === '..' || part.includes('\\') || part.includes(':')) throw new Error('Unsafe record path.');
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Snapshot paths cannot follow symbolic links.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}
export function recordPath(root, file) {
  if (!isDocument(file)) throw new Error('Snapshot path is not a center document.');
  return safePath(root, file);
}
export const signature = stat => `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
export async function documentStat(root, file, metrics) {
  if (metrics) metrics.stat_reads++;
  try { const value = await fsp.lstat(recordPath(root, file)); if (!value.isFile() || value.size > MAX_BYTES) throw new Error('Document exceeds 2 MiB or is not a file.'); return value; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function readDocument(root, file, projects, metrics) {
  const filename = recordPath(root, file);
  if (fs.existsSync(path.join(root, '.write.lock'))) throw new Error('Records are busy; snapshot deferred.');
  const parts = file.split('/'), folders = [`projects/${parts[1]}`];
  if (parts[2] === 'features' && parts[3]) folders.push(`projects/${parts[1]}/features/${parts[3]}`);
  for (const folder of folders) {
    try { if ((await fsp.readdir(safePath(root, `${folder}/history`))).some(name => name.endsWith('.pending'))) throw new Error('Unfinished journal requires recovery; snapshot deferred.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const before = await documentStat(root, file, metrics);
  if (!before) return { bytes: null, stat: null };
  if (!projects.has(parts[1])) throw new Error('Document belongs to an unregistered project.');
  const bytes = await fsp.readFile(filename); metrics.content_reads++; metrics.bytes_read += bytes.length;
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (bytes.length > MAX_BYTES) throw new Error('Document exceeds 2 MiB.');
  const after = await documentStat(root, file, metrics);
  if (!after || signature(before) !== signature(after) || fs.existsSync(path.join(root, '.write.lock'))) throw new Error('Document changed during capture; retry when stable.');
  if (file.endsWith('.json')) {
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (value.schema_version !== 1 || (parts[2] === 'project.json' && value.id !== parts[1])
      || (parts[4] === 'feature.json' && (value.id !== parts[3] || value.project_id !== parts[1]))
      || (parts[4] === 'updates' && (value.project_id !== parts[1] || value.feature_id !== parts[3] || typeof value.content !== 'string'))) throw new Error('Document identity mismatch.');
  }
  return { bytes, stat: after };
}
export function registeredProjects(root) {
  const registry = loadRegistry(root); if (!registry) throw new Error('Snapshots require a recognized center.');
  return new Set(Object.keys(registry.projects));
}
export async function* enumerateDocuments(root, projects, prefix = null, observeDirectory = () => {}) {
  let count = 0, entries = 0;
  async function* walk(relative) {
    let directory;
    try { directory = await fsp.opendir(safePath(root, relative)); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const children = new Map(); observeDirectory(relative, children);
    for await (const entry of directory) {
      if (++entries > 50000) throw new Error('Center enumeration exceeds 50,000 entries.');
      if (entry.name.startsWith('.') || ['history', 'node_modules'].includes(entry.name)) continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { children.set(entry.name, 'directory'); if (file.split('/').length > 16) throw new Error('Record nesting exceeds its limit.'); yield* walk(file); }
      else if (entry.isFile() && isDocument(file)) { children.set(entry.name, 'document'); if (++count > MAX_DOCUMENTS) throw new Error('Center exceeds 10,000 documents.'); yield file; }
    }
  }
  if (prefix !== null) {
    const parts = prefix.split('/');
    if (parts[0] !== 'projects' || !projects.has(parts[1]) || parts.some(p => !p || p.startsWith('.') || ['history', 'node_modules'].includes(p))) return;
    yield* walk(prefix);
  } else for (const id of projects) yield* walk(`projects/${id}`);
}
