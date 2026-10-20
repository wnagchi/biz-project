import { useLayoutEffect, useRef, type ChangeEvent, type ReactNode } from 'react';
import { documentView } from './dom';
import { render, state, statuses, type Draft } from './state';

export function Icon({ name }: { name: string }) {
  return <svg aria-hidden="true"><use href={`/icons.svg#${name}`} /></svg>;
}
export function Button({ label, onClick, glyph, kind = '', type = 'button', pressed, hidden, disabled }: { label: string; onClick?: () => void; glyph?: string; kind?: string; type?: 'button' | 'submit'; pressed?: boolean; hidden?: boolean; disabled?: boolean }) {
  const iconOnly = kind.split(' ').includes('icon-only');
  return <button type={type} className={kind} title={label} aria-label={iconOnly ? label : undefined} aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'} hidden={hidden || undefined} disabled={disabled ?? state.busy} onClick={onClick}>{glyph ? <Icon name={glyph} /> : null}{iconOnly ? null : label}</button>;
}
export function Tool({ label, onClick, glyph }: { label: string; onClick: () => void; glyph: string }) { return <Button label={label} onClick={onClick} glyph={glyph} kind="icon-only" />; }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
export function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
export function Heading({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div><div className="actions">{actions}</div></div>;
}
export function Badge({ status }: { status?: string }) {
  const known = Boolean(status && Object.hasOwn(statuses, status));
  return <span className={`status ${known ? status : ''}`}>{known && status ? statuses[status as keyof typeof statuses] : `未识别：${status || '未知'}`}</span>;
}
export function Markdown({ content }: { content?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.replaceChildren(documentView(content)); }, [content]);
  return <div ref={ref} />;
}
export function MarkdownEditor({ label, draft, compact = false }: { label: string; draft: Draft; compact?: boolean }) {
  const show = (preview: boolean) => { draft.preview = preview; render(); };
  return <div className="markdown-editor"><div className="segmented" role="group" aria-label={`${label}显示方式`}><Button label="源码" glyph="file-text" pressed={!draft.preview} onClick={() => show(false)} /><Button label="预览" glyph="monitor" pressed={Boolean(draft.preview)} onClick={() => show(true)} /></div><div className="markdown-editor-body">{draft.preview ? <Markdown content={draft.content} /> : <Field label={label}><textarea className={compact ? '' : 'editor'} aria-label={label} value={draft.content || ''} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { draft.content = event.target.value; draft.dirty = true; render(); }} /></Field>}</div></div>;
}
export function Tabs({ items, selected, onSelect }: { items: [string, string][]; selected: string; onSelect: (key: string) => void }) {
  return <div className="tabs" role="tablist">{items.map(([key, title]) => <Button key={key} label={title} kind={key === selected ? 'active' : ''} onClick={() => onSelect(key)} />)}</div>;
}
export function Pane({ kind, label, scrollKey, head, children }: { kind: string; label: string; scrollKey: string; head: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), previous = useRef(scrollKey);
  useLayoutEffect(() => { if (previous.current !== scrollKey && ref.current) ref.current.scrollTop = 0; previous.current = scrollKey; }, [scrollKey]);
  return <section className={`workbench-pane ${kind}-pane`} role="region" aria-label={label}><header className="pane-head">{head}</header><div className="pane-scroll" data-scroll-key={scrollKey} ref={ref}>{children}</div></section>;
}
