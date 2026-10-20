import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { date, render, state, type HistoryValue, type Modal } from './state';
import { Button, Empty, Field, Icon, Markdown, MarkdownEditor, Tool } from './ui';
import { closeModal, copy, loadMoreDocuments, loadMoreVersions, prepareProjectDelete, snapshotContent, snapshotMarkdown, snapshotSource, snapshotVersions, stopManagedProject, submitFeature, submitProjectDelete, submitProjectName, submitUpdate } from './runtime';

function Dialog({ modal, children, actions }: { modal: Modal; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const onClose = () => closeModal(modal.id);
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [modal.id]);
  return <dialog ref={ref} aria-label={modal.data.title}><div className="dialog-head"><h2>{modal.data.title}</h2><button type="button" className="icon-only" title="关闭" aria-label="关闭" onClick={() => ref.current?.close()}><Icon name="x" /></button></div><div className="dialog-body">{children}</div>{actions ? <div className="dialog-actions">{actions}</div> : null}</dialog>;
}
function CopyBody({ data }: { data: { label: string; value: string } }) {
  return <div className="copy-row"><input value={data.value} type="text" readOnly aria-label={data.label} /><Tool label={`复制${data.label}`} glyph="copy" onClick={() => copy(data.value)} /></div>;
}
function historyBody(value?: HistoryValue) {
  const text = value?.document !== undefined || value?.content !== undefined ? value.document ?? value.content : null;
  return text !== null && text !== undefined ? <Markdown content={text} /> : <pre className="history-doc">{JSON.stringify(value, null, 2)}</pre>;
}
function SnapshotDialog({ modal }: { modal: Extract<Modal, { type: 'snapshot' }> }) {
  const data = modal.data;
  const markdown = data.raw ? null : snapshotMarkdown(data.file, data.value);
  return <Dialog modal={modal}><p className="path small">{data.file}</p><p className="small muted">{date(data.value.created_at)} · {snapshotSource(data.value.source)}</p><div className="segmented" role="group" aria-label="快照显示方式"><Button label="源码" glyph="file-text" pressed={data.raw} onClick={() => { data.raw = true; render(); }} /><Button label="预览" glyph="monitor" pressed={!data.raw} onClick={() => { data.raw = false; render(); }} /></div><div className="snapshot-content">{data.value.deleted ? <Empty text="文档已删除" /> : !data.raw && markdown !== null ? <Markdown content={markdown} /> : <pre className="history-doc">{data.value.content}</pre>}</div></Dialog>;
}
export function Modals() {
  return state.modals.map(modal => {
    if (modal.type === 'create-feature') return <Dialog key={modal.id} modal={modal} actions={<Button label="创建功能" glyph="plus" kind="primary" disabled={modal.data.submitting || undefined} onClick={() => submitFeature(modal)} />}><div className="notice error" role="alert" hidden={!modal.data.error}>{modal.data.error}</div><Field label="功能名称"><input aria-label="功能名称" required value={modal.data.name} onChange={event => { modal.data.name = event.target.value; render(); }} /></Field><Field label="负责人"><input aria-label="负责人" required value={modal.data.owner} onChange={event => { modal.data.owner = event.target.value; render(); }} /></Field></Dialog>;
    if (modal.type === 'update') return <Dialog key={modal.id} modal={modal} actions={<Button label="发布进展" glyph="plus" kind="primary" disabled={modal.data.submitting || undefined} onClick={() => submitUpdate(modal)} />}><div className="notice error" role="alert" hidden={!modal.data.error}>{modal.data.error}</div><Field label="记录者"><input aria-label="记录者" value={modal.data.agent} onChange={event => { modal.data.agent = event.target.value; render(); }} /></Field><MarkdownEditor label="进展内容" draft={modal.data} compact /></Dialog>;
    if (modal.type === 'history') return <Dialog key={modal.id} modal={modal}><p className="small muted">{date(modal.data.entry.created_at)} · {modal.data.entry.actor} · {modal.data.entry.kind}</p><h3 className="history-caption">修改前</h3><div className="history-markdown">{historyBody(modal.data.entry.before)}</div><h3 className="history-caption">修改后</h3><div className="history-markdown">{historyBody(modal.data.entry.after)}</div></Dialog>;
    if (modal.type === 'project') {
      const data = modal.data;
      if (data.phase === 'delete') return <Dialog key={modal.id} modal={modal} actions={<><Button label="返回" glyph="arrow-left" disabled={data.submitting || undefined} onClick={() => { if (!data.profile_revision) closeModal(modal.id); else { data.phase = 'edit'; data.error = ''; render(); } }} /><Button label="确认删除" glyph="trash-2" kind="primary" disabled={data.submitting || undefined} onClick={() => submitProjectDelete(modal)} /></>}><div className="notice error" role="alert" hidden={!data.error}>{data.error}</div><p>功能记录和项目约定会从记录中心删除。源代码保留，登记调用会去掉。</p><label className="check-row"><input type="checkbox" aria-label="同时删除这些开发规则" checked={data.remove_rules} onChange={event => { data.remove_rules = event.target.checked; render(); }} />同时删除这些开发规则</label>{data.rule_files.length ? <ul className="rule-file-list">{data.rule_files.map(file => <li key={file}>{file}</li>)}</ul> : <p className="small muted">没有发现由本平台写入的开发规则。</p>}</Dialog>;
      return <Dialog key={modal.id} modal={modal} actions={<><Button label="保存名称" glyph="check" kind="primary" disabled={data.submitting || undefined} onClick={() => submitProjectName(modal)} /><Button label="停止管理" glyph="power" disabled={data.submitting || undefined} onClick={() => stopManagedProject(modal)} /><Button label="删除记录" glyph="trash-2" disabled={data.submitting || undefined} onClick={() => prepareProjectDelete(modal)} /></>}><div className="notice error" role="alert" hidden={!data.error}>{data.error}</div><Field label="项目名称"><input aria-label="项目名称" required value={data.name} onChange={event => { data.name = event.target.value; render(); }} /></Field></Dialog>;
    }
    if (modal.type === 'copy' || modal.type === 'installer') return <Dialog key={modal.id} modal={modal}>{modal.type === 'installer' ? <CopyBody data={modal.data} /> : <Field label={modal.data.label}><textarea aria-label={modal.data.label} value={modal.data.value} readOnly /></Field>}</Dialog>;
    if (modal.type === 'documents') return <Dialog key={modal.id} modal={modal} actions={<Button label="加载更多" glyph="plus" hidden={modal.data.next_offset === null} onClick={() => loadMoreDocuments(modal)} />}><p className="small muted">{modal.data.total} 个已留存文档</p>{modal.data.total ? <div className="snapshot-documents">{modal.data.documents.map(doc => <button type="button" className="snapshot-file" key={doc.file} onClick={() => snapshotVersions(doc.file)}><Icon name="file-text" /><span className="path">{doc.file}</span></button>)}</div> : <Empty text="尚无文档快照" />}</Dialog>;
    if (modal.type === 'versions') return <Dialog key={modal.id} modal={modal} actions={<Button label="加载更多版本" glyph="plus" hidden={!modal.data.more} onClick={() => loadMoreVersions(modal)} />}><p className="path small">{modal.data.file}</p>{modal.data.versions.length ? <div className="snapshot-versions">{modal.data.versions.map(version => <div className="snapshot-row" key={version.id}><div><strong>{date(version.created_at)}</strong><p className="small muted">{snapshotSource(version.source)} · {version.deleted ? '已删除' : `${version.size} 字节`}</p></div><Button label="查看版本" glyph="file-text" onClick={() => snapshotContent(modal.data.file, version.id)} /></div>)}</div> : <Empty text="尚无此文档的快照" />}</Dialog>;
    return <SnapshotDialog key={modal.id} modal={modal} />;
  });
}
