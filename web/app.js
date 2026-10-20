const $ = selector => document.querySelector(selector);
const origin = location.origin;
const token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('biz-token');
if (token) { sessionStorage.setItem('biz-token', token); history.replaceState(null, '', '/'); }
const state = { step: 0, unlocked: 0, config: null, root: null, rootConfirmed: false,
  selected: new Map(), candidates: [], parent: null, hosts: ['codex', 'cursor'], filter: '',
  plan: null, result: null, busy: false, checked: false, statuses: new Map() };
const names = ['记录中心', '项目与工具', '确认修改', '安装结果'];
let managementTarget = null;
const labels = { initialize: '待接入', skip: '已接入', blocked: '有冲突', initialized: '接入完成', skipped: '已接入', failed: '失败' };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}
function icon(name, spinning = false) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('aria-hidden', 'true');
  if (spinning) node.classList.add('spin');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons.svg#${name}`); node.append(use); return node;
}
function button(text, action, kind = 'secondary', glyph) {
  return el('button', { class: kind, onClick: action, disabled: state.busy }, glyph ? icon(glyph) : null, text);
}
function badge(text, type = '') { return el('span', { class: `badge ${type}` }, text); }
const basename = value => value.split(/[\\/]/).filter(Boolean).at(-1) || value;
const join = (parent, name) => parent.replace(/[\\/]$/, '') + (parent.includes('\\') ? '\\' : '/') + name;

async function api(route, body) {
  const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Biz-Token': token ?? '', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败。');
  return result;
}
function showError(error) { const box = $('#global-error'); box.textContent = error.message; box.hidden = false; }
async function work(action) {
  if (state.busy) return;
  state.busy = true; $('#global-error').hidden = true; render();
  try { await action(); } catch (error) { showError(error); }
  finally { state.busy = false; render(); }
}
async function invalidate() {
  if (state.plan) { const id = state.plan.plan_id; state.plan = null; await api('/api/cancel', { plan_id: id }); }
  state.checked = false;
}
async function go(step) {
  if (state.busy || step > state.unlocked) return;
  if (state.result && step !== 3) return;
  if (step < 2) { await invalidate(); state.unlocked = state.rootConfirmed ? 1 : 0; }
  state.step = step; render();
}
function heading(title, subtitle) {
  return [el('p', { class: 'eyebrow' }, `步骤 0${state.step + 1} / 04`), el('h1', {}, title), el('p', { class: 'subtitle' }, subtitle)];
}
function empty(message, glyph = 'folder') { return el('div', { class: 'empty' }, icon(glyph), el('p', {}, message)); }
function setRoot(value) { state.root = value; state.rootConfirmed = false; state.unlocked = 0; render(); }

function centerOption(value, title, type = '', label) {
  const radio = el('input', { type: 'radio', name: 'center', checked: state.root === value,
    onChange: () => setRoot(value), 'aria-label': title });
  return el('label', { class: `center-option ${state.root === value ? 'selected' : ''}` }, radio,
    el('span', { class: 'icon-container' }, icon('database')),
    el('span', { class: 'center-details' }, el('strong', {}, title), el('span', { class: 'path' }, value)),
    label ? badge(label, type) : null);
}
function renderCenter() {
  const cfg = state.config;
  const nodes = heading('确认记录中心', cfg.records_root ? '已发现记录中心，等待确认' : '尚未配置记录中心');
  const candidates = new Set();
  if (cfg.records_root) {
    candidates.add(cfg.records_root);
    nodes.push(centerOption(cfg.records_root, '当前配置', cfg.confirmation_required ? 'warning' : '', cfg.confirmation_required ? '需确认' : '已有配置'));
  }
  for (const center of cfg.legacy_centers) {
    if (candidates.has(center.records_root)) continue;
    candidates.add(center.records_root);
    nodes.push(centerOption(center.records_root, '旧记录中心', 'warning', '不自动迁移'));
  }
  if (state.root && !candidates.has(state.root)) nodes.push(centerOption(state.root, '已选择目录', '', '待确认'));
  if (!candidates.size && !state.root) nodes.push(empty('未选择目录', 'database'));
  nodes.push(el('div', { class: 'toolbar' }, button('选择其他目录', () => openDirectory('center'), 'secondary', 'folder')));
  if (cfg.discovery_error) nodes.push(el('p', { class: 'notice error' }, cfg.discovery_error));
  if (cfg.records_root && state.root && state.root !== cfg.records_root) {
    nodes.push(el('p', { class: 'notice' }, '现有配置指向其他中心。安装前会检查冲突，原指针不会被覆盖。'));
  }
  nodes.push(el('div', { class: 'section-heading' }, icon('file-text'), el('h2', {}, '本机配置')),
    el('dl', { class: 'summary' },
      el('div', {}, el('dt', {}, '配置文件'), el('dd', { class: 'path' }, cfg.config_file)),
      el('div', {}, el('dt', {}, '共享 Skill 入口'), el('dd', { class: 'path' }, cfg.install_target))));
  return nodes;
}

