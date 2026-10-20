import { useEffect, useId, useMemo, useState } from 'react';
import { date, setFeatureView, state, statuses } from './state';
import { featureTime, groupFeatures, type FeatureGroup, type FeatureView } from './feature-list.mjs';
import { Badge, Button, Empty, Icon } from './ui';
import { openFeature } from './runtime';

const timeLabels: Record<string, string> = { future: '未来时间', today: '今天', week: '本周', earlier: '更早', unknown: '时间未知' };

export function FeatureViewControls() {
  const view = state.featureView;
  return <div className="feature-view-controls"><div className="segmented feature-view-modes" role="group" aria-label="功能查看方式">
    <Button label="按状态" pressed={view.mode === 'status'} onClick={() => setFeatureView({ mode: 'status' })} />
    <Button label="按时间" pressed={view.mode === 'time'} onClick={() => setFeatureView({ mode: 'time' })} />
  </div>{view.mode === 'time' ? <select aria-label="时间依据" value={view.time} disabled={state.busy}
    onChange={event => setFeatureView({ time: event.target.value as FeatureView['time'] })}>
    <option value="updated_at">最近更新</option><option value="created_at">创建时间</option>
  </select> : null}</div>;
}

function useCalendarDate(active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const current = new Date(); setNow(current);
      const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = setTimeout(refresh, next.getTime() - current.getTime() + 50);
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [active]);
  return now;
}

function FeatureGroups({ groups }: { groups: FeatureGroup[] }) {
  const [collapsed, setCollapsed] = useState(new Set<string>()), prefix = useId();
  const project = state.project;
  if (!project) return null;
  const view = state.featureView, field = view.mode === 'time' ? view.time : 'updated_at';
  return groups.map((group, index) => {
    const label = view.mode === 'time' ? timeLabels[group.key] : Object.hasOwn(statuses, group.key)
      ? statuses[group.key as keyof typeof statuses] : `未识别：${group.key || '未知'}`;
    const expanded = !collapsed.has(group.key), bodyId = `${prefix}-${index}`;
    return <section className="feature-group" aria-label={`${label}分组`} key={group.key}>
      <h3><button type="button" className="feature-group-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => {
        setCollapsed(current => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; });
      }}><Icon name="chevron-right" /><span className="feature-group-label">{label}</span><span className="feature-group-count">{group.items.length}</span></button></h3>
      <div id={bodyId} hidden={!expanded}>{group.items.map(feature => {
        const time = featureTime(feature, field), stamp = time === null ? undefined : new Date(time).toISOString();
        return <button type="button" className="work-item feature-choice" key={feature.id} aria-label={feature.title}
          aria-pressed={state.route === 'feature' && feature.id === state.feature?.feature.id ? 'true' : 'false'} disabled={state.busy}
          onClick={() => openFeature(project.project.id, feature.id)}><span className="item-title" title={feature.title}>{feature.title}</span>
          <span className="item-meta"><Badge status={feature.status} /><span>{feature.owner || '未分配'}</span></span>
          <time className="item-date" dateTime={stamp} title={`${field === 'created_at' ? '创建时间' : '更新时间'}：${stamp ? new Date(stamp).toLocaleString('zh-CN') : '未知'}`}>{stamp ? date(stamp) : '时间未知'}</time>
        </button>;
      })}</div>
    </section>;
  });
}

export function FeatureChoices() {
  const project = state.project, view = state.featureView, query = state.filter, status = state.status;
  const now = useCalendarDate(view.mode === 'time');
  const groups = useMemo(() => groupFeatures(project?.features ?? [], { ...view, query, status, now }), [project?.features, view.mode, view.time, query, status, now]);
  if (!project) return <Empty text="请选择项目" />;
  if (!groups.length) return <Empty text="没有匹配的功能" />;
  return <FeatureGroups key={`${project.project.id}:${view.mode}:${view.time}:${query}:${status}`} groups={groups} />;
}
