import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { date, render, state, type Route } from './state';
import { Badge, Button, Empty, Heading, Icon, Tool } from './ui';
import { api, copy, deleteStoppedProject, installer, navigate, network, openFeature, openProject, refresh, resumeManagedProject, search, servicePolicy, snapshotDocuments, stopSharedService, watchHistory, work } from './runtime';
import type { Session } from './state';

function CopyRow({ label, value }: { label: string; value: string }) {
  return <div className="copy-row"><input value={value} type="text" readOnly aria-label={label} /><Tool label={`复制${label}`} glyph="copy" onClick={() => copy(value)} /></div>;
}
export function Unavailable() {
  return <main className="login"><div className="brand"><Icon name="layers" />Biz Project</div><h1>无法连接</h1><p>{state.error || '当前网络不能打开管理页面。'}</p></main>;
}
export function Stopped() {
  return <><header className="topbar"><div className="brand"><Icon name="layers" />Biz Project</div></header><main className="login"><h1>服务已停止</h1></main></>;
}
function Nav({ label, route, glyph, active }: { label: string; route: Route; glyph: string; active: boolean }) {
  return <Button label={label} glyph={glyph} kind={`nav-button${active ? ' active' : ''}`} onClick={() => navigate(route)} />;
}
export function Shell({ children }: { children: ReactNode }) {
  const session = state.session;
  if (!session) return null;
  const local = session.local, bench = Boolean(state.dashboard && ['overview', 'project', 'feature'].includes(state.route));
  return <><header className={`topbar ${bench ? 'workbench-topbar' : ''}`}><div className="brand"><Icon name="layers" />Biz Project</div><span className="topbar-divider" /><span className="topbar-title">项目管理</span><span className="connection">{local ? '本机管理' : '局域网'}</span><Tool label="刷新当前页面" glyph="refresh-cw" onClick={refresh} /></header><div className={`workspace ${bench ? 'workbench-shell' : ''}`}><aside className="sidebar"><p className="nav-caption">工作空间</p><Nav label="工作总览" route="overview" glyph="layers" active={bench} /><Nav label="项目" route="projects" glyph="folder" active={state.route === 'projects'} /><Nav label="全局搜索" route="search" glyph="search" active={state.route === 'search'} />{local ? <Nav label="开发规则" route="rules" glyph="file-text" active={state.route === 'rules'} /> : null}<div className="sidebar-bottom">{local ? <Nav label="设置" route="settings" glyph="settings-2" active={state.route === 'settings'} /> : null}{local ? <Button label="接入项目" glyph="folder-plus" kind="nav-button" onClick={installer} /> : null}<div className="sidebar-note">{local ? '统一记录中心' : '局域网'}</div></div></aside><main className={`main ${bench ? 'workbench-main' : ''}`} data-stage={state.stage}>{state.error ? <div className="notice error" role="alert">{state.error}</div> : null}{state.notice ? <div className="notice success" role="status">{state.notice}</div> : null}{children}</main></div></>;
}
export function StoppedProjects() {
  const query = (state.route === 'projects' ? state.filter : state.projectFilter).toLowerCase();
  const stopped = (state.dashboard?.stopped ?? []).filter(project => project.name.toLowerCase().includes(query));
  if (!state.session?.local || !stopped.length) return null;
  return <details className="stopped-projects"><summary>已停止管理</summary>{stopped.map(project => <div className="stopped-row" key={project.id}><span className="item-title" title={project.name}>{project.name}</span><span className="small muted">{project.feature_count ?? 0} 个功能</span><div className="actions"><Button label="重新管理" glyph="refresh-cw" onClick={() => resumeManagedProject(project.id)} /><Button label="删除记录" glyph="trash-2" onClick={() => deleteStoppedProject(project)} /></div></div>)}</details>;
}
export function ProjectList() {
  const dashboard = state.dashboard;
  const session = state.session;
  if (!dashboard || !session) return null;
  const projects = dashboard.projects.filter(project => `${project.name} ${(project.paths || []).join(' ')}`.toLowerCase().includes(state.filter.toLowerCase()));
  return <><Heading title="项目" subtitle={`${dashboard.projects.length} 个已接入项目`} actions={session.local ? <Button label="接入新项目" glyph="folder-plus" onClick={installer} /> : null} /><div className="toolbar"><div className="filter-input"><input value={state.filter} placeholder="筛选名称、负责人…" aria-label="筛选列表" onChange={event => { state.filter = event.target.value; render(); }} /></div></div><div id="filtered-list">{projects.length ? <div className="table-wrap mobile-table project-table"><table><colgroup><col /><col /><col /><col /></colgroup><thead><tr>{['项目', '功能进展', '工具', '最近更新'].map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{projects.map(project => <tr key={project.id}><td><Button label={project.name} kind="text-link" onClick={() => openProject(project.id)} /><div className="subline">{project.paths?.[0] || project.id}</div></td><td><div className="status-list">{Object.entries(project.status_counts || {}).filter(([, count]) => count).map(([status, count]) => <span className="status-list" key={status}><Badge status={status} /><span className="small muted">{count}</span></span>)}</div><div className="subline">{project.feature_count || 0} 个功能</div></td><td>{(project.hosts || []).join(' · ') || '—'}</td><td className="small muted">{date(project.updated_at)}</td></tr>)}</tbody></table></div> : <Empty text="没有匹配的项目" />}<StoppedProjects /></div></>;
}
export function SearchPage() {
  return <><Heading title="全局搜索" subtitle="查找项目与功能记录" /><form className="search-form" onSubmit={event => { event.preventDefault(); search(); }}><input value={state.query} placeholder="项目、功能、约定或进展…" aria-label="搜索记录" onChange={event => { state.query = event.target.value; render(); }} /><button type="submit" className="primary" disabled={state.busy}><Icon name="search" />搜索</button></form>{state.results === null ? <Empty text="输入关键词搜索" /> : <><p className="small muted">{state.results.length} 条结果</p>{state.results.length ? state.results.map(result => <div className="search-result" key={`${result.project_id}:${result.feature_id}:${result.kind}:${result.title}`}><div className="small muted">{result.project_name} · {result.kind}</div><Button label={result.feature_title || result.title || result.project_name} kind="text-link" onClick={() => result.feature_id ? openFeature(result.project_id, result.feature_id) : openProject(result.project_id)} /><p>{result.excerpt}</p></div>) : <Empty text="没有找到匹配记录" />}</>}</>;
}
function HistorySettings({ session }: { session: Session }) {
  const history = session.history;
  if (!session.records_root || !history) return null;
  return <><section className="settings-row"><div><h2>文档快照</h2><p>{history.paused ? '已暂停' : history.scan_state === 'scanning' ? '正在核对文档' : history.active ? '监听中' : '未运行'}</p><p className="small muted">{history.document_count} 个文档 · {history.dirty_count} 个待处理 · 本次新增 {history.snapshots_created} 个版本</p>{history.last_scan ? <p className="small muted">最近核对 {date(history.last_scan)} · {history.scan_ms} ms</p> : null}</div><div className="actions"><Button label="浏览快照" glyph="file-text" onClick={snapshotDocuments} /><Tool label="重新核对文档" glyph="refresh-cw" onClick={() => work(async () => { await api('/api/history/rescan', {}); state.session = await api<Session>('/api/session'); })} /><Tool label="刷新快照状态" glyph="refresh-cw" onClick={() => work(async () => { state.session = await api<Session>('/api/session'); })} /></div></section><section className="settings-row"><div><h2>文档监听</h2><p>{history.paused ? '已暂停' : history.active ? '运行中' : '需要处理'}</p></div><label className="toggle"><input type="checkbox" checked={Boolean(history.active)} disabled={state.busy || (!history.active && !history.paused)} aria-label="启用文档监听" onChange={event => watchHistory(event.target.checked)} />启用</label></section>{history.warning ? <div className="notice error" role="alert">{history.warning}</div> : null}</>;
}
export function SettingsPage() {
  const session = state.session;
  if (!session) return null;
  const lanUrls = session.lan_urls ?? [];
  return <><Heading title="设置" subtitle="本机记录中心与访问权限" /><section className="settings-row"><div><h2>记录中心</h2><p>{session.records_root || '尚未确认记录中心'}</p></div><Button label="打开接入向导" glyph="folder-plus" onClick={installer} /></section><HistorySettings session={session} />{session.service_policy ? <section className="settings-row"><div><h2>Skill 自动启动</h2><p>{session.service_policy.auto_start === true ? '已允许' : session.service_policy.auto_start === false ? '已禁止' : '尚未授权'}</p></div><label className="toggle"><input type="checkbox" checked={session.service_policy.auto_start === true} disabled={state.busy} aria-label="允许 Skill 自动启动服务" onChange={event => servicePolicy(event.target.checked)} />允许</label></section> : null}<section className="settings-row"><div><h2>共享服务</h2><p>运行中</p></div><Tool label="停止服务" glyph="power" onClick={stopSharedService} /></section><section className="settings-row"><div><h2>局域网访问</h2><p>{session.lan_enabled ? '已开启 · 同一私人网络可直接查看与编辑记录' : '已关闭 · 仅本机可访问'}</p></div><label className="toggle"><input type="checkbox" checked={Boolean(session.lan_enabled)} disabled={state.busy} aria-label="启用局域网访问" onChange={event => network(event.target.checked)} />启用</label></section>{session.lan_enabled ? <><section className="section"><div className="section-title"><h2>访问地址</h2></div>{lanUrls.length ? lanUrls.map(url => <CopyRow key={url} label="局域网地址" value={url} />) : <p className="muted small">当前未检测到可用的私人局域网地址。</p>}</section><div className="notice section">仅在可信私人局域网使用。{session.secure ? '当前使用 HTTPS 连接。' : 'HTTP 连接不加密。'}目录浏览、项目接入和安装操作仍仅限本机。</div></> : null}</>;
}
export function RulesPage() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current || typeof window.BizRulesUI?.render !== 'function') return;
    const rendered = window.BizRulesUI.render();
    const nodes = [rendered].flat(Infinity).filter((node): node is Node => Boolean(node && typeof node === 'object' && 'nodeType' in (node as object)));
    ref.current.replaceChildren(...nodes);
  });
  if (typeof window.BizRulesUI?.render !== 'function') return <><Heading title="开发规则" /><Empty text="开发规则暂不可用" /></>;
  return <div ref={ref} />;
}