function visibleProjects() {
  const entries = new Map(state.candidates.map(item => [item.path, item]));
  for (const [project] of state.selected) if (!entries.has(project)) entries.set(project, { path: project, name: basename(project), project_hint: true });
  const filter = state.filter.toLowerCase();
  return [...entries.values()].filter(item => `${item.name} ${item.path}`.toLowerCase().includes(filter));
}
function toggleProject(item, checked) {
  if (checked) state.selected.set(item.path, [...state.hosts]);
  else state.selected.delete(item.path);
  state.statuses.clear(); render();
}
function toggleHost(host, enabled) {
  state.hosts = enabled ? [...new Set([...state.hosts, host])] : state.hosts.filter(h => h !== host);
  for (const [project, hosts] of state.selected) {
    state.selected.set(project, enabled ? [...new Set([...hosts, host])] : hosts.filter(h => h !== host));
  }
  state.statuses.clear(); render();
}
function projectRows() {
  const visible = visibleProjects();
  const all = el('input', { type: 'checkbox', 'aria-label': '全选当前列表', checked: visible.length > 0 && visible.every(p => state.selected.has(p.path)),
    onChange: event => { for (const p of visible) { if (event.target.checked) state.selected.set(p.path, [...state.hosts]); else state.selected.delete(p.path); } state.statuses.clear(); render(); } });
  const table = el('table', { class: 'projects-table' }, el('thead', {}, el('tr', {}, el('th', { class: 'selection-column' }, all), el('th', {}, '项目'), el('th', {}, '工具'), el('th', { class: 'status-column' }, '状态'))));
  const body = el('tbody');
  for (const item of visible) {
    const chosen = state.selected.has(item.path), hosts = state.selected.get(item.path) ?? [];
    const choices = el('div', { class: 'host-cell' });
    for (const host of state.hosts) choices.append(el('label', {}, el('input', { type: 'checkbox', checked: chosen && hosts.includes(host), disabled: !chosen,
      'aria-label': `${item.name} ${host === 'codex' ? 'Codex' : 'Cursor'}`,
      onChange: event => { state.selected.set(item.path, event.target.checked ? [...hosts, host] : hosts.filter(h => h !== host)); state.statuses.delete(item.path); render(); } }), host === 'codex' ? 'Codex' : 'Cursor'));
    const statuses = state.statuses.get(item.path);
    const status = el('div', { class: 'status-stack' });
    if (statuses) statuses.forEach(entry => status.append(badge(`${entry.host}: ${labels[entry.action]}`, entry.action === 'blocked' ? 'error' : entry.action === 'skip' ? '' : 'neutral')));
    else status.append(badge(chosen ? '未检查' : item.project_hint ? '项目候选' : '目录', 'neutral'));
    body.append(el('tr', {}, el('td', {}, el('input', { type: 'checkbox', checked: chosen, 'aria-label': `选择 ${item.name}`, onChange: event => toggleProject(item, event.target.checked) })),
      el('td', {}, el('div', { class: 'name' }, item.name), el('div', { class: 'path' }, item.path)), el('td', {}, choices), el('td', {}, status)));
  }
  table.append(body);
  return el('div', { class: 'table-container' }, table);
}
function renderProjects() {
  const nodes = heading('选择项目与工具', state.root);
  nodes.push(el('div', { class: 'section-heading' }, el('h2', {}, '接入工具')));
  const tools = el('div', { class: 'tool-group' });
  for (const host of ['codex', 'cursor']) tools.append(el('label', { class: 'tool-choice' }, el('input', { type: 'checkbox', checked: state.hosts.includes(host),
    'aria-label': `启用 ${host === 'codex' ? 'Codex' : 'Cursor'}`, onChange: event => toggleHost(host, event.target.checked) }), icon(host === 'codex' ? 'terminal' : 'monitor'), host === 'codex' ? 'Codex' : 'Cursor'));
  nodes.push(tools, el('div', { class: 'toolbar' }, el('div', { class: 'toolbar-actions' },
    button('浏览项目父目录', () => openDirectory('parent'), 'secondary', 'folder'), button('添加单个项目', () => openDirectory('project'), 'secondary', 'plus')), el('span', { class: 'selection-count' }, `已选择 ${state.selected.size} 个项目`)));
  if (state.parent) nodes.push(el('p', { class: 'path' }, state.parent));
  const search = el('input', { type: 'search', value: state.filter, placeholder: '搜索项目', 'aria-label': '搜索项目',
    onInput: event => { state.filter = event.target.value; renderProjectList(); } });
  nodes.push(el('div', { class: 'toolbar' }, el('label', { class: 'search-box' }, icon('search'), search),
    button('检查接入状态', () => work(checkProjects), 'link-button', 'refresh-cw')),
    el('div', { id: 'project-list' }, visibleProjects().length ? projectRows() : empty('暂无项目')));
  return nodes;
}
function renderProjectList() { $('#project-list').replaceChildren(visibleProjects().length ? projectRows() : empty('没有匹配的项目')); }
function selection() {
  if (!state.rootConfirmed) throw new Error('请先确认记录中心。');
  if (!state.hosts.length || !state.selected.size) throw new Error('请选择项目及至少一个工具。');
  if ([...state.selected.values()].some(hosts => !hosts.length)) throw new Error('每个选中的项目至少需要一个工具。');
  return { recordsRoot: state.root, projects: [...state.selected.keys()], hosts: state.hosts, projectHosts: Object.fromEntries(state.selected) };
}
async function checkProjects() {
  const plan = await api('/api/preview', selection());
  state.statuses.clear();
  for (const item of plan.items) {
    if (!state.statuses.has(item.project)) state.statuses.set(item.project, []);
    state.statuses.get(item.project).push(item);
  }
  await api('/api/cancel', { plan_id: plan.plan_id });
}
function itemTable(items, result = false) {
  const table = el('table', { class: 'items-table' }, el('thead', {}, el('tr', {}, el('th', {}, '项目 / 工具'), el('th', {}, result ? '结果与文件' : '将修改的文件'), el('th', { class: 'status-column' }, result ? '结果' : '操作'))));
  const body = el('tbody');
  for (const item of items) {
    const status = result ? item.status : item.action;
    const files = el('div', {}, el('div', { class: 'path' }, item.rules_file ?? '未确定规则文件'));
    if (item.error) files.append(el('p', { class: 'notice error' }, item.error));
    if (!result && item.action === 'initialize') files.append(el('details', {}, el('summary', {}, '项目记录'), el('p', { class: 'path' }, item.project_directory ?? `${state.root}/projects/<项目 ID>`), el('p', { class: 'muted' }, item.project_id ? `复用 ID：${item.project_id}` : '创建项目档案与索引；原文档不迁移')));
    body.append(el('tr', {}, el('td', {}, el('div', { class: 'name' }, basename(item.project)), el('div', { class: 'path' }, item.project), badge(item.host === 'codex' ? 'Codex' : 'Cursor', 'neutral')),
      el('td', {}, files), el('td', {}, badge(labels[status] ?? status, ['blocked', 'failed'].includes(status) ? 'error' : ['initialize'].includes(status) ? 'neutral' : ''))));
  }
  table.append(body); return el('div', { class: 'table-container' }, table);
}
function renderPreview() {
  const plan = state.plan;
  if (!plan) return heading('预览已失效', '返回项目选择后重新预览');
  const nodes = heading('确认安装修改', `${new Set(plan.items.map(p => p.project)).size} 个项目 · ${plan.items.length} 个工具入口`);
  nodes.push(el('dl', { class: 'summary' }, el('div', {}, el('dt', {}, '记录中心'), el('dd', { class: 'path' }, plan.records_root)),
    el('div', {}, el('dt', {}, '共享 Skill'), el('dd', { class: 'path' }, plan.installation.target), badge(plan.installation.action === 'skip' ? '已安装，不修改' : '创建目录链接', 'neutral')),
    el('div', {}, el('dt', {}, '登记文件'), el('dd', { class: 'path' }, plan.registry_file)), el('div', {}, el('dt', {}, '配置指针'), el('dd', { class: 'path' }, plan.config_file)),
    el('div', {}, el('dt', {}, 'Skill 来源目录（安装后需保留）'), el('dd', { class: 'path' }, plan.installation.source))));
  if (plan.items.some(p => p.action === 'blocked')) nodes.push(el('p', { class: 'notice' }, '有冲突的入口将保留原文件并报告失败，其他可用入口可以继续。'));
  nodes.push(itemTable(plan.items), el('label', { class: 'check-confirm' }, el('input', { type: 'checkbox', checked: state.checked, onChange: event => { state.checked = event.target.checked; renderNavigation(); } }),
    '确认使用上述记录中心，并允许执行预览中的登记与规则修改'),
    el('p', { class: 'muted' }, '旧文档不迁移。新增项目的分支与发布约定待 Agent 审阅。'));
  return nodes;
}
function renderResults() {
  const result = state.result;
  if (!result) return heading('等待执行', '尚未执行安装');
  const nodes = [el('p', { class: 'eyebrow' }, '步骤 04 / 04'), el('div', { class: 'result-heading' }, icon(result.ok ? 'circle-check' : 'circle-alert'), el('h1', {}, result.ok ? '项目接入完成' : '部分入口未接入')),
    el('p', { class: 'subtitle' }, state.root)];
  const stats = el('div', { class: 'stats' });
  for (const [status, label] of [['initialized', '新增 / 修复'], ['skipped', '已接入'], ['failed', '失败']]) stats.append(el('div', { class: 'stat' }, el('strong', {}, result.items.filter(p => p.status === status).length), el('span', {}, label)));
  nodes.push(stats, el('p', { class: `notice ${result.installation.status === 'failed' ? 'error' : 'success'}` }, result.installation.status === 'failed' ? `共享安装失败：${result.installation.error}` : `共享 Skill：${result.installation.status === 'installed' ? '已安装' : '已存在'} · ${result.installation.target}`), itemTable(result.items, true));
  if (result.items.some(p => p.profile_review_required)) nodes.push(el('p', { class: 'notice' }, '新建项目档案中的分支、验证与发布约定仍需 Agent 阅读原规则后补齐。'));
  nodes.push(el('p', { class: 'muted' }, 'Skill 来源目录需保留。工具界面中的实际加载状态尚未核验。'));
  return nodes;
}
function renderNavigation() {
  const footer = $('#navigation'); footer.replaceChildren();
  if (!state.config) return;
  if (state.step > 0 && state.step < 3) footer.append(button('上一步', () => work(async () => { await invalidate(); state.step -= 1; state.unlocked = state.step; }), 'secondary', 'arrow-left'));
  else footer.append(el('span'));
  footer.append(el('span', { class: 'footer-info' }, state.busy ? '正在处理…' : state.step === 0 ? '确认前不会创建目录' : state.step === 1 ? `${state.selected.size} 个项目已选择` : state.step === 2 ? '执行前再次核对文件状态' : '原规则与记录已保留'));
  let next;
  if (state.step === 0) {
    next = button('确认并继续', () => { state.rootConfirmed = true; state.unlocked = 1; state.step = 1; render(); }, 'primary', 'arrow-right');
    next.disabled = !state.root || state.busy;
  } else if (state.step === 1) {
    next = button(state.busy ? '正在检查' : '预览修改', () => work(async () => { state.plan = await api('/api/preview', selection()); state.checked = false; state.step = 2; state.unlocked = 2; }), 'primary', state.busy ? 'loader-circle' : 'arrow-right');
    next.disabled = !state.selected.size || !state.hosts.length || state.busy;
  } else if (state.step === 2) {
    next = button(state.busy ? '正在安装' : '确认安装', () => work(async () => {
      const id = state.plan.plan_id; state.plan = null;
      try { state.result = await api('/api/apply', { plan_id: id, confirmed: true, records_root_confirmed: state.rootConfirmed }); state.step = 3; state.unlocked = 3; }
      catch (error) { state.step = 1; state.unlocked = 1; throw error; }
    }), 'primary', 'check');
    next.disabled = !state.checked || !state.plan || state.busy || !state.plan.items.some(p => p.action !== 'blocked');
  } else {
    const failed = state.result?.items.filter(item => item.status === 'failed') ?? [];
    if (failed.length) footer.append(button('仅重试失败项', () => retry(failed), 'secondary', 'refresh-cw'));
    next = button('继续添加项目', () => { state.selected.clear(); state.result = null; state.statuses.clear(); state.step = 1; state.unlocked = 1; render(); }, 'primary', 'plus');
  }
  footer.append(next);
}
function retry(items) {
  state.selected.clear();
  for (const item of items) state.selected.set(item.project, [...new Set([...(state.selected.get(item.project) ?? []), item.host])]);
  state.hosts = [...new Set(items.map(p => p.host))]; state.result = null; state.plan = null; state.step = 1; state.unlocked = 1; state.statuses.clear(); render();
}
function render() {
  if (!state.config) return;
  $('#back-platform span').textContent = state.config.has_platform ? '返回项目管理' : '打开项目管理';
  $('#back-platform').disabled = state.busy;
  $('#steps').replaceChildren(...names.map((name, index) => el('button', { class: `step ${index === state.step ? 'active' : ''} ${index < state.step ? 'complete' : ''}`,
    disabled: state.busy || index > state.unlocked || Boolean(state.result && index !== 3), 'aria-current': index === state.step ? 'step' : 'false', onClick: () => go(index).catch(showError) },
    el('span', { class: 'step-number' }, index < state.step ? icon('check') : index + 1), name)));
  $('#content').replaceChildren(...[renderCenter, renderProjects, renderPreview, renderResults][state.step]());
  if (state.busy) $('#content').querySelectorAll('input').forEach(input => { input.disabled = true; });
  renderNavigation();
}

