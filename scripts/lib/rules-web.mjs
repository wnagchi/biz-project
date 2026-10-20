import { createRulesLibrary } from './rules-library.mjs';
import { createRulePlanner } from './rules-apply.mjs';
import { check } from './rules-render.mjs';
import { createStarter } from './rules-starter.mjs';
export function createRulesWeb(options = {}) {
  const library = createRulesLibrary(options), planner = createRulePlanner(library, options);
  return { close: () => planner.close(), dispatch(method, url, input) {
    if (method === 'GET') {
      if (url.pathname === '/api/rules/state') return library.state();
      if (url.pathname === '/api/rules/list') return library.list(url.searchParams.get('kind'), Number(url.searchParams.get('offset') ?? 0));
      const entry = url.pathname.match(/^\/api\/rules\/(modules|schemes)\/([a-z0-9-]+)$/); if (entry) return library.get(entry[1], entry[2]);
    } else if (method === 'POST') {
      if (url.pathname === '/api/rules/library') { planner.close(); return library.confirm(input); }
      if (url.pathname === '/api/rules/starter') return createStarter(library);
      if (url.pathname === '/api/rules/modules') return library.save('modules', input);
      if (url.pathname === '/api/rules/schemes') return library.save('schemes', input);
      if (url.pathname === '/api/rules/preview') return planner.preview(input);
      if (url.pathname === '/api/rules/merge') return planner.merge(input);
      if (url.pathname === '/api/rules/apply') return planner.apply(input);
      if (url.pathname === '/api/rules/cancel') return planner.cancel(input.plan_id);
    }
    check(false, '没有此开发规则接口。', 404);
  } };
}
