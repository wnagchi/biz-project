import { documentView } from './dom';
import { inWorkbench, render, rulesUnavailable, state, tokenKey, type Dashboard, type FeatureRecord, type FeatureTab, type HistoryEntry, type Modal, type ProjectRecord, type Route, type SearchResult, type Session, type SnapshotContent, type SnapshotDocument, type SnapshotVersion, type Stage } from './state';

export class ApiError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}

export let token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem(tokenKey) || '';
if (token) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname + location.search); }
export function setToken(value: string) { token = value; sessionStorage.setItem(tokenKey, token); }
export function clearToken() { token = ''; sessionStorage.removeItem(tokenKey); }

const installerWindows = new WeakMap<object, string>();
window.addEventListener('message', event => {
  const source = event.source && typeof event.source === 'object' ? event.source : null;
  if (!source || installerWindows.get(source) !== event.origin || (event.data as { type?: string } | null)?.type !== 'biz-project:return-request') return;
  window.focus();
  (source as Window).postMessage({ type: 'biz-project:return-ack' }, event.origin);
});
window.addEventListener('beforeunload', event => { if (state.editor?.dirty) { event.preventDefault(); event.returnValue = ''; } });

export function canLeave() { return !state.editor || !state.editor.dirty || confirm('尚有未保存的内容，确定离开？'); }
export function note(message: string) { state.notice = message; const live = document.querySelector('#live'); if (live) live.textContent = message; }
export function savedNote(message: string) { note(message); }
function requireProject() { if (!state.project) throw new Error('没有打开的项目。'); return state.project; }
function requireFeature() { if (!state.feature) throw new Error('没有打开的功能。'); return state.feature; }
function requireEditor() { if (!state.editor) throw new Error('没有正在编辑的记录。'); return state.editor; }
export function featurePath() { const feature = requireFeature().feature; return `/api/projects/${encodeURIComponent(feature.project_id)}/features/${encodeURIComponent(feature.id)}`; }
export function openModal<T extends Modal['type']>(type: T, data: Extract<Modal, { type: T }>['data']) {
  const modal = { id: crypto.randomUUID(), type, data } as Extract<Modal, { type: T }>;
  state.modals = [...state.modals, modal]; render(); return modal.id;
}
export function closeModal(id: string) { state.modals = state.modals.filter(modal => modal.id !== id); render(); }
export async function api<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Biz-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let value: { error?: string; code?: string } | null = null;
  try { value = await response.json() as { error?: string; code?: string }; } catch { throw new Error('服务返回了无法识别的响应。'); }
  if (!response.ok) throw new ApiError(value?.error || '请求失败', response.status, value?.code);
  return value as T;
}
function applyFailure(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED')) {
    if (state.editor?.dirty) state.recovery = { ...state.editor };
    state.editor = null; clearToken(); state.session = null;
  }
  state.error = error instanceof Error ? error.message : '请求失败';
}
export async function work(action: () => Promise<void>) {
  if (state.busy) return;
  const app = document.querySelector('#app');
  state.busy = true; state.error = ''; state.notice = '';
  app?.setAttribute('aria-busy', 'true');
  const live = document.querySelector('#live'); if (live) live.textContent = '正在处理';
  render();
  try { await action(); } catch (error) { applyFailure(error); } finally { state.busy = false; app?.setAttribute('aria-busy', 'false'); render(); }
}
export async function loadOverview() {
  const dashboard = await api<Dashboard>('/api/dashboard');
  const selected = dashboard.projects.find(project => project.id === state.project?.project.id) || dashboard.projects[0];
  state.dashboard = dashboard; state.project = selected ? await api<ProjectRecord>(`/api/projects/${encodeURIComponent(selected.id)}`) : null; state.feature = null;
}
export async function loadRules() {
  if (typeof window.BizRulesUI?.load !== 'function' || typeof window.BizRulesUI?.render !== 'function') throw new Error(rulesUnavailable);
  await window.BizRulesUI.load();
}
export async function navigate(route: Route) {
  if (!canLeave()) return;
  await work(async () => {
    state.route = route; state.editor = null; state.conflict = false; state.filter = ''; state.status = ''; state.projectFilter = ''; state.stage = 'projects';
    if (route === 'overview') await loadOverview();
    if (route === 'projects') state.dashboard = await api<Dashboard>('/api/dashboard');
    if (route === 'settings') state.session = await api<Session>('/api/session');
    if (route === 'rules') await loadRules();
  });
}
let selectionTicket = 0;
async function selectRecord<T>(load: () => Promise<T>, apply: (value: T) => void) {
  if (!canLeave()) return;
  const ticket = ++selectionTicket;
  state.error = '';
  try {
    const value = await load();
    if (ticket !== selectionTicket) return;
    apply(value); render();
  } catch (error) {
    if (ticket !== selectionTicket) return;
    applyFailure(error); render();
  }
}
export function openProject(id: string) {
  return selectRecord(() => api<ProjectRecord>(`/api/projects/${encodeURIComponent(id)}`), project => {
    state.project = project; state.feature = null; state.route = 'project'; state.tab = 'overview'; state.stage = 'features'; state.editor = null; state.conflict = false; state.filter = ''; state.status = '';
  });
}
export function openFeature(projectId: string, id: string, tab: FeatureTab = 'document') {
  return selectRecord(async () => {
    const project = state.project?.project.id === projectId ? state.project : await api<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`);
    return { project, feature: await api<FeatureRecord>(`/api/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(id)}`) };
  }, ({ project, feature }) => {
    state.project = project; state.feature = feature; state.route = 'feature'; state.featureTab = tab; state.stage = 'record'; state.editor = null; state.conflict = false;
  });
}
function failModal(modal: { data: { error: string; submitting: boolean } }, error: unknown) {
  applyFailure(error); modal.data.error = state.error; modal.data.submitting = false; render();
}
async function reloadDashboard() { state.dashboard = await api<Dashboard>('/api/dashboard'); }
function clearOpenProject(id: string) {
  if (state.project?.project.id !== id) return;
  state.project = null; state.feature = null; state.route = 'overview'; state.stage = 'projects'; state.editor = null; state.conflict = false;
}
export function editProject() {
  const project = state.project;
  if (!project || !state.session?.local) return;
  openModal('project', { title: '编辑项目', projectId: project.project.id, name: project.project.name, profile_revision: project.profile_revision, error: '', submitting: false, phase: 'edit', remove_rules: false, rule_files: [] });
}
export async function submitProjectName(modal: Extract<Modal, { type: 'project' }>) {
  if (state.editor?.dirty) { modal.data.error = '请先保存或取消未保存的内容。'; render(); return; }
  modal.data.submitting = true; modal.data.error = ''; render();
  try {
    const project = await api<ProjectRecord>(`/api/projects/${encodeURIComponent(modal.data.projectId)}/rename`, { name: modal.data.name, profile_revision: modal.data.profile_revision });
    if (state.project?.project.id === modal.data.projectId) state.project = project;
    await reloadDashboard(); closeModal(modal.id); savedNote('项目名称已保存'); render();
  } catch (error) { failModal(modal, error); }
}
export async function stopManagedProject(modal: Extract<Modal, { type: 'project' }>) {
  if (!canLeave()) return;
  if (!confirm('停止管理后，项目会移到已停止管理，登记调用会去掉。功能记录和开发规则都会保留。')) return;
  modal.data.submitting = true; modal.data.error = ''; render();
  try {
    await api(`/api/projects/${encodeURIComponent(modal.data.projectId)}/stop`, {});
    clearOpenProject(modal.data.projectId); await reloadDashboard(); closeModal(modal.id); savedNote('已停止管理'); render();
  } catch (error) { failModal(modal, error); }
}
export async function resumeManagedProject(id: string) {
  if (!canLeave()) return;
  try {
    await api(`/api/projects/${encodeURIComponent(id)}/resume`, {});
    await reloadDashboard(); savedNote('已重新管理'); await openProject(id);
  } catch (error) { applyFailure(error); render(); }
}
export async function prepareProjectDelete(modal: Extract<Modal, { type: 'project' }>) {
  modal.data.submitting = true; modal.data.error = ''; render();
  try {
    const rules = await api<{ rule_files: string[] }>(`/api/projects/${encodeURIComponent(modal.data.projectId)}/rules`);
    modal.data.rule_files = rules.rule_files; modal.data.remove_rules = false; modal.data.phase = 'delete'; modal.data.submitting = false; render();
  } catch (error) { failModal(modal, error); }
}
export async function submitProjectDelete(modal: Extract<Modal, { type: 'project' }>) {
  if (!canLeave()) return;
  modal.data.submitting = true; modal.data.error = ''; render();
  try {
    await api(`/api/projects/${encodeURIComponent(modal.data.projectId)}/delete`, { confirm: true, remove_rules: modal.data.remove_rules });
    clearOpenProject(modal.data.projectId); await reloadDashboard(); closeModal(modal.id); savedNote('项目记录已删除'); render();
  } catch (error) { failModal(modal, error); }
}
export function deleteStoppedProject(project: { id: string; name: string }) {
  if (!canLeave()) return;
  const id = openModal('project', { title: '删除记录', projectId: project.id, name: project.name, profile_revision: '', error: '', submitting: false, phase: 'delete', remove_rules: false, rule_files: [] });
  const modal = state.modals.find(item => item.id === id);
  if (modal?.type === 'project') void prepareProjectDelete(modal);
}
export function backTo(stage: Stage) {
  if (!canLeave() || stage === 'record') return;
  state.stage = stage; state.route = stage === 'projects' ? 'overview' : 'project'; state.feature = null; state.editor = null; state.conflict = false; state.tab = 'overview'; render();
}
export function showAgreements() { if (!canLeave()) return; state.route = 'project'; state.stage = 'record'; state.tab = 'overview'; state.editor = null; state.conflict = false; render(); }
export async function refresh() {
  if (!canLeave()) return;
  await work(async () => {
    state.editor = null; state.conflict = false;
    if (inWorkbench()) {
      const dashboard = await api<Dashboard>('/api/dashboard');
      if (!dashboard.projects.some(project => project.id === state.project?.project.id)) { await loadOverview(); state.route = 'overview'; state.stage = 'projects'; return; }
      const project = await api<ProjectRecord>(`/api/projects/${encodeURIComponent(requireProject().project.id)}`);
      state.dashboard = dashboard; state.project = project;
      if (state.route === 'feature') {
        if (project.features.some(feature => feature.id === state.feature?.feature.id)) state.feature = await api<FeatureRecord>(featurePath());
        else { state.feature = null; state.route = 'project'; state.stage = 'features'; }
      }
    } else if (state.route === 'settings') state.session = await api<Session>('/api/session');
    else if (state.route === 'rules') await loadRules();
    else if (state.route === 'search' && state.query.trim()) state.results = (await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(state.query)}`)).results;
    else state.dashboard = await api<Dashboard>('/api/dashboard');
  });
}
export async function syncLists() {
  try { state.project = await api<ProjectRecord>(`/api/projects/${encodeURIComponent(requireProject().project.id)}`); state.dashboard = await api<Dashboard>('/api/dashboard'); }
  catch (error) { if (error instanceof ApiError && error.code === 'SESSION_EXPIRED') throw error; note('内容已保存，列表暂未刷新'); }
}
export async function saveOverview() {
  await work(async () => {
    const editor = requireEditor();
    try { state.project = await api<ProjectRecord>(`/api/projects/${encodeURIComponent(requireProject().project.id)}/overview`, { revision: editor.revision, content: editor.content }); state.editor = null; state.conflict = false; savedNote('项目约定已保存'); }
    catch (error) { if (error instanceof ApiError && error.status === 409) { state.conflict = true; return; } throw error; }
  });
}
export async function saveFeature() {
  await work(async () => {
    const editor = requireEditor();
    if (editor.kind !== 'feature') return;
    try { state.feature = await api<FeatureRecord>(featurePath(), { revision: editor.revision, title: editor.title, owner: editor.owner, status: editor.status, content: editor.content }); state.editor = null; state.conflict = false; savedNote('功能记录已保存'); await syncLists(); }
    catch (error) { if (error instanceof ApiError && error.status === 409) { state.conflict = true; return; } throw error; }
  });
}
export function cancelEdit() { if (!canLeave()) return; state.editor = null; state.conflict = false; state.notice = ''; render(); }
export async function reloadConflict() {
  await work(async () => {
    const editor = requireEditor();
    state.recovery = { ...editor };
    if (editor.kind === 'overview') state.project = await api<ProjectRecord>(`/api/projects/${encodeURIComponent(requireProject().project.id)}`);
    else state.feature = await api<FeatureRecord>(featurePath());
    state.editor = null; state.conflict = false; note('已加载最新记录，原草稿仍可恢复');
  });
}
export function restoreDraft() {
  const recovery = state.recovery;
  if (!recovery) return;
  const revision = recovery.kind === 'overview' ? state.project?.overview_revision : state.feature?.revision;
  state.editor = { ...recovery, revision: revision || recovery.revision, dirty: true }; state.recovery = null; render();
}
export function clearDraft() { state.recovery = null; render(); }
export function editOverview() {
  const project = requireProject();
  state.editor = { kind: 'overview', id: project.project.id, content: project.overview, revision: project.overview_revision, dirty: false }; render();
}
export function editFeature() {
  const record = requireFeature(); const feature = record.feature;
  state.editor = { kind: 'feature', id: feature.id, projectId: feature.project_id, title: feature.title, owner: feature.owner || '', status: feature.status, content: record.document, revision: record.revision, dirty: false };
  render();
}
export function selectTab(key: string) { if (!canLeave() || (key !== 'overview' && key !== 'updates')) return; state.editor = null; state.conflict = false; state.tab = key; render(); }
export function selectFeatureTab(key: string) { if (!canLeave() || (key !== 'document' && key !== 'updates' && key !== 'history')) return; state.editor = null; state.conflict = false; state.featureTab = key; render(); }
export function excerpt(content?: string) { return [...documentView((content || '').slice(0, 1200)).childNodes].map(node => node.textContent).join(' ').replace(/\s+/g, ' ').slice(0, 240); }
export async function search() { if (!state.query.trim()) { state.results = []; render(); return; } await work(async () => { state.results = (await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(state.query)}`)).results; }); }
export async function copy(value: string) { try { await navigator.clipboard.writeText(value); note('已复制'); render(); } catch { openModal('copy', { title: '复制内容', label: '待复制内容', value }); } }
export async function installer() {
  const win = window.open('about:blank', '_blank');
  await work(async () => {
    try { const result = await api<{ url: string }>('/api/installer', {}); if (win) { installerWindows.set(win, new URL(result.url).origin); win.location.href = result.url; } else openModal('installer', { title: '接入向导', label: '安装向导地址', value: result.url }); }
    catch (error) { win?.close(); throw error; }
  });
}
export async function logout() { await work(async () => { await api('/api/logout', {}); clearToken(); state.session = null; state.dashboard = null; state.editor = null; }); }
export function createFeatureDialog() { if (!canLeave()) return; openModal('create-feature', { title: '新建功能', name: '', owner: 'codex', error: '', submitting: false }); }
export function updateDialog() { openModal('update', { title: '追加进展', agent: requireFeature().feature.owner || 'codex', content: '', preview: false, error: '', submitting: false }); }
export function historyDialog(entry: HistoryEntry) { openModal('history', { title: '修改历史', entry }); }
export async function submitFeature(modal: Extract<Modal, { type: 'create-feature' }>) {
  const data = modal.data;
  if (!data.name.trim() || !data.owner.trim()) { data.error = '请填写功能名称和负责人。'; render(); return; }
  data.submitting = true; data.error = ''; render();
  try {
    state.feature = await api<FeatureRecord>(`/api/projects/${encodeURIComponent(requireProject().project.id)}/features`, { title: data.name, owner: data.owner });
    state.route = 'feature'; state.featureTab = 'document'; state.stage = 'record'; state.editor = null; state.conflict = false; state.filter = ''; state.status = '';
    closeModal(modal.id); savedNote('功能已创建'); await syncLists(); render();
  } catch (error) { data.submitting = false; data.error = error instanceof Error ? error.message : '请求失败'; render(); }
}
export async function submitUpdate(modal: Extract<Modal, { type: 'update' }>) {
  const data = modal.data;
  if (!data.agent.trim() || !data.content.trim()) { data.error = '请填写记录者和进展内容。'; render(); return; }
  data.submitting = true; data.error = ''; render();
  try { state.feature = await api<FeatureRecord>(`${featurePath()}/updates`, { agent: data.agent, content: data.content }); closeModal(modal.id); savedNote('进展已追加'); await syncLists(); render(); }
  catch (error) { data.submitting = false; data.error = error instanceof Error ? error.message : '请求失败'; render(); }
}
async function snapshotLoad<T>(route: string) { let result: T | undefined; await work(async () => { result = await api<T>(route); }); return result; }
export async function snapshotDocuments() {
  const data = await snapshotLoad<{ documents: SnapshotDocument[]; total: number; next_offset: number | null }>('/api/history/documents'); if (!data) return;
  openModal('documents', { title: '文档快照', documents: data.documents, total: data.total, next_offset: data.next_offset });
}
export async function loadMoreDocuments(modal: Extract<Modal, { type: 'documents' }>) {
  const next = await snapshotLoad<{ documents: SnapshotDocument[]; next_offset: number | null }>(`/api/history/documents?offset=${modal.data.next_offset}`); if (!next) return;
  modal.data.documents = [...modal.data.documents, ...next.documents]; modal.data.next_offset = next.next_offset; render();
}
export async function snapshotVersions(file: string) {
  const route = `/api/history/versions?file=${encodeURIComponent(file)}`, data = await snapshotLoad<{ versions: SnapshotVersion[] }>(route); if (!data) return;
  openModal('versions', { title: '历史版本', file, route, versions: data.versions, offset: 0, more: data.versions.length >= 100 });
}
export async function loadMoreVersions(modal: Extract<Modal, { type: 'versions' }>) {
  const offset = modal.data.offset + 100, next = await snapshotLoad<{ versions: SnapshotVersion[] }>(`${modal.data.route}&offset=${offset}`);
  if (!next) return;
  modal.data.offset = offset; modal.data.versions = [...modal.data.versions, ...next.versions]; modal.data.more = next.versions.length >= 100; render();
}
export function snapshotSource(source?: string) { return ({ 'startup-scan': '启动扫描', 'filesystem-watcher': '文件监听', reconciliation: '定期核对', 'manual-rescan': '手动核对', 'resume-scan': '恢复监听' } as Record<string, string>)[source || ''] || source || ''; }
export async function snapshotContent(file: string, id: string) {
  const value = await snapshotLoad<SnapshotContent>(`/api/history/version?file=${encodeURIComponent(file)}&id=${encodeURIComponent(id)}`); if (!value) return;
  openModal('snapshot', { title: '快照内容', file, value, raw: false });
}
export async function stopSharedService() {
  if (!canLeave() || !confirm('停止共享服务及文档监听？后续 Skill 调用不会自动重新启动。')) return;
  await work(async () => { await api('/api/service/stop', {}); state.serviceStopped = true; note('服务已停止'); });
}
export async function watchHistory(enabled: boolean) {
  if (state.busy) return;
  const history = state.session?.history;
  const previous = history?.active;
  if (history) history.active = enabled;
  await work(async () => {
    try { await api('/api/history/watch', { enabled }); state.session = await api<Session>('/api/session'); note(enabled ? '文件监听已开启' : '文件监听已暂停'); }
    catch (error) { if (history) history.active = previous; throw error; }
  });
}
export async function network(enabled: boolean) {
  if (state.busy) return;
  const session = state.session;
  const previous = session?.lan_enabled;
  if (session) session.lan_enabled = enabled;
  await work(async () => {
    try { state.session = await api<Session>('/api/network', { enabled }); note(enabled ? '局域网访问已开启' : '局域网访问已关闭'); }
    catch (error) { if (session) session.lan_enabled = previous; throw error; }
  });
}
export async function servicePolicy(enabled: boolean) {
  if (state.busy) return;
  const policy = state.session?.service_policy;
  const previous = policy?.auto_start;
  if (policy) policy.auto_start = enabled;
  await work(async () => {
    try { state.session = await api<Session>('/api/service/policy', { auto_start: enabled }); }
    catch (error) { if (policy) policy.auto_start = previous; throw error; }
  });
}
export function snapshotMarkdown(file: string, value: SnapshotContent) {
  if (value.deleted) return null;
  let markdown = /\.md$/i.test(file) ? value.content ?? null : null;
  if (markdown === null && value.content) { try { const record = JSON.parse(value.content.replace(/^\uFEFF/, '')) as { content?: unknown }; if (typeof record.content === 'string') markdown = record.content; } catch { /* Keep the raw snapshot. */ } }
  return markdown;
}