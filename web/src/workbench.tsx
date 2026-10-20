import { type ChangeEvent, type ReactNode } from 'react';
import { date, render, state, statuses, type ActivityItem, type FeatureEditor } from './state';
import { Badge, Button, Empty, Field, Heading, Markdown, MarkdownEditor, Pane, Tabs, Tool } from './ui';
import { backTo, cancelEdit, clearDraft, copy, createFeatureDialog, editFeature, editOverview, editProject, excerpt, historyDialog, installer, navigate, openFeature, openProject, reloadConflict, restoreDraft, saveFeature, saveOverview, selectFeatureTab, selectTab, showAgreements, snapshotVersions, updateDialog } from './runtime';
import { StoppedProjects } from './pages';
import { FeatureChoices, FeatureViewControls } from './feature-choices';

function recoveryVisibleNow() {
  const recovery = state.recovery;
  if (!recovery) return false;
  if (state.route === 'project') return recovery.kind === 'overview' && recovery.id === state.project?.project.id;
  return recovery.kind === 'feature' && recovery.id === state.feature?.feature.id && recovery.projectId === state.feature?.feature.project_id;
}
function Recovery() {
  if (!recoveryVisibleNow()) return null;
  return <div className="notice">上次未保存草稿已保留。<div className="actions"><Button label="恢复草稿" glyph="file-text" onClick={restoreDraft} /><Button label="清除草稿" glyph="x" onClick={clearDraft} /></div></div>;
}
function Conflict() {
  if (!state.conflict || !state.editor) return null;
  const content = state.editor.content;
  return <div className="notice" role="alert"><p>记录已被其他操作修改。当前草稿已保留，尚未写入。</p><div className="actions"><Button label="重新加载最新记录" glyph="refresh-cw" onClick={reloadConflict} /><Button label="复制草稿" glyph="file-text" onClick={() => copy(content)} /></div></div>;
}
function ProjectChoices() {
  const dashboard = state.dashboard;
  if (!dashboard) return null;
  const projects = dashboard.projects.filter(project => `${project.name} ${(project.paths || []).join(' ')}`.toLowerCase().includes(state.projectFilter.toLowerCase()));
  return <>{projects.length ? projects.map(project => <button type="button" className="work-item project-choice" key={project.id} title={project.paths?.[0] || project.name} aria-label={project.name} aria-pressed={project.id === state.project?.project.id ? 'true' : 'false'} disabled={state.busy} onClick={() => openProject(project.id)}><span className="item-title" title={project.name}><svg aria-hidden="true"><use href="/icons.svg#folder" /></svg>{project.name}</span><span className="item-path" title={project.paths?.[0] || project.id}>{project.paths?.[0] || project.id}</span><span className="item-meta">{project.feature_count} 个功能<span>{(project.hosts || []).join(' · ')}</span></span></button>) : <Empty text="没有匹配的项目" />}<StoppedProjects /></>;
}
function Activity({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <Empty text="尚无进展记录" />;
  return items.map(item => <div className="activity" key={`${item.project_id}:${item.feature_id}:${item.created_at}:${item.agent}`}><span className="activity-dot" /><div><Button label={item.feature_title || item.project_name} kind="text-link" onClick={() => item.feature_id ? openFeature(item.project_id, item.feature_id, 'updates') : openProject(item.project_id)} /><p className="activity-excerpt">{excerpt(item.content)}</p><div className="metadata"><span>{item.agent}</span><span>{item.project_name}</span><span>{date(item.created_at)}</span></div></div></div>);
}
function Filters({ withStatus = false }: { withStatus?: boolean }) {
  return <div className="toolbar"><div className="filter-input"><input value={state.filter} placeholder="筛选名称、负责人…" aria-label="筛选列表" onChange={event => { state.filter = event.target.value; render(); }} /></div>{withStatus ? <div className="filter-select"><select aria-label="按状态筛选" value={state.status} onChange={event => { state.status = event.target.value; render(); }}><option value="">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div> : null}</div>;
}
function OverviewDocument() {
  const project = state.project;
  if (!project) return null;
  if (state.editor?.kind === 'overview') return <><Conflict /><MarkdownEditor label="项目约定正文" draft={state.editor} /><div className="actions"><Button label="保存约定" glyph="check" kind="primary" onClick={saveOverview} /><Button label="取消" glyph="x" onClick={cancelEdit} /></div></>;
  return <><Recovery /><div className="section-title"><h2>项目约定</h2><Button label="编辑约定" glyph="file-text" onClick={editOverview} /></div><Markdown content={project.overview} /></>;
}
function FeatureDocument() {
  const record = state.feature;
  if (!record) return null;
  const feature = record.feature;
  if (state.editor?.kind === 'feature') {
    const editor: FeatureEditor = state.editor;
    const update = (key: 'title' | 'owner' | 'status') => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { editor[key] = event.target.value; editor.dirty = true; render(); };
    return <><Conflict /><div className="form-grid"><Field label="功能名称"><input aria-label="功能名称" value={editor.title} onChange={update('title')} /></Field><Field label="负责人"><input aria-label="负责人" value={editor.owner} onChange={update('owner')} /></Field><Field label="功能状态"><select aria-label="功能状态" value={editor.status} onChange={update('status')}>{Object.hasOwn(statuses, editor.status) ? null : <option value={editor.status} disabled>{`未识别：${editor.status}`}</option>}{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><MarkdownEditor label="功能正文" draft={editor} /><div className="actions"><Button label="保存记录" glyph="check" kind="primary" onClick={saveFeature} /><Button label="取消" glyph="x" onClick={cancelEdit} /></div></>;
  }
  return <div className="record-layout"><div className="section-title"><h2>功能记录</h2><Button label="编辑记录" glyph="square-pen" onClick={editFeature} /></div><details className="record-meta"><summary>记录信息</summary><dl><dt>功能 ID</dt><dd>{feature.id}</dd><dt>负责人</dt><dd>{feature.owner || '—'}</dd><dt>状态</dt><dd><Badge status={feature.status} /></dd><dt>创建时间</dt><dd>{date(feature.created_at)}</dd><dt>独立进展</dt><dd>{record.updates.length} 条</dd></dl></details><Markdown content={record.document} /></div>;
}
function ProjectDetail() {
  const project = state.project;
  const dashboard = state.dashboard;
  if (!project || !dashboard) return { head: null as ReactNode, body: null as ReactNode };
  return { head: <><Button label="返回功能列表" glyph="arrow-left" kind="mobile-back ghost" onClick={() => backTo('features')} /><Heading title={project.project.name} subtitle={`${project.features.length} 个功能 · ${(project.project.hosts || []).join(' / ') || '未记录工具'}`} actions={state.session?.local ? <Button label="编辑项目" glyph="settings-2" onClick={editProject} /> : null} /><Tabs items={[['overview', '项目约定'], ['updates', '最近进展']]} selected={state.tab} onSelect={selectTab} /></>, body: state.tab === 'overview' ? <OverviewDocument /> : <Activity items={(dashboard.activity || []).filter(item => item.project_id === project.project.id)} /> };
}
function FeatureDetail() {
  const record = state.feature;
  if (!record) return { head: null as ReactNode, body: null as ReactNode };
  const feature = record.feature;
  const body = state.featureTab === 'document' ? <FeatureDocument /> : state.featureTab === 'updates' ? <UpdateList /> : <HistoryList />;
  return { head: <><Button label="返回功能列表" glyph="arrow-left" kind="mobile-back ghost" onClick={() => backTo('features')} /><Heading title={feature.title} subtitle={`${feature.owner || '未分配'} · ${date(feature.updated_at || feature.created_at)}`} actions={<><Badge status={feature.status} /><Button label="追加进展" glyph="plus" onClick={updateDialog} /></>} /><Tabs items={[['document', '记录正文'], ['updates', '进展记录'], ['history', '修改历史']]} selected={state.featureTab} onSelect={selectFeatureTab} /></>, body: <><Recovery />{body}</> };
}
function UpdateList() {
  const record = state.feature;
  if (!record?.updates.length) return <Empty text="尚无独立进展记录" />;
  return record.updates.map(update => <section className="section" key={update.id || `${update.agent}:${update.created_at}`}><div className="section-title"><h2>{update.agent}</h2><small>{date(update.created_at)}</small></div><Markdown content={update.content} /></section>);
}
function HistoryList() {
  const record = state.feature;
  if (!record) return null;
  const feature = record.feature;
  return <>{state.session?.local ? <div className="section-title"><h2>文档版本</h2><Button label="浏览文档版本" glyph="file-text" onClick={() => snapshotVersions(`projects/${feature.project_id}/features/${feature.id}/README.md`)} /></div> : null}{record.history.length ? <div className="table-wrap mobile-table"><table><thead><tr>{['修改时间', '操作', '记录者', ''].map(text => <th key={text || 'action'}>{text}</th>)}</tr></thead><tbody>{record.history.map(entry => <tr key={entry.id || entry.created_at}><td>{date(entry.created_at)}</td><td>{entry.kind}</td><td>{entry.actor}</td><td><Button label="查看历史" glyph="file-text" onClick={() => historyDialog(entry)} /></td></tr>)}</tbody></table></div> : <Empty text="尚无网页修改历史" />}</>;
}
export function Workbench() {
  const data = state.dashboard;
  if (!data) return <><Heading title="工作总览" /><Empty text="记录中心不可用" />{state.session?.local ? <Button label="打开接入向导" glyph="folder-plus" onClick={installer} /> : null}</>;
  const metrics: [string, string][] = [['projects', '项目'], ['features', '功能'], ['active', '进行中'], ['blocked', '受阻'], ['verified', '已验证'], ['released', '已上线']];
  const warnings = data.warnings ?? [];
  const detail = state.route === 'feature' ? FeatureDetail() : state.route === 'project' ? ProjectDetail() : { head: <div className="pane-title"><h2>最近进展</h2><small className="muted">所有项目</small></div>, body: <Activity items={data.activity || []} /> };
  return <><div className="work-header"><Heading title="工作总览" actions={state.session?.local ? <Button label="接入新项目" glyph="folder-plus" onClick={installer} /> : null} /></div><div className="metrics">{metrics.map(([key, label]) => <div className={`metric ${key}`} key={key}><span>{label}</span><strong>{data.stats?.[key] ?? 0}</strong></div>)}</div>{warnings.length ? <details className="work-warnings"><summary>{warnings.length} 条记录警告</summary>{warnings.map((warning, index) => <p key={index}>{typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}</p>)}</details> : null}
    <div className="workbench-grid"><Pane kind="projects" label="项目列表" scrollKey={`projects:${state.projectFilter}`} head={<><div className="pane-title"><h2>项目</h2><Tool label="全部项目" glyph="arrow-right" onClick={() => navigate('projects')} /></div><input value={state.projectFilter} placeholder="搜索项目…" aria-label="搜索项目" onChange={event => { state.projectFilter = event.target.value; render(); }} /></>}><div id="project-choices"><ProjectChoices /></div></Pane>
      <Pane kind="features" label="功能列表" scrollKey={`features:${state.project?.project.id}:${state.filter}:${state.status}:${state.featureView.mode}:${state.featureView.time}`} head={<><Button label="返回项目列表" glyph="arrow-left" kind="mobile-back ghost" onClick={() => backTo('projects')} /><div className="pane-title"><h2>功能</h2>{state.project ? <div className="actions"><Tool label="查看项目约定" glyph="file-text" onClick={showAgreements} /><Tool label="新建功能" glyph="plus" onClick={createFeatureDialog} /></div> : null}</div><div className="pane-context" title={state.project?.project.name || ''}>{state.project?.project.name || '未选择项目'}</div><FeatureViewControls /><Filters withStatus /></>}><div id="filtered-list"><FeatureChoices /></div></Pane>
      <Pane kind="record" label="记录详情" scrollKey={`record:${state.route}:${state.project?.project.id}:${state.feature?.feature.id}:${state.tab}:${state.featureTab}:${state.editor?.kind || ''}`} head={detail.head}>{detail.body}</Pane></div></>;
}
