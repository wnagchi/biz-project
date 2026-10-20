import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import { button, documentView, el, field, modal, tool } from './dom';
import { api, canLeave, loadOverview, work } from './runtime';
import { render, rulesUnavailable, state, type Session } from './state';

window.BizPlatformUI = { api, work, render, el, button, tool, modal, field, documentView, canLeave, rulesUnavailable };

let root: Root | undefined;
function mount() {
  if (root) { render(); return; }
  const app = document.querySelector('#app');
  if (!app) return;
  root = createRoot(app);
  root.render(<App />);
}
void work(async () => { state.session = await api<Session>('/api/session'); try { await loadOverview(); } catch (error) { state.error = error instanceof Error ? error.message : '无法读取记录中心。'; } }).then(mount);
