import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-snapshots-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'records'), relative = 'projects/one/README.md';
  fs.mkdirSync(path.join(root, 'projects/one/features/first/updates'), { recursive: true });
  fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({ kind: 'biz-project', schema_version: 1,
    projects: { one: { identity: `directory:${base}`, paths: [base] } } }));
  fs.writeFileSync(path.join(root, 'projects/one/project.json'), JSON.stringify({ schema_version: 1, id: 'one' }));
  fs.writeFileSync(path.join(root, relative), '# Original\n');
  fs.writeFileSync(path.join(root, 'projects/one/features/first/feature.json'), JSON.stringify({ schema_version: 1, id: 'first', project_id: 'one' }));
  fs.writeFileSync(path.join(root, 'projects/one/features/first/README.md'), '# Feature\n');
  return { base, root, relative, filename: path.join(root, relative) };
}
