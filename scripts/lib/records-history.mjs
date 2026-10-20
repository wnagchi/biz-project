import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, historyDirectory, safePath, recordPath, readDocument, registeredProjects, MAX_DOCUMENTS, MAX_BYTES } from './history-files.mjs';

const validId = /^[0-9]{16}-[a-f0-9-]{36}$/;
export function historyStatus(root) {
  return { engine: 'document-snapshots', state: fs.existsSync(historyDirectory(root)) ? 'available' : 'service-required' };
}
export function createSnapshotStore(root) {
  let projects = registeredProjects(root);
  const metrics = { content_reads: 0, stat_reads: 0, bytes_read: 0, snapshots_created: 0 }, latest = new Map(), counts = new Map(), inFlight = new Map();
  const internal = relative => safePath(root, `.biz-project-history/${relative}`);
  const directory = file => { recordPath(root, file); return `documents/${digest(Buffer.from(file))}`; };
  async function writeOnce(relative, content) {
    const filename = internal(relative); await fsp.mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try { await fsp.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      try { await fsp.link(temporary, filename); return true; } catch (error) { if (error.code !== 'EEXIST') throw error; return false; }
    } finally { await fsp.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function names(file) {
    const result = [];
    try { for await (const entry of await fsp.opendir(internal(directory(file)))) {
      if (/\.tmp$/.test(entry.name)) continue;
      if (!entry.isFile() || !entry.name.endsWith('.json') || !validId.test(entry.name.slice(0, -5))) throw new Error('Unsafe snapshot receipt.');
      if (result.length >= 10000) throw new Error('Document history exceeds 10,000 versions.'); result.push(entry.name);
    } } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return result.sort().reverse();
  }
  async function receipt(file, name) {
    const filename = internal(`${directory(file)}/${name}`), stat = await fsp.stat(filename);
    if (stat.size > 8192) throw new Error('Snapshot receipt exceeds its limit.');
    const value = JSON.parse(await fsp.readFile(filename, 'utf8'));
    if (value.schema_version !== 2 || value.file !== file || `${value.id}.json` !== name || !validId.test(value.id)
      || (value.hash !== null && !/^[a-f0-9]{64}$/.test(value.hash)) || value.deleted !== (value.hash === null)) throw new Error('Invalid snapshot receipt.');
    return value;
  }
  async function last(file) {
    const items = await names(file); counts.set(file, items.length); return items.length ? receipt(file, items[0]) : null;
  }
  async function versions(file, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid history offset.');
    return Promise.all((await names(file)).slice(offset, offset + 100).map(name => receipt(file, name)));
  }
  async function captureCurrent(file, source) {
    const current = await readDocument(root, file, projects, metrics), hash = digest(current.bytes);
    const before = latest.has(file) ? latest.get(file) : await last(file);
    if ((!before && hash === null) || before?.hash === hash) { latest.set(file, before); return { status: 'unchanged', stat: current.stat }; }
    if ((counts.get(file) ?? 0) >= 10000) throw new Error('Document history exceeds 10,000 versions.');
    if (hash !== null) {
      if (!await writeOnce(`objects/${hash}`, current.bytes)) {
        const object = await fsp.readFile(internal(`objects/${hash}`));
        if (digest(object) !== hash) throw new Error('Snapshot content object is damaged.');
      }
    }
    const sequence = Math.max(Date.now(), Number(before?.id.slice(0, 16) ?? 0) + 1), id = `${String(sequence).padStart(16, '0')}-${randomUUID()}`;
    const value = { schema_version: 2, id, file, hash, deleted: hash === null, size: current.bytes?.length ?? 0,
      created_at: new Date().toISOString(), source, observation: 'current-document-state' };
    if (!await writeOnce(`${directory(file)}/${id}.json`, JSON.stringify(value))) throw new Error('Snapshot receipt collision.');
    latest.set(file, value); counts.set(file, (counts.get(file) ?? 0) + 1); metrics.snapshots_created++; return { status: 'recorded', version: value, stat: current.stat };
  }
  function capture(file, source) {
    const previous = inFlight.get(file) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => captureCurrent(file, source)).finally(() => { if (inFlight.get(file) === pending) inFlight.delete(file); });
    inFlight.set(file, pending); return pending;
  }
  async function readVersion(file, id) {
    if (!validId.test(id)) throw new Error('Invalid snapshot version ID.');
    const value = await receipt(file, `${id}.json`);
    if (value.deleted) return { ...value, content: null, content_base64: null };
    const objectFile = internal(`objects/${value.hash}`);
    if ((await fsp.stat(objectFile)).size > MAX_BYTES) throw new Error('Snapshot object exceeds 2 MiB.');
    const bytes = await fsp.readFile(objectFile);
    if (digest(bytes) !== value.hash) throw new Error('Snapshot content object is damaged.');
    return { ...value, content: bytes.toString('utf8'), content_base64: bytes.toString('base64') };
  }
  async function documents(offset = 0, limit = 100) {
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_DOCUMENTS || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid document history page.');
    const folders = [];
    try { for await (const entry of await fsp.opendir(internal('documents'))) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) throw new Error('Unsafe snapshot document directory.');
      if (folders.length >= MAX_DOCUMENTS) throw new Error('History document count exceeds its limit.'); folders.push(entry.name);
    } } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = [];
    for (const folder of folders.sort().slice(offset, offset + limit)) {
      const files = [];
      for await (const entry of await fsp.opendir(internal(`documents/${folder}`))) {
        if (entry.name.endsWith('.tmp')) continue;
        if (!entry.isFile() || !entry.name.endsWith('.json') || !validId.test(entry.name.slice(0, -5))) throw new Error('Unsafe snapshot receipt.');
        if (files.length >= 10000) throw new Error('Document history exceeds 10,000 versions.'); files.push(entry.name);
      }
      files.sort().reverse();
      if (!files.length) continue;
      const filename = internal(`documents/${folder}/${files[0]}`);
      if ((await fsp.stat(filename)).size > 8192) throw new Error('Snapshot receipt exceeds its limit.');
      const value = JSON.parse(await fsp.readFile(filename, 'utf8'));
      if (digest(Buffer.from(value.file)) !== folder) throw new Error('Invalid history document identity.');
      result.push(await receipt(value.file, files[0]));
    }
    return { documents: result, next_offset: offset + limit < folders.length ? offset + limit : null, total: folders.length };
  }
  async function* knownFiles() {
    for (let offset = 0; ; ) { const page = await documents(offset, 200); for (const doc of page.documents) yield doc.file;
      if (page.next_offset === null) break; offset = page.next_offset; }
  }
  return { capture, versions, readVersion, documents, knownFiles, metrics,
    refreshProjects() { projects = registeredProjects(root); return projects; } };
}