function returnToOpener(targetOrigin) {
  if (!window.opener || window.opener.closed) return Promise.resolve(false);
  return new Promise(resolve => {
    const opener = window.opener;
    const finish = returned => { clearTimeout(timer); window.removeEventListener('message', acknowledge); resolve(returned); };
    const acknowledge = event => {
      if (event.source === opener && event.origin === targetOrigin && event.data?.type === 'biz-project:return-ack') finish(true);
    };
    window.addEventListener('message', acknowledge);
    const timer = setTimeout(() => finish(false), 800);
    opener.postMessage({ type: 'biz-project:return-request' }, targetOrigin);
  });
}
$('#back-platform').addEventListener('click', () => work(async () => {
  const target = managementTarget ?? await api('/api/platform', {});
  if (state.config.has_platform && await returnToOpener(new URL(target.url).origin)) window.close();
  else location.assign(target.url);
}));

let directory = null, directoryMode = null, directoryVersion = 0, loadingDirectory = false;
async function loadDirectory(value) {
  const version = ++directoryVersion; loadingDirectory = true; $('#select-directory').disabled = true;
  $('#directory-path').disabled = true;
  $('#directory-form button:last-child').disabled = true;
  $('#directory-error').hidden = true; $('#directory-list').replaceChildren(el('p', { class: 'loading' }, '正在读取目录…'));
  try {
    const result = await api(`/api/directories?path=${encodeURIComponent(value)}&hidden=${$('#directory-hidden').checked}`);
    if (version !== directoryVersion) return;
    directory = result; $('#directory-path').value = result.path; $('#directory-up').disabled = !result.parent;
    $('#directory-search').value = ''; $('#directory-new').hidden = true; $('#new-directory-name').value = '';
    renderDirectories();
  } catch (error) {
    if (version !== directoryVersion) return;
    $('#directory-error').textContent = error.message; $('#directory-error').hidden = false;
    $('#directory-list').replaceChildren(empty('无法访问此目录'));
    directory = null;
  } finally {
    if (version === directoryVersion) {
      loadingDirectory = false; $('#select-directory').disabled = !directory;
      $('#directory-path').disabled = false;
      $('#directory-form button:last-child').disabled = false;
    }
  }
}
function renderDirectories() {
  const filter = $('#directory-search').value.toLowerCase();
  const nodes = directory.directories.filter(item => item.name.toLowerCase().includes(filter)).map(item => el('button', { class: 'directory-item', onClick: () => loadDirectory(item.path) },
    icon('folder'), el('span', { class: 'dir-name' }, item.name), item.project_hint ? badge('项目', 'neutral') : null, icon('chevron-right')));
  $('#directory-list').replaceChildren(...(nodes.length ? nodes : [empty('没有子目录')]));
  $('#directory-selection').textContent = directory.truncated ? '仅显示前 1000 个目录' : `${directory.directories.length} 个目录`;
}
async function openDirectory(mode) {
  directoryMode = mode;
  $('#directory-title').textContent = { center: '选择记录中心目录', parent: '选择项目父目录', project: '添加单个项目' }[mode];
  $('#select-directory').textContent = { center: '使用此目录', parent: '列出此处项目', project: '添加此项目' }[mode];
  $('#new-directory-toggle').hidden = mode !== 'center';
  $('#directory-roots').replaceChildren(...state.config.roots.map(root => button(root.name, () => loadDirectory(root.path), 'secondary', 'folder')));
  $('#directory-dialog').showModal();
  await loadDirectory(mode === 'center' ? state.config.records_root ?? state.config.home : state.parent ?? state.config.roots.find(p => p.path !== state.config.home)?.path ?? state.config.home);
}
$('#close-directory').addEventListener('click', () => { directoryVersion += 1; $('#directory-dialog').close(); });
$('#directory-form').addEventListener('submit', event => { event.preventDefault(); loadDirectory($('#directory-path').value); });
$('#directory-up').addEventListener('click', () => { if (directory?.parent) loadDirectory(directory.parent); });
$('#directory-search').addEventListener('input', () => { if (directory && !loadingDirectory) renderDirectories(); });
$('#directory-hidden').addEventListener('change', () => { if (directory) loadDirectory(directory.path); });
$('#new-directory-toggle').addEventListener('click', () => { $('#directory-new').hidden = !$('#directory-new').hidden; if (!$('#directory-new').hidden) $('#new-directory-name').focus(); });
$('#select-directory').addEventListener('click', async () => {
  if (!directory || loadingDirectory) return;
  let selected = directory.path;
  if (directoryMode === 'center' && !$('#directory-new').hidden) {
    const name = $('#new-directory-name').value.trim();
    if (!name || /[\\/:*?"<>|\x00-\x1f]/.test(name) || ['.', '..'].includes(name) || /[ .]$/.test(name)) {
      $('#directory-error').textContent = '请输入有效的新目录名称。'; $('#directory-error').hidden = false; return;
    }
    selected = join(selected, name);
  }
  $('#directory-dialog').close();
  if (directoryMode === 'center') setRoot(selected);
  else if (directoryMode === 'project') { state.selected.set(selected, [...state.hosts]); state.statuses.clear(); render(); }
  else await work(async () => {
    const list = await api('/api/directories?path=' + encodeURIComponent(selected));
    state.parent = list.path; state.candidates = list.directories; state.filter = ''; state.statuses.clear();
  });
});
$('#exit').addEventListener('click', async () => {
  if (state.busy || !confirm('停止安装向导服务？项目管理平台将保持运行。')) return;
  try {
    if (state.config?.has_platform) managementTarget = await api('/api/platform', {});
    await api('/api/shutdown', {});
    $('#content').replaceChildren(el('h1', {}, '向导已退出')); $('#navigation').replaceChildren(); $('#steps').replaceChildren(); $('#exit').disabled = true;
    if (!managementTarget) $('#back-platform').disabled = true;
  }
  catch (error) { showError(error); }
});
try {
  state.config = await api('/api/state');
  if (state.config.records_root && state.config.confirmation_required === false) state.root = state.config.records_root;
  render();
}
catch (error) { $('#content').replaceChildren(el('h1', {}, '无法连接本机向导'), el('p', { class: 'muted' }, '请从 install.cmd 重新打开完整会话链接。')); showError(error); }
