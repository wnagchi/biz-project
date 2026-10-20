import { state } from './state';

type DomChild = Node | string | number | null | undefined;

function flatten(values: unknown[]) {
  const out: DomChild[] = [];
  const walk = (value: unknown) => { if (Array.isArray(value)) value.forEach(walk); else out.push(value as DomChild); };
  values.forEach(walk);
  return out;
}

export function el(tag: string, props: Record<string, unknown> = {}, ...children: unknown[]) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === 'class') node.className = String(value ?? '');
    else if (key in node) (node as unknown as Record<string, unknown>)[key] = value;
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of flatten(children)) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export function icon(name: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `/icons.svg#${name}`); svg.append(use); return svg;
}
export function button(label: string, action: () => void, glyph?: string, kind = '') {
  return el('button', { class: kind, title: label, onClick: action, disabled: state.busy }, glyph ? icon(glyph) : null, label) as HTMLButtonElement;
}
export function tool(label: string, action: () => void, glyph: string) {
  const node = button('', action, glyph, 'icon-only'); node.title = label; node.setAttribute('aria-label', label); return node;
}
export function field(label: string, control: HTMLElement) { control.setAttribute('aria-label', label); return el('label', { class: 'field' }, el('span', {}, label), control); }
export function documentView(content?: string) { return window.BizMarkdown.render(content); }
export function modal(title: string, body: unknown, actions: HTMLElement[] = []) {
  const dialog = el('dialog', { 'aria-label': title }, el('div', { class: 'dialog-head' }, el('h2', {}, title), tool('关闭', () => dialog.close(), 'x')), el('div', { class: 'dialog-body' }, body), actions.length ? el('div', { class: 'dialog-actions' }, actions) : null) as HTMLDialogElement;
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal(); return dialog;
}
