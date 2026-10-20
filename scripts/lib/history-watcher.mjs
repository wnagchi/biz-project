import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { atomicWrite, readJson, jsonText } from './storage.mjs';
import { historyDirectory, safePath, isDocument, documentStat, signature, enumerateDocuments, MAX_DOCUMENTS } from './history-files.mjs';
import { createSnapshotStore } from './records-history.mjs';
import { acquireLease } from './process-lease.mjs';

export function startHistoryWatcher(root, options = {}) {
  const quietMs = options.quietMs ?? 2000, reconcileMs = options.reconcileMs ?? 15 * 60 * 1000;
  if (!Number.isInteger(quietMs) || quietMs < 100 || !Number.isInteger(reconcileMs) || reconcileMs < 1000) throw new Error('Invalid watcher timings.');
  let store, release, native, timer, pumpTimer, closed = false, paused = false, scanning = false, scanPromise;
  let active = false, scanState = 'starting', lastScan = null, elapsed = null, nativeAvailable = false;
  const known = new Map(), dirty = new Map(), running = new Map(), errors = new Map(), failures = new Map();
  const directories = new Map();
  const observeDirectory = (file, children) => {
    if (directories.size >= 50000 && !directories.has(file)) throw new Error('Directory cache exceeds its limit.');
    directories.set(file, children);
  };
  let scanRequested = false, forceRequested = false;
  const status = () => ({ engine: 'document-snapshots', active: active && !paused && !closed, paused,
    scan_state: scanState, last_scan: lastScan, scan_ms: elapsed, native_watcher: nativeAvailable,
    dirty_count: dirty.size + running.size, document_count: known.size, warning: [...errors.values()].slice(0, 5).join('\n') || null,
    content_reads: store?.metrics.content_reads ?? 0, bytes_read: store?.metrics.bytes_read ?? 0,
    stat_reads: store?.metrics.stat_reads ?? 0,
    snapshots_created: store?.metrics.snapshots_created ?? 0, quiet_ms: quietMs });
  const warn = (file, error) => { if (errors.size >= 64 && !errors.has(file)) errors.delete(errors.keys().next().value); errors.set(file, error.message); };
  function enqueue(file, source = 'filesystem-watcher', delay = quietMs, folder = false) {
    if (closed || paused || (!folder && !isDocument(file))) return;
    if (dirty.size >= MAX_DOCUMENTS && !dirty.has(file)) { warn('queue', new Error('Snapshot queue full; reconciliation will catch current documents.')); return; }
    dirty.set(file, { source, due: Date.now() + delay, folder });
    if (!folder) for (const [parent, item] of dirty) if (item.folder && file.startsWith(parent + '/')) item.due = Date.now() + delay;
    schedule();
  }
  function schedule() {
    if (pumpTimer || closed || paused || !dirty.size || running.size >= 2) return;
    const due = Math.min(...[...dirty.values()].map(item => item.due));
    pumpTimer = setTimeout(pump, Math.max(20, due - Date.now())); pumpTimer.unref();
  }
  async function capture(file, source, checkMetadata = false) {
    if (!known.has(file) && known.size >= MAX_DOCUMENTS) { warn('limit', new Error('Snapshot document count exceeds 10,000.')); return; }
    try {
      if (checkMetadata && known.has(file) && !errors.has(file)) {
        const stat = await documentStat(root, file, store.metrics);
        if (known.get(file) === (stat ? signature(stat) : null)) return;
      }
      const value = await store.capture(file, source); known.set(file, value.stat ? signature(value.stat) : null); errors.delete(file); failures.delete(file);
    }
    catch (error) { warn(file, error); const count = (failures.get(file) ?? 0) + 1;
      if (failures.size >= 64 && !failures.has(file)) failures.delete(failures.keys().next().value); failures.set(file, count);
      enqueue(file, source, Math.min(60000, Math.max(1000, quietMs) * 2 ** Math.min(count - 1, 6))); }
  }
  async function captureFolder(prefix, full = false) {
    const found = new Set();
    try {
      const projects = store.refreshProjects();
      if (!projects.has(prefix.split('/')[1])) return;
      const before = directories.get(prefix);
      // Windows emits parent directory events as well as the renamed child.
      // Compare direct children instead of stat-ing every descendant again.
      if (before && !full) {
        const children = new Map(); let entries = 0;
        try {
          for await (const entry of await fsp.opendir(safePath(root, prefix))) {
            if (++entries > 50000) throw new Error('Directory enumeration exceeds its limit.');
            if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['history', 'node_modules'].includes(entry.name)) continue;
            if (entry.isDirectory()) children.set(entry.name, 'directory');
            else if (entry.isFile() && isDocument(`${prefix}/${entry.name}`)) children.set(entry.name, 'document');
          }
        } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
        for (const [name, type] of children) if (before.get(name) !== type && !paused && !closed) {
          const child = `${prefix}/${name}`;
          if (type === 'directory') await captureFolder(child, true); else await capture(child, 'filesystem-watcher');
        }
        for (const [name, type] of before) if (children.get(name) !== type && !paused && !closed) {
          const child = `${prefix}/${name}`;
          if (type === 'directory') {
            for (const file of known.keys()) if (file.startsWith(child + '/') && known.get(file) !== null) await capture(file, 'filesystem-watcher');
            for (const folder of directories.keys()) if (folder === child || folder.startsWith(child + '/')) directories.delete(folder);
          } else if (known.get(child) !== null) await capture(child, 'filesystem-watcher');
        }
        observeDirectory(prefix, children); errors.delete(prefix); return;
      }
      for await (const file of enumerateDocuments(root, projects, prefix, observeDirectory)) {
        if (paused || closed) break; found.add(file);
        const stat = await documentStat(root, file, store.metrics);
        if (known.get(file) !== (stat ? signature(stat) : null)) await capture(file, 'filesystem-watcher');
      }
      for (const file of known.keys()) if (file.startsWith(prefix + '/') && !found.has(file) && known.get(file) !== null && !paused && !closed) await capture(file, 'filesystem-watcher');
      errors.delete(prefix);
    } catch (error) { if (error.code === 'ENOTDIR') return; warn(prefix, error); enqueue(prefix, 'filesystem-watcher', Math.max(1000, quietMs), true); }
  }
  function pump() {
    pumpTimer = null;
    if (closed || paused || scanning) { if (!closed && !paused) { pumpTimer = setTimeout(pump, 100); pumpTimer.unref(); } return; }
    for (const [file, item] of dirty) {
      if (running.size >= 2) break;
      if (item.due > Date.now() || running.has(file)) continue;
      dirty.delete(file); const promise = (item.folder ? captureFolder(file) : capture(file, item.source, true)).finally(() => { running.delete(file); schedule(); }); running.set(file, promise);
    }
    if (running.size < 2) schedule();
  }
  function scan(force = false, source = 'reconciliation') {
    if (scanPromise) { scanRequested = true; forceRequested ||= force; return scanPromise; }
    scanPromise = (async () => {
      if (!active || closed) return; scanning = true; scanState = 'scanning'; const started = Date.now(), found = new Set();
      try {
        await Promise.all(running.values()); const projects = store.refreshProjects();
        if (force && !known.size) for await (const file of store.knownFiles()) known.set(file, 'previous-snapshot');
        directories.clear();
        for await (const file of enumerateDocuments(root, projects, null, observeDirectory)) {
          if (closed) break; found.add(file);
          try { const stat = await documentStat(root, file, store.metrics), key = stat ? signature(stat) : null;
            if (!paused && (force || known.get(file) !== key)) await capture(file, source);
            else known.set(file, key);
          } catch (error) { warn(file, error); enqueue(file, source); }
        }
        for (const file of known.keys()) if (!found.has(file) && !paused && !closed && known.get(file) !== null) await capture(file, source);
        lastScan = new Date().toISOString(); elapsed = Date.now() - started; errors.delete('scan'); scanState = 'ready';
      } catch (error) { warn('scan', error); scanState = 'error'; }
      finally { scanning = false; scanPromise = null; schedule();
        if (scanRequested && !closed) { const again = forceRequested; scanRequested = false; forceRequested = false; setImmediate(() => scan(again)); } }
    })(); return scanPromise;
  }
  let ready;
  try {
    fs.mkdirSync(historyDirectory(root), { recursive: true }); safePath(root, '.biz-project-history');
    release = acquireLease(safePath(root, '.biz-project-history/watch.lock'));
    store = createSnapshotStore(root);
    const preference = safePath(root, '.biz-project-history/watcher.json');
    if (fs.existsSync(preference)) { const value = readJson(preference); if (value.schema_version !== 2 || typeof value.paused !== 'boolean') throw new Error('Invalid watcher preferences.'); paused = value.paused; }
    active = true;
    try {
      native = fs.watch(root, { recursive: true }, (_event, filename) => {
        const file = String(filename ?? '').split(path.sep).join('/');
        if (file.startsWith('.biz-project-history/') || file.startsWith('.git/') || file.split('/').some(part => part.startsWith('.'))) return;
        if (isDocument(file)) enqueue(file);
        else if (file === 'registry.json') {
          clearTimeout(timer); timer = setTimeout(() => { scan(false).finally(reconcile); }, Math.max(500, quietMs)); timer.unref();
        } else if (/^projects\/[a-z0-9-]+(?:\/|$)/.test(file) && !file.split('/').some(part => ['history', 'node_modules'].includes(part))) enqueue(file, 'filesystem-watcher', quietMs, true);
      }); nativeAvailable = true;
      native.on('error', error => { nativeAvailable = false; warn('watcher', error); reconcile(); });
    } catch (error) { warn('watcher', error); }
    ready = scan(true, 'startup-scan'); reconcile();
  } catch (error) { warn('owner', error); scanState = 'error'; release?.(); release = null; ready = Promise.resolve(); }
  function reconcile() { clearTimeout(timer); if (closed || !active) return;
    timer = setTimeout(() => { scan(false).finally(reconcile); }, nativeAvailable ? reconcileMs : Math.min(reconcileMs, 60000)); timer.unref(); }
  return { ready, status, store,
    async rescan() { await scan(true, 'manual-rescan'); return status(); },
    async pause() { paused = true; dirty.clear(); clearTimeout(pumpTimer); pumpTimer = null; await Promise.all(running.values());
      atomicWrite(safePath(root, '.biz-project-history/watcher.json'), jsonText({ schema_version: 2, paused: true })); return status(); },
    async resume() { if (!active || closed) throw new Error('Watcher has no active owner.');
      atomicWrite(safePath(root, '.biz-project-history/watcher.json'), jsonText({ schema_version: 2, paused: false })); paused = false;
      scan(true, 'resume-scan'); return status(); },
    async close() { if (closed) return; closed = true; active = false; clearTimeout(timer); clearTimeout(pumpTimer); native?.close();
      await ready; await scanPromise; await Promise.all(running.values()); release?.(); release = null; } };
}
