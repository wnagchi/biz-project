import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonText } from './storage.mjs';

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid lease owner.');
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}
function recoveryLease(directory) {
  const id = randomUUID(), ticket = path.join(directory, `${id}.json`);
  const value = jsonText({ pid: process.pid, id });
  let published = false;
  const release = () => {
    if (!published || !fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) return;
    if (fs.existsSync(ticket) && fs.readFileSync(ticket, 'utf8') === value) fs.unlinkSync(ticket);
    try { fs.rmdirSync(directory); } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
  };
  try {
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe recovery lease; manual inspection required.');
      const tickets = fs.readdirSync(directory);
      if (tickets.length > 64) throw new Error('Recovery lease exceeds its limit.');
      for (const name of tickets) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error('Unknown recovery lease owner.');
        const filename = path.join(directory, name), info = fs.lstatSync(filename);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error('Unsafe recovery lease owner.');
        const bytes = fs.readFileSync(filename, 'utf8'), owner = JSON.parse(bytes);
        if (`${owner.id}.json` !== name || processAlive(owner.pid)) throw new Error('Service owner is busy recovering its lease.');
        // Immutable UUID tickets cannot be confused with a new owner's ticket.
        if (fs.readFileSync(filename, 'utf8') === bytes) fs.unlinkSync(filename);
      }
      try { fs.rmdirSync(directory); fs.mkdirSync(directory, { mode: 0o700 }); }
      catch { throw new Error('Service owner is busy recovering its lease.'); }
    }
    fs.writeFileSync(ticket, value, { flag: 'wx', mode: 0o600 });
    published = true;
    const tickets = fs.readdirSync(directory);
    if (tickets.length !== 1 || tickets[0] !== path.basename(ticket)) throw new Error('Service recovery ownership changed.');
    return release;
  } catch (error) { release(); throw error; }
}
export function acquireLease(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const reclaim = `${filename}.reclaim`;
  const value = jsonText({ schema_version: 1, pid: process.pid, id: randomUUID(), created_at: new Date().toISOString() });
  const claim = () => { fs.writeFileSync(filename, value, { flag: 'wx', mode: 0o600 }); };
  try { claim(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Unsafe process lease.');
    let recovery;
    try {
      recovery = recoveryLease(reclaim);
      const old = fs.readFileSync(filename, 'utf8'), owner = JSON.parse(old);
      if (processAlive(owner.pid)) throw new Error('Another running owner holds this service lease.');
      if (fs.readFileSync(filename, 'utf8') !== old) throw new Error('Service lease changed during recovery.');
      fs.unlinkSync(filename); claim();
    } finally { recovery?.(); }
  }
  return () => { if (fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === value) fs.unlinkSync(filename); };
}
