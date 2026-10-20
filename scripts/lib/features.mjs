import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, contained, fail, jsonText, publishOnce, readJson, validateId, withLock } from './storage.mjs';
import { requireProject } from './projects.mjs';

function requiredText(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || !value.trim()) fail(`--${name} must be nonempty.`);
  if (['title', 'owner', 'agent'].includes(name) && (value.length > 200 || /[\r\n\0]/.test(value))) fail(`--${name} must be a single line of at most 200 characters.`);
  return value;
}

export function createFeature(options) {
  const state = requireProject(options);
  const title = requiredText(options, 'title');
  const owner = requiredText(options, 'owner');
  const id = validateId(options['feature-id'] ?? randomUUID());
  const directory = contained(state.records_root, path.join(state.project_directory, 'features', id));
  return withLock(state.records_root, () => {
    if (fs.existsSync(directory)) fail(`Feature already exists: ${id}. Read its record instead of creating a duplicate.`);
    const metadata = { schema_version: 1, id, project_id: state.project_id, title, owner,
      status: 'planned', created_at: new Date().toISOString() };
    atomicWrite(path.join(directory, 'feature.json'), jsonText(metadata));
    atomicWrite(path.join(directory, 'README.md'), `# ${title}\n\nFeature ID: ${id}\nOwner: ${owner}\nStatus: planned\n\n## Scope\n\n## Decisions\n\n## Work allocation\n\n## Current behavior\n\n## Verification\n\n## Branch synchronization and release evidence\n\n## Next steps\n\n## Agent updates\n\nRead complete JSON files in updates/; consolidate verified results into this document.\n`);
    fs.mkdirSync(path.join(directory, 'updates'));
    return { project_id: state.project_id, feature_id: id, feature_directory: directory };
  });
}

export function addUpdate(options) {
  const state = requireProject(options);
  const featureId = validateId(requiredText(options, 'feature'));
  const agent = requiredText(options, 'agent');
  const id = validateId(options['update-id'] ?? randomUUID());
  const directory = contained(state.records_root, path.join(state.project_directory, 'features', featureId));
  const metadata = readJson(contained(state.records_root, path.join(directory, 'feature.json')));
  if (metadata.schema_version !== 1 || metadata.id !== featureId || metadata.project_id !== state.project_id) {
    fail('Feature identity does not match the registered project.');
  }
  const content = fs.readFileSync(requiredText(options, 'body-file'), 'utf8');
  if (!content.trim()) fail('Update content must be nonempty.');
  const filename = contained(state.records_root, path.join(directory, 'updates', `${id}.json`));
  const update = { schema_version: 1, id, project_id: state.project_id, feature_id: featureId,
    agent, content, created_at: new Date().toISOString() };
  if (Buffer.byteLength(jsonText(update)) > 2 * 1024 * 1024) fail('Update record exceeds 2 MiB.');
  return withLock(state.records_root, () => {
  const created = publishOnce(filename, jsonText(update));
  if (!created) {
    const existing = readJson(filename);
    for (const field of ['schema_version', 'id', 'project_id', 'feature_id', 'agent', 'content']) {
      if (existing[field] !== update[field]) fail(`Update ID ${id} already has different content; existing evidence preserved.`);
    }
  }
  return { project_id: state.project_id, feature_id: featureId, update_id: id, update_file: filename, created };
  });
}
