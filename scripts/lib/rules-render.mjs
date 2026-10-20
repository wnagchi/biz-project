export const DOMAINS = ['lifecycle', 'development', 'verification', 'release', 'collaboration'];
export function rulesError(message, status = 400, code = 'RULES_INVALID') { return Object.assign(new Error(message), { status, code }); }
export const check = (condition, message, status) => { if (!condition) throw rulesError(message, status); };
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const tokens = /\{\{([a-z][a-z0-9_]{0,63})\}\}/g;
export function moduleFields(input) {
  check(DOMAINS.includes(input.domain), '请选择有效的规则领域。');
  check(typeof input.body === 'string' && Buffer.byteLength(input.body) <= 65536, '规则正文不能超过 64 KiB 上限。');
  check(!/<!--\s*(?:biz-project|project-records):(?:start|end)\s*-->/.test(input.body), '模板不能包含项目登记调用入口。');
  check(Array.isArray(input.variables) && input.variables.length <= 32, '参数声明必须是最多 32 项的数组。');
  const seen = new Set(), variables = input.variables.map(v => {
    check(object(v) && /^[a-z][a-z0-9_]{0,63}$/.test(v.name) && !seen.has(v.name)
      && typeof v.required === 'boolean' && (v.label === undefined || typeof v.label === 'string' && v.label.length <= 200), '参数 variable 声明无效或重复。');
    seen.add(v.name); return { name: v.name, label: v.label ?? v.name, required: v.required };
  });
  const stripped = input.body.replace(tokens, (_match, name) => { check(seen.has(name), `未声明占位符 placeholder：${name}`); return ''; });
  check(!/\{\{|\}\}/.test(stripped), '占位符 placeholder 格式无效。');
  return { domain: input.domain, body: input.body, variables };
}
export function resolveScheme(library, scheme, allowArchived = false) {
  check(object(scheme.modules) && Object.keys(scheme.modules).every(d => DOMAINS.includes(d)), '方案规则领域 domain 无效。');
  check(DOMAINS.slice(0, 4).every(d => typeof scheme.modules[d] === 'string'), '方案必须包含四个必选领域 domain。');
  check(allowArchived || !scheme.archived, '方案已归档，不能新应用。');
  const modules = [], declarations = new Map();
  for (const domain of DOMAINS) {
    if (!scheme.modules[domain]) continue;
    const module = library.raw('modules', scheme.modules[domain]);
    check(module.domain === domain, `模块领域 domain 不匹配：${domain}`);
    check(allowArchived || !module.archived, `模块已归档：${module.title}`);
    modules.push(module);
    for (const v of module.variables) { check(!declarations.has(v.name) || JSON.stringify(declarations.get(v.name)) === JSON.stringify(v), `同名参数声明不一致：${v.name}`); declarations.set(v.name, v); }
  }
  const variables = [...declarations.values()];
  check(object(scheme.defaults ?? {}) && Object.entries(scheme.defaults ?? {}).every(([k, v]) => declarations.has(k) && typeof v === 'string'), '方案默认参数无效或未知。');
  return { modules, variables };
}
export function renderScheme(library, schemeId, params) {
  const scheme = library.raw('schemes', schemeId), { modules, variables } = resolveScheme(library, scheme);
  check(object(params) && Object.keys(params).every(k => variables.some(v => v.name === k)), '存在未知 unknown 项目参数。');
  for (const v of variables) check((params[v.name] === undefined && !v.required) || typeof params[v.name] === 'string'
    && (!v.required || params[v.name].trim()) && Buffer.byteLength(params[v.name]) <= 65536, `必填参数或参数值无效：${v.name}`);
  const content = modules.map(m => `## ${m.title}\n\n${m.body.replace(tokens, (_match, name) => params[name] ?? '')}`).join('\n\n');
  check(!/\{\{|\}\}/.test(content), '生成内容仍包含占位符。');
  check(Buffer.byteLength(content) <= 320 * 1024, '生成规则超过 320 KiB 上限。');
  return { content, variables, scheme: { id: scheme.id, title: scheme.title, revision: scheme.revision },
    module_revisions: Object.fromEntries(modules.map(m => [m.id, m.revision])), params: { ...params } };
}
