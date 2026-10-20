import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectRecordsCenter, initializeProject, setParticipation, stripDevelopmentRules, stripInvocation } from './projects.mjs';
import { declined } from './participation.mjs';
import { contained, isInside, readJson, loadRegistry, validateId, atomicWrite, jsonText, publishOnce, withLock } from './storage.mjs';

const statuses = new Set(['planned', 'developing', 'blocked', 'verified', 'integrated', 'released', 'archived']);
export const recordError = (message, status = 400, code = 'INVALID_RECORD') => Object.assign(new Error(message), { status, code });
const hash = (...values) => createHash('sha256').update(values.map(value => `${Buffer.byteLength(value)}:${value}`).join('')).digest('hex');
const target = (root, ...names) => contained(root, path.join(root, ...names));
function textFile(filename) {
  if (!fs.statSync(filename).isFile() || fs.statSync(filename).size > 2 * 1024 * 1024) throw recordError('记录文件无效或超过 2 MiB。');
  const bytes = fs.readFileSync(filename);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
function field(value, name, limit = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || (limit <= 200 && /[\r\n\0]/.test(value))) {
    throw recordError(`${name}不能为空或超出长度限制。`);
  }
  return value;
}
function registry(root) {
  const value = loadRegistry(root);
  if (!value) throw recordError('请先确认并建立记录中心。', 503, 'CENTER_REQUIRED');
  return value;
}
export function openRecords(options = {}) {
  const state = inspectRecordsCenter({ config: options.configFile,
    ...(options.recordsRoot ? { 'records-root': options.recordsRoot } : {}) });
  if (!state.records_root || state.records_root_confirmation_required) throw recordError('请先在本机安装向导确认记录中心。', 503, 'CENTER_REQUIRED');
  registry(state.records_root);
  return state.records_root;
}
function projectFiles(root, id) {
  validateId(id);
  const projects = registry(root).projects;
  const registration = Object.hasOwn(projects, id) ? projects[id] : null;
  if (!registration) throw recordError('项目未登记。', 404, 'NOT_FOUND');
  const directory = target(root, 'projects', id);
  const metadataFile = target(root, 'projects', id, 'project.json');
  const profile = readJson(metadataFile);
  if (profile.schema_version !== 1 || profile.id !== id) throw recordError('项目档案身份不一致。');
  return { directory, metadataFile, documentFile: target(root, 'projects', id, 'README.md'), profile, registration };
}
function featureFiles(root, pid, fid) {
  const project = projectFiles(root, pid); validateId(fid);
  const directory = target(root, 'projects', pid, 'features', fid);
  const metadataFile = target(root, 'projects', pid, 'features', fid, 'feature.json');
  if (!fs.existsSync(metadataFile)) throw recordError('功能不存在。', 404, 'NOT_FOUND');
  const metadata = readJson(metadataFile);
  if (metadata.schema_version !== 1 || metadata.id !== fid || metadata.project_id !== pid) throw recordError('功能记录身份不一致。');
  return { ...project, directory, metadataFile, metadata, documentFile: target(root, 'projects', pid, 'features', fid, 'README.md') };
}
function jsonList(root, folder, maximum = 200) {
  if (!fs.existsSync(folder)) return [];
  const found = [];
  for (const entry of fs.readdirSync(folder).filter(name => !name.startsWith('.') && name.endsWith('.json'))) {
    const filename = contained(root, path.join(folder, entry));
    const value = JSON.parse(textFile(filename));
    found.push(value);
    if (found.length > 10000) throw recordError('历史条目过多，请先归档。');
  }
  return found.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, maximum);
}
function featureRows(root, pid, warnings = []) {
  const folder = target(root, 'projects', pid, 'features');
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.')).slice(0, 2000).flatMap(entry => {
    try {
      const files = featureFiles(root, pid, entry.name);
      const updated = Math.max(fs.statSync(files.documentFile).mtimeMs, fs.statSync(files.metadataFile).mtimeMs);
      return [{ id: files.metadata.id, project_id: pid, project_name: files.profile.name ?? files.registration.name,
        title: files.metadata.title, owner: files.metadata.owner, status: files.metadata.status,
        created_at: typeof files.metadata.created_at === 'string' ? files.metadata.created_at : undefined,
        updated_at: new Date(updated).toISOString() }];
    } catch { warnings.push({ project_id: pid, feature_id: entry.name, message: '功能记录损坏、缺失或路径不安全，已跳过。' }); return []; }
  });
}
export function projectDetail(root, pid) {
  const files = projectFiles(root, pid), overview = textFile(files.documentFile);
  const profileText = textFile(files.metadataFile);
  return { project: { ...files.profile, paths: files.registration.paths, hosts: Object.keys(files.registration.hosts ?? {}) },
    overview, overview_revision: hash(overview), profile_revision: hash(profileText), features: featureRows(root, pid) };
}
export function featureDetail(root, pid, fid) {
  const files = featureFiles(root, pid, fid), document = textFile(files.documentFile), metadataText = textFile(files.metadataFile);
  const updates = jsonList(root, contained(root, path.join(files.directory, 'updates'))).filter(update =>
    update.schema_version === 1 && update.project_id === pid && update.feature_id === fid && typeof update.content === 'string');
  return { feature: { ...files.metadata, project_name: files.profile.name ?? files.registration.name }, document,
    revision: hash(metadataText, document), updates, history: jsonList(root, contained(root, path.join(files.directory, 'history')), 50) };
}
export function dashboard(root, configFile) {
  const projects = [], stopped = [], features = [], activity = [], warnings = [];
  for (const [id, registration] of Object.entries(registry(root).projects).slice(0, 500)) {
    try {
      const files = projectFiles(root, id), rows = featureRows(root, id, warnings);
      const name = files.profile.name ?? registration.name;
      if (configFile && declined(configFile, registration)) { stopped.push({ id, name, paths: registration.paths, feature_count: rows.length }); continue; }
      const statusCounts = new Map();
      for (const row of rows) {
        statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
        try {
          for (const update of featureDetail(root, id, row.id).updates.slice(0, 20)) activity.push({ ...update,
            project_name: row.project_name, feature_title: row.title });
        } catch { warnings.push({ project_id: id, feature_id: row.id, message: '部分进展或历史不可读取。' }); }
      }
      features.push(...rows);
      projects.push({ id, name, paths: registration.paths,
        hosts: Object.keys(registration.hosts ?? {}), feature_count: rows.length, status_counts: Object.fromEntries(statusCounts),
        updated_at: new Date(Math.max(fs.statSync(files.documentFile).mtimeMs, ...rows.map(row => Date.parse(row.updated_at)))).toISOString() });
    } catch { warnings.push({ project_id: id, message: '项目档案缺失、损坏或路径不安全，已跳过。' }); }
  }
  const count = status => features.filter(feature => feature.status === status).length;
  return { projects: projects.sort((a, b) => b.updated_at.localeCompare(a.updated_at)), stopped, features,
    activity: activity.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100), warnings,
    stats: { projects: projects.length, features: features.length, active: count('developing'), blocked: count('blocked'), verified: count('verified'), released: count('released') } };
}
function assertRecovered(root, directory) {
  const folder = contained(root, path.join(directory, 'history'));
  if (fs.existsSync(folder) && fs.readdirSync(folder).some(name => name.endsWith('.pending'))) {
    throw recordError('存在未完成 journal，需要本机恢复后再保存。', 503, 'RECOVERY_REQUIRED');
  }
  return folder;
}
function change(root, directory, files, history) {
  const folder = assertRecovered(root, directory);
  const id = randomUUID(), pending = contained(root, path.join(folder, `.${id}.pending`));
  const journal = { id, created_at: new Date().toISOString(), ...history,
    files: files.map(file => ({ relative: path.relative(root, file.filename), before: fs.readFileSync(file.filename).toString('base64'), after: Buffer.from(file.content).toString('base64') })) };
  if (Buffer.byteLength(jsonText(journal)) > 2 * 1024 * 1024) throw recordError('修改历史超过 2 MiB，请缩短本次记录后重试。', 413, 'HISTORY_TOO_LARGE');
  atomicWrite(pending, jsonText(journal));
  const written = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (fs.readFileSync(file.filename).toString('base64') !== journal.files[index].before) throw recordError('保存期间记录发生变化，请重新加载。', 409, 'REVISION_CONFLICT');
      atomicWrite(file.filename, file.content); written.push(journal.files[index]);
    }
    const final = contained(root, path.join(folder, `${id}.json`));
    fs.renameSync(pending, final);
    return final;
  } catch (cause) {
    try {
      for (const file of written.reverse()) {
        const filename = contained(root, path.join(root, file.relative));
        if (fs.readFileSync(filename).toString('base64') !== file.after) throw new Error('A third party changed the file; do not overwrite it during rollback.');
        atomicWrite(filename, Buffer.from(file.before, 'base64'));
      }
      fs.unlinkSync(pending);
    } catch { throw recordError('保存失败且恢复未完成，journal 已保留。请在本机处理恢复，勿继续覆盖记录。', 503, 'RECOVERY_REQUIRED'); }
    throw cause;
  }
}
export function saveOverview(root, pid, body, actor) {
  field(body.content, '项目约定', 500000);
  return withLock(root, () => {
    const current = projectDetail(root, pid);
    if (body.revision !== current.overview_revision) throw recordError('记录已被修改，草稿未保存。请重新加载后核对。', 409, 'REVISION_CONFLICT');
    const files = projectFiles(root, pid);
    if (body.content !== current.overview) {
    change(root, files.directory, [{ filename: files.documentFile, content: body.content }],
      { kind: 'project-edit', actor, before: { document: current.overview }, after: { document: body.content } });
    }
    return projectDetail(root, pid);
  });
}
function managedDocument(content, metadata) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  let result = content.replace(/^\uFEFF/, '').replace(/^# [^\r\n]*$/m, () => `# ${metadata.title}`);
  if (!/^# /m.test(result)) result = `# ${metadata.title}${newline}${newline}${result}`;
  const values = { 'Feature ID': metadata.id, Owner: metadata.owner, Status: metadata.status };
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}: [^\\r\\n]*$`, 'm');
    result = pattern.test(result) ? result.replace(pattern, () => `${key}: ${value}`) : result.replace(/^(# [^\r\n]*\r?\n)/, heading => `${heading}${newline}${key}: ${value}${newline}`);
  }
  return bom + result;
}
export function saveFeature(root, pid, fid, body, actor) {
  field(body.title, '功能名称'); field(body.owner, '负责人'); field(body.content, '功能记录', 500000);
  return withLock(root, () => {
    const current = featureDetail(root, pid, fid);
    if (!statuses.has(body.status) && body.status !== current.feature.status) throw recordError('请选择有效的功能状态。');
    if (body.revision !== current.revision) throw recordError('记录已被修改，草稿未保存。请重新加载后核对。', 409, 'REVISION_CONFLICT');
    const files = featureFiles(root, pid, fid), metadata = { ...files.metadata, title: body.title.trim(), owner: body.owner.trim(), status: body.status };
    const document = managedDocument(body.content, metadata);
    if (document !== current.document || jsonText(metadata) !== fs.readFileSync(files.metadataFile, 'utf8')) {
    change(root, files.directory, [{ filename: files.documentFile, content: document }, { filename: files.metadataFile, content: jsonText(metadata) }],
      { kind: 'feature-edit', actor, before: { document: current.document, feature: files.metadata }, after: { document, feature: metadata } });
    }
    return featureDetail(root, pid, fid);
  });
}
export function newFeature(root, pid, body, actor) {
  const title = field(body.title, '功能名称').trim(), owner = field(body.owner, '负责人').trim();
  return withLock(root, () => {
    const project = projectFiles(root, pid); assertRecovered(root, project.directory);
    const id = randomUUID(), directory = target(root, 'projects', pid, 'features', id);
    const folder = target(root, 'projects', pid, 'features');
    const staging = contained(root, path.join(folder, `.${id}.new`));
    const metadata = { schema_version: 1, id, project_id: pid, title, owner, status: 'planned', created_at: new Date().toISOString() };
    const document = `# ${title}\n\nFeature ID: ${id}\nOwner: ${owner}\nStatus: planned\n\n## Scope\n\n## Decisions\n\n## Current behavior\n\n## Verification\n\n## Branch synchronization and release evidence\n\n## Next steps\n\n## Agent updates\n`;
    try {
      atomicWrite(contained(root, path.join(staging, 'README.md')), document);
      atomicWrite(contained(root, path.join(staging, 'feature.json')), jsonText(metadata));
      fs.mkdirSync(contained(root, path.join(staging, 'updates')));
      fs.renameSync(staging, directory);
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(contained(folder, staging), { recursive: true });
    }
    return featureDetail(root, pid, id);
  });
}
export function newUpdate(root, pid, fid, body, actor) {
  const agent = field(body.agent, '作者').trim(), content = field(body.content, '进展', 500000);
  return withLock(root, () => {
    const files = featureFiles(root, pid, fid), id = randomUUID();
    assertRecovered(root, files.directory);
    const filename = contained(root, path.join(files.directory, 'updates', `${id}.json`));
    publishOnce(filename, jsonText({ schema_version: 1,
      id, project_id: pid, feature_id: fid, agent, content, created_at: new Date().toISOString(), source: actor }));
    return featureDetail(root, pid, fid);
  });
}
export function searchRecords(root, query, configFile) {
  if (typeof query !== 'string' || query.length > 200) throw recordError('搜索词不能超过 200 字符。');
  const term = query.trim().toLowerCase(), results = [];
  if (!term) return { results };
  const add = (content, value) => {
    const index = content.toLowerCase().indexOf(term);
    if (index >= 0 && results.length < 100) results.push({ ...value, excerpt: content.slice(Math.max(0, index - 50), index + 150) });
  };
  const data = dashboard(root, configFile);
  for (const project of data.projects) {
    const detail = projectDetail(root, project.id);
    add(`${project.name}\n${detail.overview}`, { project_id: project.id, project_name: project.name, kind: 'project', title: project.name });
    for (const feature of detail.features) {
      try {
        const record = featureDetail(root, project.id, feature.id);
        const base = { project_id: project.id, project_name: project.name, feature_id: feature.id, feature_title: feature.title };
        add(`${feature.title}\n${record.document}`, { ...base, kind: 'feature', title: feature.title });
        for (const update of record.updates) add(update.content, { ...base, kind: 'update', title: `${feature.title} · ${update.agent}` });
      } catch { /* The dashboard already reports damaged records. */ }
    }
  }
  return { results };
}
function retitle(content, name) {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  let result = content.replace(/^\uFEFF/, '').replace(/^# [^\r\n]*$/m, () => `# ${name}`);
  if (!/^# /m.test(result)) result = `# ${name}${newline}${newline}${result}`;
  return bom + result;
}
function recordFailure(error) {
  if (error?.status) throw error;
  throw recordError(error instanceof Error ? error.message : '操作无效。');
}
function livePaths(registration) {
  const paths = [];
  for (const item of registration.paths ?? []) {
    if (typeof item !== 'string' || !item || !fs.existsSync(item)) continue;
    const stat = fs.lstatSync(item);
    if (stat.isSymbolicLink()) throw recordError('项目路径不能是链接。');
    if (stat.isDirectory()) paths.push(item);
  }
  return paths;
}
function projectFile(projectPath, relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 1024 || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw recordError('登记规则路径无效。');
  const filename = path.resolve(projectPath, relative);
  if (!isInside(projectPath, filename)) throw recordError('登记规则路径越界。');
  return filename;
}
function readUtf8(filename) {
  const bytes = fs.readFileSync(filename);
  if (bytes.length > 512 * 1024) throw recordError('规则文件超过 512 KiB，已停止本次操作。');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw recordError('规则文件必须是 UTF-8。'); }
}
function ruleFiles(projectPath) {
  const found = []; let count = 0;
  const consider = filename => {
    if (!fs.existsSync(filename)) return;
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) throw recordError('规则路径不能包含链接。');
    if (!stat.isFile()) return;
    count += 1;
    if (count > 50) throw recordError('项目规则目录超过 50 项，已停止本次操作。');
    if (readUtf8(filename).includes('<!-- biz-project:rules:start -->')) found.push(filename);
  };
  for (const name of ['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.github/copilot-instructions.md']) consider(path.join(projectPath, name));
  const walk = (dir, depth) => {
    if (!fs.existsSync(dir)) return;
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink()) throw recordError('规则路径不能包含链接。');
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw recordError('规则路径不能包含链接。');
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth >= 2) throw recordError('规则目录嵌套超过上限。'); walk(filename, depth + 1); }
      else if (entry.isFile() && /\.(md|mdc)$/.test(entry.name)) consider(filename);
    }
  };
  walk(path.join(projectPath, '.cursor/rules'), 0); walk(path.join(projectPath, '.claude/rules'), 0);
  return found;
}
function guidanceEdits(paths, registration, removeRules) {
  const jobs = new Map();
  const mark = (filename, kind) => { const job = jobs.get(filename) ?? { invocation: false, rules: false }; job[kind] = true; jobs.set(filename, job); };
  for (const projectPath of paths) {
    const relatives = new Set();
    for (const hook of Object.values(registration.hosts ?? {})) if (hook && typeof hook.rules_file === 'string') relatives.add(hook.rules_file);
    if (typeof registration.rules_file === 'string') relatives.add(registration.rules_file);
    for (const relative of relatives) {
      const filename = projectFile(projectPath, relative);
      if (!fs.existsSync(filename)) continue;
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink() || !stat.isFile()) throw recordError('登记规则文件无效。');
      mark(filename, 'invocation');
    }
    if (removeRules) for (const filename of ruleFiles(projectPath)) mark(filename, 'rules');
  }
  const writes = [];
  for (const [filename, job] of jobs) {
    const text = readUtf8(filename);
    try {
      let next = text;
      if (job.invocation) next = stripInvocation(next);
      if (job.rules) next = stripDevelopmentRules(next);
      if (next !== text) writes.push({ filename, content: next });
    } catch (error) { recordFailure(error); }
  }
  return writes;
}
function decline(configFile, projectPath, root) {
  if (!configFile) throw recordError('请先确认本机配置。', 503, 'CENTER_REQUIRED');
  setParticipation({ project: projectPath, config: configFile, decision: 'no', 'records-root': root });
}
export function renameProject(root, pid, body) {
  const name = field(body.name, '项目名称').trim();
  return withLock(root, () => {
    const current = projectDetail(root, pid);
    if (body.profile_revision !== current.profile_revision) throw recordError('记录已被修改，草稿未保存。请重新加载后核对。', 409, 'REVISION_CONFLICT');
    const files = projectFiles(root, pid), profile = { ...files.profile, name }, overview = retitle(current.overview, name);
    const profileText = jsonText(profile), currentProfile = fs.readFileSync(files.metadataFile, 'utf8');
    if (profileText !== currentProfile || overview !== current.overview) {
      change(root, files.directory, [{ filename: files.documentFile, content: overview }, { filename: files.metadataFile, content: profileText }],
        { kind: 'project-rename', actor: 'browser-local', before: { name: current.project.name }, after: { name } });
    }
    const stored = loadRegistry(root);
    stored.projects[pid] = { ...stored.projects[pid], name };
    atomicWrite(path.join(root, 'registry.json'), jsonText(stored));
    return projectDetail(root, pid);
  });
}
export function projectRules(root, pid) {
  const files = projectFiles(root, pid), rule_files = [];
  for (const projectPath of livePaths(files.registration)) {
    for (const filename of ruleFiles(projectPath)) rule_files.push(path.relative(projectPath, filename).split(path.sep).join('/'));
  }
  return { rule_files };
}
export function stopProject(root, pid, configFile) {
  return withLock(root, () => {
    const files = projectFiles(root, pid), paths = livePaths(files.registration);
    if (!paths.length) throw recordError('项目目录不存在，无法停止管理。');
    for (const write of guidanceEdits(paths, files.registration, false)) atomicWrite(write.filename, write.content);
    decline(configFile, paths[0], root);
    return { stopped: true, id: pid };
  });
}
export function resumeProject(root, pid, configFile) {
  if (!configFile) throw recordError('请先确认本机配置。', 503, 'CENTER_REQUIRED');
  const files = projectFiles(root, pid), paths = livePaths(files.registration);
  if (!paths.length) throw recordError('项目目录不存在，无法重新管理。');
  const hosts = Object.keys(files.registration.hosts ?? {}).filter(host => ['codex', 'cursor', 'generic'].includes(host));
  const selected = hosts.length ? hosts : ['codex'];
  for (const projectPath of paths) {
    setParticipation({ project: projectPath, config: configFile, decision: 'yes', 'records-root': root });
    for (const host of selected) {
      const options = { project: projectPath, config: configFile, 'records-root': root, host, 'join-confirmed': true };
      if (host === 'generic') options['rules-file'] = files.registration.hosts?.generic?.rules_file;
      initializeProject(options);
    }
  }
  return { resumed: true, id: pid };
}
export function deleteProject(root, pid, body, configFile) {
  if (body?.confirm !== true) throw recordError('请确认删除记录。');
  if (typeof body.remove_rules !== 'boolean') throw recordError('请明确是否删除开发规则。');
  return withLock(root, () => {
    const files = projectFiles(root, pid); assertRecovered(root, files.directory);
    const paths = livePaths(files.registration);
    for (const write of guidanceEdits(paths, files.registration, body.remove_rules)) atomicWrite(write.filename, write.content);
    if (paths.length) decline(configFile, paths[0], root);
    const stored = loadRegistry(root); delete stored.projects[pid];
    atomicWrite(path.join(root, 'registry.json'), jsonText(stored));
    fs.rmSync(files.directory, { recursive: true });
    return { deleted: true, id: pid };
  });
}
