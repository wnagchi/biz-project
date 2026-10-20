import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite, canonical, isInside, jsonText, sourceDirectory, homeDirectory, validateId, withLock } from './storage.mjs';
import { DOMAINS, check, object, moduleFields, resolveScheme } from './rules-render.mjs';
export const hash = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
export function noLinks(filename) {
  let current = path.resolve(filename);
  while (true) { try { check(!fs.lstatSync(current).isSymbolicLink(), '路径不能包含符号链接 link。'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(current); if (parent === current) return; current = parent; }
}
export function boundedJson(filename, max = 1024 * 1024) {
  noLinks(filename); const stat = fs.statSync(filename); check(stat.isFile() && stat.size <= max, 'JSON 文件不安全或超过上限。');
  let value; try { value = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); } catch { check(false, 'JSON 文件损坏，请人工核对，不会覆盖。'); }
  check(object(value), 'JSON 数据必须是对象。'); return value;
}
function validateCatalog(value) {
  check(value.kind === 'biz-project-rules-library' && value.schema_version === 1 && object(value.modules) && object(value.schemes), '模板库格式无效。');
  for (const kind of ['modules', 'schemes']) {
    check(Object.keys(value[kind]).length <= (kind === 'modules' ? 200 : 100), '模板库数量超过上限。');
    for (const [id, item] of Object.entries(value[kind])) {
      validateId(id); check(object(item) && item.id === id && Number.isSafeInteger(item.revision) && item.revision > 0
        && typeof item.title === 'string' && item.title.trim() && item.title.length <= 200 && typeof item.archived === 'boolean'
        && typeof item.hash === 'string' && /^[a-f0-9]{64}$/.test(item.hash), '模板索引损坏。');
    }
  }
  return value;
}
export function createRulesLibrary(options = {}) {
  const configFile = path.resolve(options.configFile ?? path.join(homeDirectory, '.config/biz-project/config.json'));
  const pointer = path.join(path.dirname(configFile), 'rules-library.json');
  function assertRoot(input) {
    noLinks(pointer); noLinks(configFile);
    check(!isInside(sourceDirectory, pointer) && !isInside(sourceDirectory, configFile), '私人配置指针必须在源码工程外部。');
    check((process.platform === 'win32' ? pointer.toLowerCase() !== configFile.toLowerCase() : pointer !== configFile), '模板库指针不能替换记录配置。');
    check(typeof input === 'string' && input.trim() && path.isAbsolute(input), '请选择明确的模板库绝对路径。'); noLinks(input);
    const root = canonical(input);
    check(!isInside(root, pointer) && !isInside(root, configFile), '模板库不能包含配置指针 pointer。');
    check(!isInside(sourceDirectory, root) && !isInside(root, sourceDirectory), '模板库必须在源码工程 source 外部。');
    let recordsRoot = options.recordsRoot;
    if (!recordsRoot && fs.existsSync(configFile)) { try { recordsRoot = boundedJson(configFile).records_root; } catch { /* An unrelated broken center does not disable a library. */ } }
    if (typeof recordsRoot === 'string') {
      check(!isInside(recordsRoot, pointer) && !isInside(recordsRoot, configFile), '私人配置指针必须在记录中心外部。');
      check(!isInside(recordsRoot, root) && !isInside(root, recordsRoot), '模板库必须与记录中心分开。');
    }
    for (let current = root; ; current = path.dirname(current)) {
      check(!fs.existsSync(path.join(current, '.git')) && !fs.existsSync(path.join(current, 'package.json')), '模板库不能位于业务项目目录。');
      if (fs.existsSync(path.join(current, 'registry.json'))) { const r = boundedJson(path.join(current, 'registry.json')); check(!['biz-project', 'project-records'].includes(r.kind), '模板库不能位于记录中心。'); }
      if (path.dirname(current) === current) break;
    }
    return root;
  }
  function location() {
    noLinks(pointer); if (!fs.existsSync(pointer)) return null;
    const p = boundedJson(pointer, 8192); check(p.kind === 'biz-project-rules-pointer' && p.schema_version === 1, '模板库指针无效。'); return assertRoot(p.root);
  }
  function safe(relative) {
    const root = location(); check(root, '请先明确确认模板库路径。');
    check(typeof relative === 'string' && relative.split('/').every(p => p && p !== '.' && p !== '..' && !/[\\:]/.test(p)), '模板文件路径无效。');
    const file = path.join(root, ...relative.split('/')); noLinks(file); return file;
  }
  function catalog() {
    const root = location(); check(root, '请先明确确认模板库路径。');
    check(!fs.existsSync(safe('.pending.json')), '模板库有未完成写入，请先人工核对。', 409);
    return validateCatalog(boundedJson(safe('library.json')));
  }
  function raw(kind, id) {
    check(['modules', 'schemes'].includes(kind), '模板类型无效。'); validateId(id); const c = catalog();
    check(Object.hasOwn(c[kind], id), '没有此模板。', 404); const file = safe(`${kind}/${id}.json`);
    check(fs.statSync(file).size <= 512 * 1024, '模板文件超过上限。'); const bytes = fs.readFileSync(file);
    check(bytes.length <= 512 * 1024 && hash(bytes) === c[kind][id].hash, '模板文件与索引不一致，请人工核对。', 409);
    const value = boundedJson(file, 512 * 1024); check(value.kind === `biz-project-rule-${kind === 'modules' ? 'module' : 'scheme'}` && value.schema_version === 1
      && value.id === id && value.revision === c[kind][id].revision, '模板数据身份不一致。');
    if (kind === 'modules') moduleFields(value); return value;
  }
  const library = { raw, safe,
    context(project) {
      let recordsRoot = options.recordsRoot; const guidance = [];
      try {
        if (!recordsRoot && fs.existsSync(configFile)) recordsRoot = boundedJson(configFile).records_root;
        if (!recordsRoot || !fs.existsSync(path.join(recordsRoot, 'registry.json'))) return { guidance, requires_merge: false };
        const registry = boundedJson(path.join(recordsRoot, 'registry.json'));
        check(['biz-project', 'project-records'].includes(registry.kind) && object(registry.projects), '记录上下文不可识别。');
        const same = value => { const a = canonical(value), b = canonical(project); return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; };
        const entry = Object.entries(registry.projects).find(([, p]) => Array.isArray(p.paths) && p.paths.some(same));
        if (!entry) return { guidance, requires_merge: false };
        validateId(entry[0]); const folder = path.join(recordsRoot, 'projects', entry[0]), filename = path.join(folder, 'project.json');
        const profile = boundedJson(filename, 512 * 1024);
        for (const file of [filename, path.join(folder, 'README.md')]) {
          noLinks(file); if (!fs.existsSync(file)) continue; check(fs.statSync(file).size <= 512 * 1024, '项目约定上下文过大。');
          const bytes = fs.readFileSync(file); new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          guidance.push({ path: file, scope: 'record-context', editable: false, content: bytes.toString('utf8'), base_hash: hash(bytes) });
        }
        return { guidance, requires_merge: ['development_branch', 'release_branch', 'release_criterion', 'delegation_policy'].some(k => typeof profile[k] === 'string' && profile[k].trim())
          || Array.isArray(profile.verification_commands) && profile.verification_commands.length > 0 };
      } catch { return { guidance, requires_merge: true, warning: '项目记录上下文无法完整读取，需要当前 Agent 补充核对；平台不会改写档案。' }; }
    },
    list(kind, offset = 0) { check(['modules', 'schemes'].includes(kind) && Number.isInteger(offset) && offset >= 0 && offset <= 200, '分页 offset 无效。');
      const items = Object.values(catalog()[kind]).sort((a, b) => a.title.localeCompare(b.title)).map(({ hash: _hash, ...item }) => item);
      return { items: items.slice(offset, offset + 50), next_offset: offset + 50 < items.length ? offset + 50 : null, total: items.length }; },
    state() { const root = location(); if (!root) return { configured: false, root: null, pointer, domains: DOMAINS, modules: [], schemes: [], module_total: 0, scheme_total: 0, next_modules: null, next_schemes: null };
      const m = library.list('modules'), s = library.list('schemes'); return { configured: true, root, pointer, domains: DOMAINS,
        modules: m.items, schemes: s.items, module_total: m.total, scheme_total: s.total, next_modules: m.next_offset, next_schemes: s.next_offset }; },
    get(kind, id) { const value = raw(kind, id); return kind === 'schemes' ? { ...value, variables: resolveScheme(library, value, true).variables } : value; },
    confirm(input) {
      check(input.confirmed === true, '需要使用者明确确认 confirm 模板库路径。'); const root = assertRoot(input.root);
      if (fs.existsSync(root)) { check(fs.statSync(root).isDirectory(), '模板库必须是目录。');
        check(!fs.readdirSync(root).length || fs.existsSync(path.join(root, 'library.json')), '模板库目录非空且包含无关 unrelated 数据。');
        if (fs.existsSync(path.join(root, 'library.json'))) {
          validateCatalog(boundedJson(path.join(root, 'library.json')));
          check(!fs.existsSync(path.join(root, '.pending.json')), '模板库有未完成写入，请先人工核对。', 409);
        } }
      fs.mkdirSync(root, { recursive: true });
      if (!fs.existsSync(path.join(root, 'library.json'))) atomicWrite(path.join(root, 'library.json'), jsonText({ kind: 'biz-project-rules-library', schema_version: 1, modules: {}, schemes: {} }));
      atomicWrite(pointer, jsonText({ kind: 'biz-project-rules-pointer', schema_version: 1, root })); return library.state();
    },
    save(kind, input) {
      check(['modules', 'schemes'].includes(kind) && object(input), '模板类型或数据无效。'); validateId(input.id);
      check(typeof input.title === 'string' && input.title.trim() && input.title.length <= 200, '请填写最多 200 字的模板名称。');
      check(input.archived === undefined || typeof input.archived === 'boolean', '归档状态无效。');
      const fields = kind === 'modules' ? moduleFields(input) : (() => { resolveScheme(library, input, input.archived === true); return { modules: { ...input.modules }, defaults: { ...(input.defaults ?? {}) } }; })();
      const root = location(); check(root, '请先确认模板库。'); noLinks(path.join(root, '.write.lock'));
      return withLock(root, () => {
        const c = catalog(), old = Object.hasOwn(c[kind], input.id) ? raw(kind, input.id) : null;
        check(Number.isSafeInteger(input.revision) && input.revision === (old?.revision ?? 0), '模板修订 revision 已变化，请重新读取。', 409);
        check(old || Object.keys(c[kind]).length < (kind === 'modules' ? 200 : 100), '模板数量超过上限。');
        if (old && kind === 'modules') check(old.domain === input.domain, '已保存模块不能改领域，请复制为新模块。');
        const file = safe(`${kind}/${input.id}.json`); check(old || !fs.existsSync(file), '存在未登记模板文件，请人工核对。', 409);
        const value = { ...old, kind: `biz-project-rule-${kind === 'modules' ? 'module' : 'scheme'}`, schema_version: 1,
          id: input.id, title: input.title.trim(), ...fields, revision: (old?.revision ?? 0) + 1, archived: input.archived ?? false };
        const bytes = jsonText(value), summary = { id: value.id, title: value.title, revision: value.revision, archived: value.archived, hash: hash(bytes), ...(kind === 'modules' ? { domain: value.domain } : {}) };
        atomicWrite(safe('.pending.json'), jsonText({ kind, id: input.id, revision: value.revision }));
        atomicWrite(file, bytes); c[kind][input.id] = summary; atomicWrite(safe('library.json'), jsonText(c)); fs.unlinkSync(safe('.pending.json')); return value;
      });
    }
  }; return library;
}
