import { useLayoutEffect, useSyncExternalStore } from 'react';
import { getRevision, inWorkbench, state, subscribe } from './state';
import { ProjectList, RulesPage, SearchPage, SettingsPage, Shell, Stopped, Unavailable } from './pages';
import { Workbench } from './workbench';
import { Modals } from './modals';

function usePlatform() { return useSyncExternalStore(subscribe, getRevision, getRevision); }
export function App() {
  usePlatform();
  useLayoutEffect(() => { document.querySelector('#app')?.classList.toggle('workbench-mode', Boolean(state.session) && inWorkbench() && !state.serviceStopped); });
  if (state.serviceStopped) return <Stopped />;
  if (!state.session) return <Unavailable />;
  let content;
  if (inWorkbench() || state.route === 'overview') content = <Workbench />;
  else if (state.route === 'projects') content = state.dashboard ? <ProjectList /> : <Workbench />;
  else if (state.route === 'rules' && state.session.local) content = <RulesPage />;
  else if (state.route === 'search') content = <SearchPage />;
  else if (state.route === 'settings' && state.session.local) content = <SettingsPage />;
  else content = <Workbench />;
  return <><Shell>{content}</Shell><Modals /></>;
}
