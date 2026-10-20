import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.BIZ_PROJECT_TEST_MODULES ? path.join(process.env.BIZ_PROJECT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-rules-ui-test-'));
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-rules-ui-screenshots-'));
const home = path.join(sandbox, 'home');
const config = path.join(home, '.config', 'biz-project', 'config.json');
const library = path.join(sandbox, 'rules-library');
const project = path.join(sandbox, 'new-project');
const codexRules = path.join(project, 'AGENTS.md');
fs.mkdirSync(project, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home };
for (const key of ['BIZ_PROJECT_HOME', 'PROJECT_RECORDS_HOME', 'CODEX_HOME']) delete env[key];

let child, browser;
try {
  child = spawn(process.execPath, [path.join(source, 'scripts/platform-web.mjs'), '--no-open', '--port', '0', '--config', config], { env, cwd: source, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${errors}`)), 15000);
    child.stderr.on('data', data => { errors += data; });
    child.stdout.on('data', data => { output += data; for (const line of output.split('\n')) { try { const value = JSON.parse(line); if (value.url) { clearTimeout(timeout); resolve(value.url); } } catch {} } });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${errors}`)); });
  });
  browser = await chromium.launch({ channel: process.env.BIZ_PROJECT_TEST_BROWSER || 'msedge', headless: true });
  const legacy = await browser.newPage({ viewport: { width: 1366, height: 900 } }), legacyErrors = [];
  legacy.on('pageerror', error => legacyErrors.push(error.message));
  await legacy.route('**/rules.js', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: '没有此接口。', code: 'NOT_FOUND' }) }));
  await legacy.goto(url);
  await legacy.getByRole('button', { name: '开发规则', exact: true }).click();
  await legacy.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  assert.equal(await legacy.getByRole('button', { name: '项目', exact: true }).isEnabled(), true, 'Missing rules assets must not leave all navigation disabled');
  assert.deepEqual(legacyErrors, [], 'Missing rules module is a recoverable error, not a second render exception');
  await legacy.getByRole('alert').filter({ hasText: /重启.*服务|服务.*重启/ }).waitFor();
  await legacy.getByRole('button', { name: '工作总览', exact: true }).click();
  await legacy.getByRole('heading', { name: '工作总览', exact: true }).waitFor();
  await legacy.close();

  const oldApi = await browser.newPage(), oldApiErrors = [];
  oldApi.on('pageerror', error => oldApiErrors.push(error.message));
  await oldApi.route('**/api/rules/state', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: '没有此接口。', code: 'NOT_FOUND' }) }));
  await oldApi.goto(url);
  await oldApi.getByRole('button', { name: '开发规则', exact: true }).click();
  await oldApi.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  assert.equal(await oldApi.getByRole('button', { name: '选择模板库位置', exact: true }).count(), 0, 'An unsupported rules API must not display a library creation action');
  await oldApi.getByRole('alert').filter({ hasText: /重启.*服务|服务.*重启/ }).waitFor();
  assert.equal(await oldApi.getByRole('button', { name: '项目', exact: true }).isEnabled(), true);
  await oldApi.unroute('**/api/rules/state');
  await oldApi.getByRole('button', { name: '刷新当前页面', exact: true }).click();
  await oldApi.getByRole('button', { name: '选择模板库位置', exact: true }).waitFor();
  assert.deepEqual(oldApiErrors, []);
  await oldApi.close();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/api/')) errors.push(`Static resource failed: ${response.status()} ${response.url()}`); });
  const visible = locator => locator.waitFor({ state: 'visible', timeout: 10000 });
  await page.goto(url);
  await visible(page.getByRole('button', { name: '开发规则', exact: true }));
  await page.getByRole('button', { name: '开发规则', exact: true }).click();
  await visible(page.getByRole('heading', { name: '开发规则', exact: true }));
  await visible(page.getByText('尚未确认模板库', { exact: true }));
  assert.equal(fs.existsSync(library), false, 'Opening the rules workspace must not create a library before the owner confirms a path');

  await page.getByRole('button', { name: '选择模板库位置', exact: true }).click();
  const libraryDialog = page.getByRole('dialog', { name: '确认模板库位置', exact: true });
  await visible(libraryDialog);
  await libraryDialog.getByRole('textbox', { name: '模板库路径', exact: true }).fill(library);
  await libraryDialog.getByRole('button', { name: '确认并创建模板库', exact: true }).click();
  await visible(page.getByText(library, { exact: true }));

  const domains = ['lifecycle', 'development', 'verification', 'release'];
  const domainLabels = { lifecycle: '生命周期', development: '开发', verification: '验证', release: '发布' };
  for (const domain of domains) {
    await page.getByRole('button', { name: '模块', exact: true }).click();
    await page.getByRole('button', { name: '新建模块', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '新建规则模块', exact: true });
    await visible(editor);
    await editor.getByRole('textbox', { name: '模块名称', exact: true }).fill(`${domainLabels[domain]}基线`);
    await editor.getByRole('combobox', { name: '规则领域', exact: true }).selectOption(domain);
    await editor.getByRole('textbox', { name: '模块正文', exact: true }).fill(`# ${domainLabels[domain]}\n\n项目开发时遵循 ${domainLabels[domain]} 规则。`);
    if (domain === 'release') {
      await editor.getByRole('textbox', { name: '模块正文', exact: true }).fill('# 发布\n\n验收：{{test_value}}');
      await editor.getByRole('button', { name: '添加参数', exact: true }).click();
      await editor.getByRole('textbox', { name: '参数名', exact: true }).fill('test_value');
      await editor.getByRole('textbox', { name: '显示名', exact: true }).fill('发布验收说明');
    }
    await editor.getByRole('button', { name: '保存模块', exact: true }).click();
    await visible(page.getByText(`${domainLabels[domain]}基线`, { exact: true }));
  }

  await page.getByRole('button', { name: '方案', exact: true }).click();
  await page.getByRole('button', { name: '新建方案', exact: true }).click();
  const schemeEditor = page.getByRole('dialog', { name: '新建完整方案', exact: true });
  await visible(schemeEditor);
  await schemeEditor.getByRole('textbox', { name: '方案名称', exact: true }).fill('本地安全开发');
  for (const domain of domains) await schemeEditor.getByRole('combobox', { name: `${domainLabels[domain]}模块`, exact: true }).selectOption({ label: `${domainLabels[domain]}基线` });
  await schemeEditor.getByRole('textbox', { name: '发布验收说明（默认值）', exact: true }).fill('User confirmed evidence');
  await schemeEditor.getByRole('button', { name: '保存方案', exact: true }).click();
  await visible(page.getByRole('heading', { name: '本地安全开发', exact: true }));

  const primaryScheme = () => page.locator('.rules-item').filter({ has: page.getByRole('heading', { name: '本地安全开发', exact: true }) });
  await primaryScheme().getByRole('button', { name: '编辑', exact: true }).click();
  const editScheme = page.getByRole('dialog', { name: '编辑完整方案', exact: true });
  await visible(editScheme);
  await editScheme.getByRole('textbox', { name: '发布验收说明（默认值）', exact: true }).fill('User confirmed evidence');
  await editScheme.getByRole('button', { name: '保存方案', exact: true }).click();
  await visible(primaryScheme().getByText('完整方案 · 修订 2', { exact: true }));
  await primaryScheme().getByRole('button', { name: '复制', exact: true }).click();
  const copyScheme = page.getByRole('dialog', { name: '新建完整方案', exact: true });
  await visible(copyScheme);
  await visible(copyScheme.getByRole('textbox', { name: '发布验收说明（默认值）', exact: true }));
  await copyScheme.getByRole('button', { name: '保存方案', exact: true }).click();
  await visible(page.getByRole('heading', { name: '本地安全开发 副本', exact: true }));
  await primaryScheme().getByRole('button', { name: '归档', exact: true }).click();
  await visible(primaryScheme().getByText('已归档', { exact: true }));
  await primaryScheme().getByRole('button', { name: '恢复', exact: true }).click();
  await visible(primaryScheme().getByRole('button', { name: '归档', exact: true }));
  await page.getByRole('button', { name: '使用通用方案', exact: true }).click();
  await visible(page.getByRole('heading', { name: '通用开发方案', exact: true }));
  await page.screenshot({ path: path.join(screenshots, 'rules-library-desktop.png'), fullPage: true });

  await primaryScheme().getByRole('button', { name: '应用方案', exact: true }).click();
  await visible(page.getByRole('heading', { name: '应用开发规则', exact: true }));
  await page.getByRole('combobox', { name: '选择方案', exact: true }).selectOption({ label: '本地安全开发' });
  await visible(page.locator('.rules-heading p').filter({ hasText: '本地安全开发' }));
  await page.getByRole('textbox', { name: '项目目录', exact: true }).fill(project);
  await page.getByRole('button', { name: '预览应用', exact: true }).click();
  await visible(page.getByText('首次导入', { exact: true }));
  await page.screenshot({ path: path.join(screenshots, 'rules-preview-desktop.png'), fullPage: true });
  assert.equal(fs.existsSync(codexRules), false, 'Preview must not write the selected project rules');
  await page.getByRole('textbox', { name: '项目目录', exact: true }).fill(project + '-changed');
  assert.equal(await page.getByRole('button', { name: '批准并写入', exact: true }).count(), 0, 'Editing the target invalidates the frozen approval');
  await page.getByRole('textbox', { name: '项目目录', exact: true }).fill(project);
  await page.getByRole('button', { name: '预览应用', exact: true }).click();
  await page.getByRole('button', { name: '批准并写入', exact: true }).click();
  await visible(page.getByText(/applied|unchanged/));
  assert.ok(fs.existsSync(codexRules), 'Applying after explicit approval writes the selected project rules');
  assert.ok(fs.readFileSync(codexRules, 'utf8').includes('User confirmed evidence'), 'Visible defaults are included in the confirmed parameters');

  fs.writeFileSync(codexRules, '# Existing project rules\n\nKeep these decisions.\n');
  await page.getByRole('button', { name: '重新预览', exact: true }).click();
  await visible(page.getByText('Agent 合并', { exact: true }));
  assert.equal(await page.getByRole('button', { name: '批准并写入', exact: true }).count(), 0, 'Merge plans cannot write before a draft is imported');
  await page.getByRole('button', { name: '导入合并草案', exact: true }).click();
  await visible(page.getByRole('textbox', { name: '合并草案 JSON', exact: true }));
  const resolvedDraft = JSON.parse(await page.getByRole('textbox', { name: '合并草案 JSON', exact: true }).inputValue());
  resolvedDraft.summary = 'Preserve the existing project decisions and incorporate the selected scheme.';
  resolvedDraft.unresolved = [];
  resolvedDraft.files = resolvedDraft.files.map(file => ({ ...file, reason: 'Keep the existing decisions while integrating the required lifecycle, development, verification, and release rules.' }));
  await page.getByRole('textbox', { name: '合并草案 JSON', exact: true }).fill(JSON.stringify({ summary: 'Draft', unresolved: ['Need to resolve a conflict.'], files: [] }));
  await page.getByRole('button', { name: '导入合并草案', exact: true }).last().click();
  await visible(page.getByRole('alert'));
  assert.equal(fs.readFileSync(codexRules, 'utf8'), '# Existing project rules\n\nKeep these decisions.\n', 'An unresolved merge draft cannot modify source files');
  await page.getByRole('textbox', { name: '合并草案 JSON', exact: true }).fill(JSON.stringify(resolvedDraft));
  await page.getByRole('button', { name: '导入合并草案', exact: true }).last().click();
  await visible(page.getByRole('button', { name: '批准并写入', exact: true }));
  await page.getByRole('button', { name: '批准并写入', exact: true }).click();
  await visible(page.getByText(/applied|unchanged/));

  fs.writeFileSync(codexRules, '# Existing project rules\n\nKeep these decisions.\n');
  await page.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: '预览应用', exact: true }).click();
  await visible(page.getByText('确认覆盖', { exact: true }));
  assert.equal(fs.readFileSync(codexRules, 'utf8'), '# Existing project rules\n\nKeep these decisions.\n', 'An overwrite preview cannot modify the project');
  await page.getByRole('button', { name: '批准并写入', exact: true }).click();
  await visible(page.getByText(/applied|unchanged/));
  assert.notEqual(fs.readFileSync(codexRules, 'utf8'), '# Existing project rules\n\nKeep these decisions.\n', 'An explicitly approved overwrite applies the reviewed rules');

  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: path.join(screenshots, 'rules-mobile-320.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Rules UI must fit at a 320px viewport');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('button')].filter(node => node.getBoundingClientRect().width && node.scrollWidth > node.clientWidth + 2).map(node => node.textContent)), [], 'Mobile button labels must fit');
  assert.deepEqual(errors, [], 'Rules pages and local assets load without browser errors');
  console.log(JSON.stringify({ ok: true, screenshots, flows: ['missing module restores navigation without render errors', 'unsupported API blocks creation and recovers on refresh', 'missing records center does not block rules UI', 'library path requires explicit confirmation', 'module parameter forms and scheme defaults', 'edit/copy/archive/restore schemes', 'explicit starter scheme', 'first apply writes only after approval', 'target edit invalidates preview', 'existing rules require an imported resolved merge draft', 'explicit overwrite approval', '320px mobile layout'] }, null, 2));
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000).unref(); }); }
  for (const directory of [sandbox]) {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep), 'Test cleanup stays under the OS temporary directory');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
