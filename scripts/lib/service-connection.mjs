import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite, canonical, homeDirectory, isInside, jsonText, readJson, sourceDirectory } from './storage.mjs';
import { servicePaths } from './service-runtime.mjs';

export function connectionProfile(state) {
  const config = canonical(state.config_file), root = canonical(state.records_root);
  const key = `${config}\n${root}`;
  return { kind: 'biz-project-connection', protocol_version: 1,
    id: createHash('sha256').update(process.platform === 'win32' ? key.toLowerCase() : key).digest('hex'),
    capabilities: ['service-control-v1', 'local-connection-v1'],
    version: readJson(path.join(sourceDirectory, 'package.json')).version,
    installation_directory: sourceDirectory, node_executable: process.execPath,
    config_file: config, records_root: root, runtime_file: servicePaths(state).runtime };
}

export function publishConnection(profile, home = homeDirectory, directory = path.join(home, '.config/biz-project/connections')) {
  if (profile.kind !== 'biz-project-connection' || profile.protocol_version !== 1 || !/^[a-f0-9]{64}$/.test(profile.id)) {
    throw new Error('Invalid connection profile identity.');
  }
  if (isInside(profile.records_root, directory) || isInside(sourceDirectory, directory)) {
    throw new Error('Connection profiles must stay outside records and source.');
  }
  let current = path.resolve(directory);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Unsafe connection profile directory.');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  const filename = path.join(directory, `${profile.id}.json`), content = jsonText(profile);
  if (Buffer.byteLength(content) > 32768) throw new Error('Connection profile exceeds the size limit.');
  if (fs.existsSync(filename) && !fs.lstatSync(filename).isFile()) throw new Error('Unsafe connection profile.');
  if (fs.existsSync(filename) && fs.statSync(filename).size <= 32768 && fs.readFileSync(filename, 'utf8') === content) return filename;
  atomicWrite(filename, content);
  return filename;
}
