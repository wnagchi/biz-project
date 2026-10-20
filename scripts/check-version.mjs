import fs from 'node:fs';
import { parseArgs } from 'node:util';

function validVersion(value) {
  if (typeof value !== 'string') return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  return Boolean(match && (!match[4] || match[4].split('.').every(part => !/^0\d+$/.test(part))));
}

try {
  const { values } = parseArgs({ options: { tag: { type: 'string' } } });
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const version = pkg.version;
  if (!validVersion(version)) throw new Error('package.json version must be valid SemVer without a v prefix.');
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('package-lock.json root and package versions must match package.json.');
  }
  const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  const entries = [...changelog.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\r?$/gm)];
  if (entries[0]?.[1] !== version) throw new Error('Current version must be the first dated entry in CHANGELOG.md.');
  const seen = new Set();
  for (const [, entry, date] of entries) {
    if (!validVersion(entry)) throw new Error('CHANGELOG.md contains an invalid SemVer entry.');
    if (seen.has(entry)) throw new Error(`CHANGELOG.md contains duplicate version ${entry}.`);
    seen.add(entry);
    const timestamp = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0, 10) !== date) {
      throw new Error(`CHANGELOG.md contains an invalid release date for ${entry}.`);
    }
  }
  const date = entries[0][2];
  let notes;
  try { notes = fs.readFileSync(`docs/releases/v${version}.md`, 'utf8'); }
  catch { throw new Error(`Missing release notes: docs/releases/v${version}.md.`); }
  const lines = notes.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== `# v${version}` || !lines.includes(`发布日期：${date}`)) {
    throw new Error('Current release notes heading and date must match the changelog.');
  }
  const tags = [values.tag, ...(process.env.GITHUB_REF_TYPE === 'tag' ? [process.env.GITHUB_REF_NAME || ''] : [])];
  for (const tag of tags) {
    if (tag !== undefined && tag !== `v${version}`) throw new Error(`Release tag must be v${version}.`);
  }
  console.log(`Version check passed: v${version} (${date}).`);
} catch (error) {
  console.error(`Version check failed: ${error.message}`);
  process.exitCode = 1;
}
