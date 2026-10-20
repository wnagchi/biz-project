import { parseFeatureView, type FeatureView } from './feature-list.mjs';

export const statuses = { planned: '待开发', developing: '开发中', blocked: '受阻', verified: '已验证', integrated: '已合入开发', released: '已上线', archived: '已归档' } as const;
const featureViewKey = 'biz-project-feature-view-v1';
function initialFeatureView() {
  try { return parseFeatureView(localStorage.getItem(featureViewKey)); }
  catch { return parseFeatureView(null); }
}
export const rulesUnavailable = '当前服务尚未加载开发规则，请先保存草稿，重启管理服务后刷新页面。';
export const tokenKey = 'biz-platform-token';

export type Route = 'overview' | 'projects' | 'project' | 'feature' | 'search' | 'settings' | 'rules';
export type Stage = 'projects' | 'features' | 'record';
export type ProjectTab = 'overview' | 'updates';
export type FeatureTab = 'document' | 'updates' | 'history';

export interface ProjectSummary {
  id: string;
  name: string;
  paths?: string[];
  hosts?: string[];
  feature_count?: number;
  status_counts?: Record<string, number>;
  updated_at?: string;
}
export interface ActivityItem {
  project_id: string;
  project_name: string;
  feature_id?: string;
  feature_title?: string;
  agent?: string;
  content?: string;
  created_at?: string;
}
export interface Dashboard {
  projects: ProjectSummary[];
  stopped?: ProjectSummary[];
  stats?: Record<string, number>;
  warnings?: Array<string | { message?: string }>;
  activity?: ActivityItem[];
}
export interface FeatureSummary {
  id: string;
  project_id: string;
  title: string;
  owner?: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}
export interface ProjectRecord {
  project: { id: string; name: string; hosts?: string[] };
  features: FeatureSummary[];
  overview: string;
  overview_revision: string;
  profile_revision: string;
}
export interface UpdateRecord { id?: string; agent: string; content: string; created_at?: string }
export interface HistoryValue { document?: string; content?: string }
export interface HistoryEntry { id?: string; created_at?: string; kind: string; actor: string; before?: HistoryValue; after?: HistoryValue }
export interface FeatureRecord {
  feature: FeatureSummary;
  document: string;
  revision: string;
  updates: UpdateRecord[];
  history: HistoryEntry[];
}
export interface HistoryStatus {
  paused?: boolean;
  scan_state?: string;
  active?: boolean;
  document_count?: number;
  dirty_count?: number;
  snapshots_created?: number;
  last_scan?: string;
  scan_ms?: number;
  warning?: string;
}
export interface Session {
  local: boolean;
  records_root?: string;
  lan_enabled?: boolean;
  lan_urls?: string[];
  secure?: boolean;
  access_key?: string;
  service_policy?: { auto_start?: boolean | null };
  history?: HistoryStatus;
}
export interface SearchResult {
  project_id: string;
  project_name: string;
  feature_id?: string;
  feature_title?: string;
  title?: string;
  kind: string;
  excerpt?: string;
}
export interface Draft { content: string; preview?: boolean; dirty?: boolean }
export interface OverviewEditor extends Draft { kind: 'overview'; id: string; revision: string }
export interface FeatureEditor extends Draft { kind: 'feature'; id: string; projectId: string; title: string; owner: string; status: string; revision: string }
export type Editor = OverviewEditor | FeatureEditor;
export interface SnapshotVersion { id: string; created_at?: string; source?: string; deleted?: boolean; size?: number }
export interface SnapshotDocument { file: string }
export interface SnapshotContent { content?: string; deleted?: boolean; created_at?: string; source?: string }
export type Modal =
  | { id: string; type: 'create-feature'; data: { title: string; name: string; owner: string; error: string; submitting: boolean } }
  | { id: string; type: 'update'; data: Draft & { title: string; agent: string; error: string; submitting: boolean } }
  | { id: string; type: 'history'; data: { title: string; entry: HistoryEntry } }
  | { id: string; type: 'copy'; data: { title: string; label: string; value: string } }
  | { id: string; type: 'installer'; data: { title: string; label: string; value: string } }
  | { id: string; type: 'documents'; data: { title: string; documents: SnapshotDocument[]; total: number; next_offset: number | null } }
  | { id: string; type: 'versions'; data: { title: string; file: string; route: string; versions: SnapshotVersion[]; offset: number; more: boolean } }
  | { id: string; type: 'snapshot'; data: { title: string; file: string; value: SnapshotContent; raw: boolean } }
  | { id: string; type: 'project'; data: { title: string; projectId: string; name: string; profile_revision: string; error: string; submitting: boolean; phase: 'edit' | 'delete'; remove_rules: boolean; rule_files: string[] } };

export interface PlatformState {
  session: Session | null;
  dashboard: Dashboard | null;
  project: ProjectRecord | null;
  feature: FeatureRecord | null;
  route: Route;
  tab: ProjectTab;
  featureTab: FeatureTab;
  stage: Stage;
  projectFilter: string;
  busy: boolean;
  error: string;
  notice: string;
  filter: string;
  status: string;
  query: string;
  featureView: FeatureView;
  results: SearchResult[] | null;
  editor: Editor | null;
  conflict: boolean;
  recovery: Editor | null;
  modals: Modal[];
  serviceStopped: boolean;
}

export const state: PlatformState = {
  session: null, dashboard: null, project: null, feature: null, route: 'overview', tab: 'overview', featureTab: 'document',
  stage: 'projects', projectFilter: '', busy: false, error: '', notice: '', filter: '', status: '', query: '', results: null, featureView: initialFeatureView(),
  editor: null, conflict: false, recovery: null, modals: [], serviceStopped: false
};

let revision = 0;
const listeners = new Set<() => void>();
export function subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function getRevision() { return revision; }
export function render() { revision += 1; for (const listener of listeners) listener(); }
export function setFeatureView(value: Partial<FeatureView>) {
  state.featureView = { ...state.featureView, ...value };
  try { localStorage.setItem(featureViewKey, JSON.stringify(state.featureView)); }
  catch { /* The current tab still works when persistent storage is unavailable. */ }
  render();
}
export function date(value?: string) {
  if (!value) return '暂无更新';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function inWorkbench() { return Boolean(state.dashboard && ['overview', 'project', 'feature'].includes(state.route)); }
