import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRulesLibrary } from '../../scripts/lib/rules-library.mjs';
export function rulesFixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-rules-fixture-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'library'), project = path.join(base, 'project'), configFile = path.join(base, 'private/config.json'); fs.mkdirSync(project);
  const library = createRulesLibrary({ configFile }); library.confirm({ root, confirmed: true });
  const domains = ['lifecycle', 'development', 'verification', 'release'];
  for (const domain of domains) library.save('modules', { id: domain, domain, title: domain, revision: 0,
    body: domain === 'release' ? 'Publish after {{criterion}}.' : `# ${domain}`, variables: domain === 'release' ? [{ name: 'criterion', label: 'Criterion', required: true }] : [] });
  library.save('schemes', { id: 'standard', title: 'Standard', revision: 0, modules: Object.fromEntries(domains.map(d => [d, d])), defaults: {} });
  return { base, root, project, configFile, library, input: { project, scheme_id: 'standard', hosts: ['codex'], params: { criterion: 'verified deployment' } } };
}
