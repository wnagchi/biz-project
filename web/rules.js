(() => {
  const p = window.BizPlatformUI;
  const domains = [
    ['lifecycle', '生命周期'], ['development', '开发'], ['verification', '验证'],
    ['release', '发布'], ['collaboration', 'Agent 协作']
  ];
  const state = { loaded: false, unavailable: false, library: null, tab: 'schemes', modules: [], schemes: [], next: { modules: 0, schemes: 0 }, application: null };
  const domainLabel = id => domains.find(([key]) => key === id)?.[1] || id;
  const encode = value => encodeURIComponent(value);
  const newId = () => crypto.randomUUID().toLowerCase();
  const option = (value, label, selected) => p.el('option', { value, selected }, label);
  const parseJson = (value, message) => {
    try { return JSON.parse(value); } catch { throw new Error(message); }
  };
  const loadLists = async () => {
    const [modules, schemes] = await Promise.all([
      p.api('/api/rules/list?kind=modules&offset=0'), p.api('/api/rules/list?kind=schemes&offset=0')
    ]);
    state.modules = modules.items;
    state.schemes = schemes.items;
    state.next = { modules: modules.next_offset, schemes: schemes.next_offset };
  };
  const load = async () => {
    state.loaded = true;
    state.unavailable = false;
    try {
      state.library = await p.api('/api/rules/state');
      if (state.library.configured) await loadLists();
    } catch (error) {
      if (error.status === 404) { state.unavailable = true; error.message = p.rulesUnavailable; }
      throw error;
    }
  };
  const refresh = load;
  const heading = (title, subtitle, actions = []) => p.el('div', { class: 'rules-heading' },
    p.el('div', {}, p.el('h1', {}, title), subtitle ? p.el('p', {}, subtitle) : null),
    p.el('div', { class: 'actions' }, actions));
  const tabButton = (key, title) => p.button(title, () => { state.tab = key; p.render(); }, null, state.tab === key ? 'active' : '');
  const request = async fn => {
    for (const node of document.querySelectorAll('.rules-apply-grid input, .rules-apply-grid select, .rules-mode input, .rules-preview textarea')) node.disabled = true;
    await p.work(async () => { await fn(); });
  };
  function invalidate(app) {
    const old = app.preview; app.preview = null; app.draftText = ''; app.mergeError = '';
    document.querySelector('.rules-preview')?.remove();
    const action = document.querySelector('.rules-preview-actions button'); if (action) action.lastChild.textContent = '预览应用';
    if (old?.id) p.api('/api/rules/cancel', { plan_id: old.id }).catch(() => {});
  }
  async function allModules() {
    while (state.next.modules !== null) { const data = await p.api(`/api/rules/list?kind=modules&offset=${state.next.modules}`); state.modules.push(...data.items); state.next.modules = data.next_offset; }
  }

  function libraryPanel() {
    const data = state.library;
    if (data?.configured) return p.el('section', { class: 'rules-library-state' },
      p.el('div', {}, p.el('span', { class: 'small muted' }, '模板库位置'), p.el('p', { class: 'path' }, data.root)),
      p.el('span', { class: 'rules-counts' }, `${data.module_total} 个模块 · ${data.scheme_total} 个方案`));
    return p.el('section', { class: 'rules-library-empty' }, p.el('div', {}, p.el('h2', {}, '尚未确认模板库'),
      p.el('p', {}, '选择独立的本机位置保存规则模块与完整方案。'),
      p.button('选择模板库位置', chooseLibrary, 'folder-plus', 'primary')));
  }

  function chooseLibrary() {
    const root = p.el('input', { type: 'text', required: true, placeholder: 'D:\\private\\biz-rules', 'aria-label': '模板库路径' });
    const error = p.el('div', { class: 'notice error', role: 'alert', hidden: true });
    let dialog;
    const save = p.button('确认并创建模板库', async () => {
      if (!root.value.trim()) { error.textContent = '请先选择一个明确的模板库路径。'; error.hidden = false; return; }
      save.disabled = true;
      try {
        state.library = await p.api('/api/rules/library', { root: root.value.trim(), confirmed: true });
        await loadLists(); p.render();
        dialog.close();
      } catch (e) { error.textContent = e.message; error.hidden = false; save.disabled = false; }
    }, 'folder', 'primary');
    dialog = p.modal('确认模板库位置', [p.el('p', {}, '模板库与项目记录、源码和业务项目分开保存。'), error, p.field('模板库路径', root)], [save]);
  }

  function itemActions(kind, item) {
    const endpoint = `/api/rules/${kind}/${encode(item.id)}`;
    return p.el('div', { class: 'rules-item-actions' },
      kind === 'schemes' ? p.tool('应用方案', () => beginApply(item.id), 'arrow-right') : null,
      p.tool('编辑', async () => {
        let detail; await request(async () => { detail = await p.api(endpoint); if (kind === 'schemes') await allModules(); });
        if (detail) { if (kind === 'modules') editModule(detail); else editScheme(detail); }
      }, 'square-pen'),
      p.tool('复制', async () => {
        let detail; await request(async () => { detail = await p.api(endpoint); if (kind === 'schemes') await allModules(); });
        if (detail) { const copy = { ...detail, id: '', title: `${detail.title} 副本`, revision: undefined, archived: false }; if (kind === 'modules') editModule(copy); else editScheme(copy); }
      }, 'copy'),
      item.archived ? p.tool('恢复', () => restoreItem(kind, item), 'refresh-cw') : p.tool('归档', () => archiveItem(kind, item), 'database'));
  }

  function itemList(kind) {
    const items = kind === 'modules' ? state.modules : state.schemes;
    if (!items.length) return p.el('div', { class: 'empty' }, kind === 'modules' ? '尚无规则模块' : '尚无完整方案');
    const more = state.next[kind] === null ? null : p.button('加载更多', () => loadMore(kind), 'plus');
    return p.el('div', { class: 'rules-list' }, items.map(item => p.el('article', { class: `rules-item ${item.archived ? 'is-archived' : ''}` },
      p.el('div', { class: 'rules-item-main' }, p.el('h3', {}, item.title),
        p.el('p', { class: 'small muted' }, kind === 'modules' ? `${domainLabel(item.domain)} · 修订 ${item.revision}` : `完整方案 · 修订 ${item.revision}`),
        item.archived ? p.el('span', { class: 'rules-archived' }, '已归档') : null), itemActions(kind, item))), more);
  }

  async function loadMore(kind) {
    const offset = state.next[kind];
    if (offset === null) return;
    await request(async () => {
      const result = await p.api(`/api/rules/list?kind=${kind}&offset=${offset}`);
      state[kind] = [...state[kind], ...result.items]; state.next[kind] = result.next_offset;
    });
  }

  function editorDialog(kind, item = null) {
    const isModule = kind === 'modules';
    const title = item?.id ? `编辑${isModule ? '规则模块' : '完整方案'}` : `新建${isModule ? '规则模块' : '完整方案'}`;
    const name = p.el('input', { required: true, value: item?.title || '' });
    const domain = p.el('select', {}, domains.map(([key, label]) => option(key, label, item?.domain === key)));
    const body = p.el('textarea', { class: 'rules-body-editor', 'aria-label': '模块正文', value: item?.body || '', onInput: () => { bodySize.textContent = `${new TextEncoder().encode(body.value).length.toLocaleString()} / 65,536 字节`; } });
    const bodySize = p.el('span', { class: 'small muted rules-body-size' }, `${new TextEncoder().encode(body.value).length.toLocaleString()} / 65,536 字节`);
    const bodyPanel = p.el('div', { class: 'markdown-editor-body' });
    const sourceButton = p.button('源码', () => showBody(false), 'file-text');
    const previewButton = p.button('预览', () => showBody(true), 'monitor');
    function showBody(preview) {
      sourceButton.setAttribute('aria-pressed', String(!preview)); previewButton.setAttribute('aria-pressed', String(preview));
      bodyPanel.replaceChildren(preview ? p.documentView(body.value) : body);
    }
    showBody(false);
    const rows = [], variableList = p.el('div', { class: 'rules-param-list' });
    function addVariable(value = {}) {
      const name = p.el('input', { value: value.name || '', 'aria-label': '参数名' });
      const label = p.el('input', { value: value.label || '', 'aria-label': '显示名' });
      const required = p.el('input', { type: 'checkbox', checked: value.required ?? true, 'aria-label': '必填' });
      const row = { name, label, required };
      row.element = p.el('div', { class: 'rules-param-row' }, p.field('参数名', name), p.field('显示名', label),
        p.el('label', { class: 'rules-check' }, required, '必填'), p.tool('删除参数', () => { rows.splice(rows.indexOf(row), 1); row.element.remove(); }, 'x'));
      rows.push(row); variableList.append(row.element);
    }
    for (const v of item?.variables || []) addVariable(v);
    const moduleFields = domains.map(([key, label]) => {
      const matches = state.modules.filter(module => module.domain === key && (!module.archived || item?.modules?.[key] === module.id));
      return p.field(`${label}模块`, p.el('select', { 'data-domain': key }, [option('', key === 'collaboration' ? '不选择' : '选择模块', !item?.modules?.[key]), ...matches.map(module => option(module.id, module.title, item?.modules?.[key] === module.id))]));
    });
    const defaultValues = { ...(item?.defaults || {}) }, defaultFields = p.el('div', { class: 'rules-default-fields' });
    let defaultNames = new Set(), generation = 0, loading = false;
    async function updateDefaults() {
      const version = ++generation; loading = true; submit.disabled = true;
      try {
        const ids = moduleFields.map(field => field.querySelector('select').value).filter(Boolean);
        const modules = await Promise.all(ids.map(id => p.api(`/api/rules/modules/${encode(id)}`)));
        if (version !== generation) return;
        const declared = new Map(); for (const m of modules) for (const v of m.variables) declared.set(v.name, v);
        defaultNames = new Set(declared.keys());
        defaultFields.replaceChildren(...[...declared.values()].map(v => p.field(`${v.label}（默认值）`, p.el('textarea', { rows: 2,
          value: defaultValues[v.name] ?? '', onInput: e => { defaultValues[v.name] = e.target.value; } }))));
      } catch (e) { error.textContent = e.message; error.hidden = false; }
      finally { if (version === generation) { loading = false; submit.disabled = false; } }
    }
    const error = p.el('div', { class: 'notice error', role: 'alert', hidden: true });
    const form = isModule ? [p.field('模块名称', name), p.field('规则领域', domain),
      p.el('div', { class: 'markdown-editor' }, p.el('div', { class: 'segmented', role: 'group', 'aria-label': '模块正文显示方式' }, sourceButton, previewButton), bodyPanel, bodySize),
      p.el('div', { class: 'rules-params' }, p.el('h3', {}, '项目参数'), variableList, p.button('添加参数', () => addVariable(), 'plus'))]
      : [p.field('方案名称', name), ...moduleFields, defaultFields];
    let dialog;
    const submit = p.button(`保存${isModule ? '模块' : '方案'}`, async () => {
      if (!name.value.trim()) { error.textContent = '请填写名称。'; error.hidden = false; return; }
      if (loading) return;
      if (isModule && new TextEncoder().encode(body.value).length > 65536) { error.textContent = '模块正文不能超过 64 KiB。'; error.hidden = false; return; }
      submit.disabled = true;
      try {
        const payload = isModule ? { title: name.value.trim(), domain: domain.value, body: body.value,
          variables: rows.map(row => ({ name: row.name.value.trim(), label: row.label.value.trim() || row.name.value.trim(), required: row.required.checked })) }
          : { title: name.value.trim(), modules: Object.fromEntries(moduleFields.map(field => [field.querySelector('select').dataset.domain, field.querySelector('select').value]).filter(([, value]) => value)),
            defaults: Object.fromEntries(Object.entries(defaultValues).filter(([key, value]) => defaultNames.has(key) && value !== '')) };
        if (item?.id) Object.assign(payload, { id: item.id, revision: item.revision, archived: Boolean(item.archived) });
        else Object.assign(payload, { id: newId(), revision: 0 });
        await p.api(`/api/rules/${kind}`, payload); await refresh(); p.render();
        dialog.close();
      } catch (e) { error.textContent = e.message; error.hidden = false; submit.disabled = false; }
    }, 'check', 'primary');
    dialog = p.modal(title, [error, ...form], [submit]);
    if (!isModule) { for (const field of moduleFields) field.querySelector('select').addEventListener('change', updateDefaults); updateDefaults(); }
  }
  const editModule = item => editorDialog('modules', item);
  const editScheme = item => editorDialog('schemes', item);
  const createModule = () => editModule(null);
  const createScheme = async () => { await request(allModules); editScheme(null); };
  async function restoreItem(kind, item) { await request(async () => { const detail = await p.api(`/api/rules/${kind}/${encode(item.id)}`); await p.api(`/api/rules/${kind}`, { ...detail, archived: false }); await refresh(); }); }

  async function archiveItem(kind, item) {
    if (item.archived) return;
    await request(async () => {
      const detail = await p.api(`/api/rules/${kind}/${encode(item.id)}`);
      await p.api(`/api/rules/${kind}`, { ...detail, archived: true });
      await refresh();
    });
  }

  function beginApply(schemeId) {
    state.application = { schemeId, scheme: null, project: '', hosts: ['codex'], params: {}, mode: 'auto', overwrite: false, preview: null, draftText: '', mergeError: '' };
    if (schemeId) request(async () => { const app = state.application; app.scheme = await p.api(`/api/rules/schemes/${encode(schemeId)}`); app.params = Object.fromEntries(app.scheme.variables.map(v => [v.name, app.scheme.defaults?.[v.name] ?? ''])); });
    else p.render();
  }

  function applyPage() {
    const app = state.application;
    const schemeOptions = [option('', '选择方案', !app.schemeId), ...state.schemes.filter(item => !item.archived).map(item => option(item.id, item.title, item.id === app.schemeId))];
    const schemeSelect = p.el('select', { 'aria-label': '选择方案', value: app.schemeId, onChange: async e => {
      app.schemeId = e.target.value;
      invalidate(app);
      await request(async () => { app.scheme = app.schemeId ? await p.api(`/api/rules/schemes/${encode(app.schemeId)}`) : null; app.params = Object.fromEntries((app.scheme?.variables || []).map(v => [v.name, app.scheme.defaults?.[v.name] ?? ''])); });
    } }, schemeOptions);
    const hostControls = ['codex', 'cursor'].map(host => p.el('label', { class: 'rules-check' }, p.el('input', { type: 'checkbox', checked: app.hosts.includes(host), 'aria-label': host === 'codex' ? 'Codex' : 'Cursor', onChange: e => { invalidate(app); app.hosts = e.target.checked ? [...app.hosts, host] : app.hosts.filter(value => value !== host); } }), host === 'codex' ? 'Codex' : 'Cursor'));
    const vars = (app.scheme?.variables || []).map(variable => p.field(`${variable.label || variable.name}${variable.required ? ' · 必填' : ''}`,
      p.el('textarea', { rows: 2, value: app.params[variable.name] ?? '', onInput: e => { invalidate(app); app.params[variable.name] = e.target.value; }, 'aria-label': `${variable.label || variable.name}${variable.required ? ' · 必填' : ''}` })));
    const mode = p.el('div', { class: 'rules-mode' }, p.el('label', { class: 'rules-check' }, p.el('input', { type: 'radio', name: 'rules-mode', checked: app.mode === 'auto', onChange: () => { invalidate(app); app.mode = 'auto'; app.overwrite = false; p.render(); } }), '保留旧规则并交给 Agent 合并'),
      p.el('label', { class: 'rules-check' }, p.el('input', { type: 'radio', name: 'rules-mode', checked: app.mode === 'overwrite', onChange: () => { invalidate(app); app.mode = 'overwrite'; app.overwrite = true; p.render(); } }), '明确覆盖所选范围'));
    const previewAction = p.button(app.preview ? '重新预览' : '预览应用', () => previewApplication(), 'monitor', 'primary');
    const close = p.button('返回方案', () => { invalidate(app); state.application = null; p.render(); }, 'arrow-left');
    return [heading('应用开发规则', app.scheme?.title || '选择方案、确认参数和目标范围', [close]),
      p.el('div', { class: 'rules-apply-grid' }, p.field('选择方案', schemeSelect), p.field('项目目录', p.el('input', { value: app.project, placeholder: 'D:\\work\\project', 'aria-label': '项目目录', onInput: e => { invalidate(app); app.project = e.target.value; } })),
        p.field('目标工具', p.el('div', { class: 'rules-checks' }, hostControls)), ...vars),
      mode, app.mode === 'overwrite' ? p.el('p', { class: 'notice' }, '本次预览只覆盖已列出的目标文件；此决定仅适用于当前项目和本次预览。') : null,
      p.el('div', { class: 'actions rules-preview-actions' }, previewAction), app.preview ? previewResult() : null];
  }

  async function previewApplication() {
    const app = state.application;
    if (!app.schemeId || !app.project.trim() || !app.hosts.length) { await request(async () => { throw new Error('请填写方案、项目目录并选择至少一个工具。'); }); return; }
    await request(async () => {
      const body = { scheme_id: app.schemeId, project: app.project.trim(), hosts: app.hosts, params: app.params, mode: app.mode };
      if (app.mode === 'overwrite' && app.overwrite) body.overwrite_confirmed = true;
      app.preview = await p.api('/api/rules/preview', body);
      app.draftText = JSON.stringify(app.preview.draft_example, null, 2);
      app.mergeError = '';
    });
  }

  function previewResult() {
    const app = state.application, preview = app.preview;
    const modeLabel = preview.mode === 'create' ? '首次导入' : preview.mode === 'merge' ? 'Agent 合并' : '确认覆盖';
    const files = (preview.files || []).map(file => p.el('section', { class: 'rules-diff-file' }, p.el('h3', {}, file.path),
      p.el('div', { class: 'rules-diff-columns' }, p.el('div', {}, p.el('h4', {}, '当前内容'), p.el('pre', {}, file.before ?? '（文件不存在）')),
        p.el('div', {}, p.el('h4', {}, '拟写入内容'), p.el('pre', {}, file.after)))));
    const guidance = (preview.guidance || []).map(file => p.el('section', { class: 'rules-guidance' }, p.el('h3', {}, file.path), p.el('span', { class: 'small muted' }, `${file.scope} · ${file.editable ? '已选目标' : '只读'}`), p.el('pre', {}, file.content)));
    const status = p.el('div', { class: `rules-preview-status mode-${preview.mode}` }, p.el('strong', {}, modeLabel), p.el('p', {}, preview.requires_merge ? '等待当前 Agent 的语义合并草案' : '等待确认写入'));
    const mergeControls = preview.requires_merge ? [p.el('div', { class: 'rules-handoff' }, p.el('h3', {}, '交给当前 Agent 合并'),
      p.el('pre', { class: 'rules-task' }, preview.task || ''), p.el('div', { class: 'actions' }, p.button('复制合并任务', async () => { try { await navigator.clipboard.writeText(preview.task || ''); } catch { p.modal('复制合并任务', p.field('合并任务', p.el('textarea', { value: preview.task || '', readOnly: true }))); } }, 'copy'),
        p.button('下载任务', () => download('merge-task.md', preview.task || ''), 'arrow-right')),
      p.field('合并草案 JSON', p.el('textarea', { class: 'rules-json-editor', value: app.draftText, 'aria-label': '合并草案 JSON', onInput: e => { app.draftText = e.target.value; } })),
      app.mergeError ? p.el('div', { class: 'notice error', role: 'alert' }, app.mergeError) : null,
      p.button('导入合并草案', () => mergeDraft(), 'file-text', 'primary'))] : [];
    const canApply = preview.can_apply && !preview.requires_merge;
    return p.el('section', { class: 'rules-preview' }, status, p.el('p', { class: 'small muted' }, `方案修订 ${preview.scheme?.revision ?? '—'} · 参数已冻结 · ${preview.files.length} 个目标文件`),
      guidance.length ? p.el('div', { class: 'rules-guidance-list' }, p.el('h3', {}, '审阅资料与现有规则'), guidance) : null,
      p.el('p', { class: 'small muted' }, (preview.limitations || []).join(' ')),
      p.el('div', { class: 'rules-diff-list' }, p.el('h3', {}, '文件差异'), files),
      mergeControls,
      canApply ? p.el('div', { class: 'rules-approve' }, p.el('p', {}, '批准后仅写入上方列出的文件。'), p.button('批准并写入', () => applyPlan(), 'check', 'primary')) : null,
      preview.results ? p.el('div', { class: 'rules-results' }, preview.results.map(result => p.el('div', {},
        p.el('p', {}, `${result.path} · ${result.status}${result.error ? ` · ${result.error}` : ''}`),
        result.warning ? p.el('p', { class: 'notice error', role: 'alert' }, result.warning) : null,
        result.recovery_file ? p.el('p', { class: 'small muted' }, `原文件恢复副本：${result.recovery_file}`) : null))) : null,
      p.button('取消本次预览', () => cancelPlan(), 'x'));
  }

  async function mergeDraft() {
    const app = state.application;
    try {
      const draft = parseJson(app.draftText, '合并草案必须是有效 JSON。');
      await request(async () => {
        try { app.preview = await p.api('/api/rules/merge', { plan_id: app.preview.id, draft }); app.mergeError = ''; }
        catch (error) { app.mergeError = error.message; }
      });
    } catch (error) { app.mergeError = error.message; p.render(); }
  }
  async function applyPlan() {
    const app = state.application;
    await request(async () => { const result = await p.api('/api/rules/apply', { plan_id: app.preview.id, approved: true }); app.preview = { ...app.preview, results: result.results, can_apply: false }; });
  }
  async function cancelPlan() {
    const app = state.application;
    await request(async () => { if (app.preview?.id) await p.api('/api/rules/cancel', { plan_id: app.preview.id }); app.preview = null; });
  }
  function download(filename, content) {
    const link = p.el('a', { href: URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })), download: filename });
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function render() {
    if (!state.loaded) return [heading('开发规则', '模板库状态'), p.el('div', { class: 'empty' }, '正在读取规则库')];
    if (state.unavailable) return [heading('开发规则'), p.el('div', { class: 'empty' }, '开发规则暂不可用')];
    if (!state.library?.configured) return [heading('开发规则', '独立的规则模块与完整方案'), libraryPanel()];
    if (state.application) return applyPage();
    const kind = state.tab === 'modules' ? 'modules' : 'schemes';
    return [heading('开发规则', '按方案配置和应用项目规则', [p.button('使用通用方案', () => request(async () => { await p.api('/api/rules/starter', {}); await refresh(); }), 'layers'), p.button('应用方案', () => beginApply(''), 'arrow-right', 'primary'),
      p.button(kind === 'modules' ? '新建模块' : '新建方案', kind === 'modules' ? createModule : createScheme, 'plus')]),
      libraryPanel(), p.el('div', { class: 'rules-tabs', role: 'tablist' }, tabButton('schemes', '方案'), tabButton('modules', '模块')),
      itemList(kind)];
  }

  window.BizRulesUI = { load, render };
})();
