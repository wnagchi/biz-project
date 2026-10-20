// Check publication candidates locally. Findings never include matched content.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const privatePaths = [
  /(^|\/)(?:node_modules|\.biz-project|\.project-records|\.biz-project-history|records|services|private|coverage|test-results|playwright-report|screenshots)(\/|$)/i,
  /^docs\/(?:superpowers\/|plans\/|verification\.md$)/i,
  /^web\/build\//i,
  /(^|\/)(?:AGENTS\.override\.md|biz-project\.mdc|project-records\.mdc|\.npmrc|\.netrc|\.DS_Store|Thumbs\.db)$/i,
  /(^|\/)(?:config(?:\.local)?|project-preferences|registry|credentials|secrets|policy|runtime)\.json$/i,
  /(^|\/)\.env(?:\.(?!(?:example|sample|template)$).*)?$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore|sqlite3?|db|log|bak|tgz|zip|7z)$/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i
];
const patterns = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['API token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['personal home path', /(?:[A-Z]:[\\/]Users[\\/](?!Public\b|Default\b)[^\s<>"'`/\\]+[\\/]|\/(?:Users|home)\/(?!example\b|user\b|username\b)[^\s<>"'`/]+\/)/i],
  ['credential in URL', /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@/i]
];
const limit = 5 * 1024 * 1024;

function git(...args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, windowsHide: true });
}

try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--staged')) throw new Error('Usage: node scripts/check-privacy.mjs [--staged]');
  const staged = args.includes('--staged');
  let root;
  try { root = git('rev-parse', '--show-toplevel').toString().trim(); }
  catch { throw new Error('Run this check inside a Git repository (Git must be installed).'); }
  process.chdir(root);
  const files = [...new Set(git('ls-files', '-z', '--cached', ...(staged ? [] : ['--others', '--exclude-standard'])).toString().split('\0').filter(Boolean))].sort();
  const modes = new Map(git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t');
    return [row.slice(tab + 1), row.slice(0, 6)];
  }));
  const findings = [];
  let checked = 0;
  for (const file of files) {
    const report = (kind, line) => findings.push(`${kind}: ${JSON.stringify(file)}${line ? `:${line}` : ''}`);
    if (privatePaths.some(rule => rule.test(file))) {
      report('private file');
      continue;
    }
    const absolute = path.resolve(root, file);
    if (staged && ['120000', '160000'].includes(modes.get(file))) {
      report('symlink or submodule requires manual review');
      continue;
    }
    let bytes;
    try {
      if (staged) bytes = git('show', `:${file}`);
      else {
        let current = root;
        let linked = false;
        for (const part of file.split('/')) {
          current = path.join(current, part);
          if (fs.lstatSync(current).isSymbolicLink()) { linked = true; break; }
        }
        if (linked) { report('symlink requires manual review'); continue; }
        if (fs.statSync(absolute).size > limit) { report('file exceeds scan limit'); continue; }
        bytes = fs.readFileSync(absolute);
      }
    } catch (error) {
      if (!staged && error.code === 'ENOENT') continue; // Deleted working-tree file.
      report('unable to inspect file');
      continue;
    }
    if (bytes.length > limit) { report('file exceeds scan limit'); continue; }
    checked++;
    if (bytes.includes(0)) continue; // Binary assets still receive the filename checks above.
    const lines = bytes.toString('utf8').split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
      for (const [label, pattern] of patterns) if (pattern.test(lines[line])) report(label, line + 1);
    }
  }
  if (findings.length) {
    console.error(`Privacy check blocked ${findings.length} finding(s):\n${findings.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Privacy check: checked ${checked} ${staged ? 'index' : 'working-tree'} files; no known patterns found.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
