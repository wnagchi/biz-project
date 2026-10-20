import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.BIZ_PROJECT_TEST_MODULES
  ? path.join(process.env.BIZ_PROJECT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-web-ui-test-'));
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-project-web-screenshots-'));
const home = path.join(sandbox, 'home'), parent = path.join(sandbox, 'work');
const first = path.join(parent, 'first project'), second = path.join(parent, '中文 & 项目');
const records = path.join(sandbox, 'records'), config = path.join(home, '.config/biz-project/config.json');
for (const p of [home, first, second]) fs.mkdirSync(p, { recursive: true });
fs.writeFileSync(path.join(first, 'AGENTS.md'), '# Original local rules\n');
const cursorFile = path.join(first, '.cursor/rules/biz-project.mdc');
fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
fs.writeFileSync(cursorFile, '---\nalwaysApply: false\n---\nKeep original\n');
const environment = { ...process.env, HOME: home, USERPROFILE: home };
for (const key of ['BIZ_PROJECT_HOME', 'PROJECT_RECORDS_HOME', 'CODEX_HOME']) delete environment[key];
let child, browser;
const errors = [];
try {
  child = spawn(process.execPath, [path.join(source, 'scripts/setup-web.mjs'), '--no-open', '--port', '0', '--config', config],
    { env: environment, cwd: source, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '', stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 15000);
    child.stderr.on('data', data => { stderr += data; });
    child.stdout.on('data', data => {
      output += data;
      for (const line of output.split('\n')) {
        try { const value = JSON.parse(line); if (value.url) { clearTimeout(timeout); resolve(value.url); } }
        catch { /* Ready messages may arrive in chunks. */ }
      }
    });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${stderr}`)); });
  });
  browser = await chromium.launch({ channel: process.env.BIZ_PROJECT_TEST_BROWSER || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const expectVisible = async (locator, timeout = 10000) => {
    try { await locator.waitFor({ state: 'visible', timeout }); }
    catch (error) {
      await page.screenshot({ path: path.join(screenshots, 'failure.png'), fullPage: true });
      console.error(JSON.stringify({ screenshots, body: await page.locator('body').innerText(), errors }, null, 2));
      throw error;
    }
  };
  const capture = async name => {
    assert.ok(await page.getByRole('button', { name: '打开项目管理', exact: true }).isVisible(), 'Management entry remains visible at each step');
    const filename = path.join(screenshots, name + '.png');
    const pixels = PNG.sync.read(await page.screenshot({ path: filename, fullPage: true }));
    let colored = 0;
    for (let i = 0; i < pixels.data.length; i += 4) if (Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) < 230) colored += 1;
    assert.ok(colored > pixels.width * pixels.height * .015, 'Screenshot must contain rendered content');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Page must not overflow horizontally');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('button')].filter(button => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && button.scrollWidth > button.clientWidth + 2;
    }).map(button => button.textContent)), [], 'Button text must fit');
  };
  const verifyCenterLayout = async name => {
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(screenshots, `${name}-${viewport.width}.png`), fullPage: true });
      const geometry = await page.locator('.center-option').evaluateAll(rows => rows.map(row => {
        const bounds = node => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, right: rect.right, width: rect.width, height: rect.height };
        };
        return { row: bounds(row), radio: bounds(row.querySelector('input')), details: bounds(row.querySelector('.center-details')),
          title: bounds(row.querySelector('strong')), badge: bounds(row.querySelector('.badge')) };
      }));
      assert.ok(geometry.length > 0, 'Center candidates must be rendered');
      for (const dimensions of geometry) {
        const detail = JSON.stringify({ viewport, ...dimensions });
        assert.ok(dimensions.radio.width >= 12 && dimensions.radio.width <= 24, `Radio must not take text-input width: ${detail}`);
        assert.ok(dimensions.radio.height >= 12 && dimensions.radio.height <= 24, `Radio must keep its native control size: ${detail}`);
        assert.ok(dimensions.details.width >= (viewport.width > 650 ? dimensions.row.width / 2 : 100), `Center text must have readable width: ${detail}`);
        assert.ok(dimensions.row.height < 220, `Candidate must not grow from character-by-character wrapping: ${detail}`);
        assert.ok(dimensions.title.height < 40, `Center title must not wrap character by character: ${detail}`);
        assert.ok(dimensions.details.x >= dimensions.radio.right && dimensions.badge.x >= dimensions.details.right - 1,
          `Center controls, text and badge must not overlap: ${detail}`);
      }
      await capture(`${name}-${viewport.width}`);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
  };
  await page.goto(url);
  await expectVisible(page.getByRole('heading', { name: '确认记录中心' }), 30000);
  assert.equal(await page.getByRole('button', { name: '确认并继续' }).isDisabled(), true);
  await capture('desktop-center');
  const standalone = await browser.newPage();
  standalone.on('pageerror', error => errors.push(error.message));
  await standalone.goto(url);
  await standalone.getByRole('button', { name: '打开项目管理', exact: true }).waitFor({ timeout: 30000 });
  await standalone.getByRole('button', { name: '打开项目管理', exact: true }).click();
  await standalone.getByRole('heading', { name: '工作总览', exact: true }).waitFor({ timeout: 10000 });
  assert.ok(await standalone.getByText('记录中心不可用', { exact: true }).isVisible());
  assert.equal(fs.existsSync(config), false); assert.equal(fs.existsSync(records), false);
  await standalone.close();
  const browse = async (open, value) => {
    await page.getByRole('button', { name: open, exact: true }).click();
    await expectVisible(page.getByRole('dialog'));
    await page.getByRole('textbox', { name: '目录路径', exact: true }).fill(value);
    await page.getByRole('button', { name: '前往目录' }).click();
    try {
      await page.waitForFunction(value => document.querySelector('#directory-path').value === value
        && !document.querySelector('#select-directory').disabled, value, { timeout: 5000 });
    } catch (error) {
      console.error(JSON.stringify(await page.evaluate(() => ({ path: document.querySelector('#directory-path').value,
        disabled: document.querySelector('#select-directory').disabled, error: document.querySelector('#directory-error').textContent,
        list: document.querySelector('#directory-list').textContent })), null, 2));
      await page.screenshot({ path: path.join(screenshots, 'failure.png'), fullPage: true });
      throw error;
    }
  };
  await browse('选择其他目录', sandbox);
  await page.getByRole('button', { name: '新目录', exact: true }).click();
  await page.getByLabel('新目录名称').fill('records');
  await page.getByRole('button', { name: '使用此目录' }).click();
  assert.equal(fs.existsSync(records), false);
  await verifyCenterLayout('selected-center');
  await page.getByRole('button', { name: '确认并继续' }).click();
  await expectVisible(page.getByRole('heading', { name: '选择项目与工具' }));
  await browse('浏览项目父目录', parent);
  await page.getByRole('button', { name: '列出此处项目' }).click();
  await expectVisible(page.getByRole('checkbox', { name: '选择 first project', exact: true }));
  assert.equal(await page.getByRole('checkbox', { name: '选择 first project', exact: true }).isChecked(), false);
  await page.getByRole('checkbox', { name: '全选当前列表' }).check();
  await page.getByRole('checkbox', { name: '中文 & 项目 Cursor', exact: true }).uncheck();
  await page.getByRole('searchbox', { name: '搜索项目' }).fill('first');
  assert.equal(await page.getByRole('checkbox', { name: '选择 中文 & 项目', exact: true }).count(), 0);
  await page.getByRole('searchbox', { name: '搜索项目' }).fill('');
  await page.getByRole('button', { name: '检查接入状态' }).click();
  await expectVisible(page.getByText('cursor: 有冲突', { exact: true }));
  await capture('desktop-projects');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('mobile-projects');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: '预览修改', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: '确认安装修改' }));
  assert.equal(await page.getByRole('button', { name: '确认安装', exact: true }).isDisabled(), true);
  assert.equal(await page.getByText(source, { exact: true }).count(), 1, 'Preview must identify the linked skill source');
  assert.equal(fs.existsSync(records), false);
  await capture('desktop-preview');
  await page.getByRole('button', { name: '上一步' }).click();
  await expectVisible(page.getByRole('heading', { name: '选择项目与工具' }));
  assert.equal(await page.locator('#steps button').nth(2).isDisabled(), true, 'Returning to edit must invalidate preview navigation');
  assert.equal(await page.getByRole('checkbox', { name: '选择 first project', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: '中文 & 项目 Cursor', exact: true }).isChecked(), false);
  await page.getByRole('button', { name: '预览修改', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: '确认安装修改' }));
  await page.getByRole('checkbox', { name: '确认使用上述记录中心，并允许执行预览中的登记与规则修改' }).check();
  await page.getByRole('button', { name: '确认安装', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: '部分入口未接入' }));
  const registry = JSON.parse(fs.readFileSync(path.join(records, 'registry.json')));
  assert.equal(Object.keys(registry.projects).length, 2);
  assert.ok(Object.values(registry.projects).some(p => p.hosts.codex && !p.hosts.cursor));
  assert.ok(fs.readFileSync(path.join(first, 'AGENTS.md'), 'utf8').startsWith('# Original local rules\n'));
  assert.equal(fs.readFileSync(cursorFile, 'utf8'), '---\nalwaysApply: false\n---\nKeep original\n');
  await capture('desktop-partial-result');
  fs.writeFileSync(cursorFile, '---\nalwaysApply: true\n---\nKeep original\n');
  await page.getByRole('button', { name: '仅重试失败项' }).click();
  await expectVisible(page.getByRole('heading', { name: '选择项目与工具' }));
  assert.equal(await page.getByRole('checkbox', { name: '选择 first project', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: '选择 中文 & 项目', exact: true }).isChecked(), false);
  await page.getByRole('button', { name: '预览修改', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: '确认安装修改' }));
  assert.ok((await page.getByText('1 个项目 · 1 个工具入口').count()) === 1);
  await page.getByRole('checkbox', { name: '确认使用上述记录中心，并允许执行预览中的登记与规则修改' }).check();
  await page.getByRole('button', { name: '确认安装', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: '项目接入完成' }));
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(records, 'registry.json'))).projects).length, 2);
  await capture('desktop-result');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('mobile-result');
  await page.reload();
  await expectVisible(page.getByRole('radio', { name: '当前配置', exact: true }), 30000);
  assert.equal(await page.getByRole('radio', { name: '当前配置', exact: true }).isChecked(), true, 'A previously confirmed center is selected when adding another project');
  assert.equal(await page.getByRole('button', { name: '确认并继续' }).isEnabled(), true);
  await verifyCenterLayout('configured-center');
  const legacy = path.join(home, '.project-records');
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'registry.json'), JSON.stringify({ kind: 'project-records', schema_version: 1, projects: {} }));
  const unchangedConfig = fs.readFileSync(config, 'utf8'), unchangedRegistry = fs.readFileSync(path.join(records, 'registry.json'), 'utf8');
  await page.reload();
  await expectVisible(page.getByRole('radio', { name: '旧记录中心', exact: true }), 30000);
  assert.equal(await page.getByRole('radio', { name: '旧记录中心', exact: true }).isChecked(), false, 'A legacy center stays unselected beside a confirmed center');
  assert.equal(await page.getByRole('radio', { name: '当前配置', exact: true }).isChecked(), true);
  await verifyCenterLayout('configured-and-legacy-centers');
  await page.getByRole('radio', { name: '当前配置', exact: true }).check();
  assert.equal(await page.getByRole('button', { name: '确认并继续' }).isEnabled(), true);
  await verifyCenterLayout('configured-center-selected');
  assert.equal(fs.readFileSync(config, 'utf8'), unchangedConfig, 'Selecting a center must not update its pointer');
  assert.equal(fs.readFileSync(path.join(records, 'registry.json'), 'utf8'), unchangedRegistry, 'Selecting a center must not write records');
  const confirmedRegistry = JSON.parse(unchangedRegistry);
  fs.writeFileSync(path.join(records, 'registry.json'), JSON.stringify({ ...confirmedRegistry, kind: 'project-records' }));
  await page.reload();
  await expectVisible(page.getByRole('radio', { name: '当前配置', exact: true }), 30000);
  assert.equal(await page.getByText('需确认', { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('radio', { name: '当前配置', exact: true }).isChecked(), false, 'An unconfirmed center is not preselected');
  assert.equal(await page.getByRole('button', { name: '确认并继续' }).isDisabled(), true);
  fs.writeFileSync(path.join(records, 'registry.json'), unchangedRegistry);
  assert.deepEqual(errors, []);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '停止向导服务', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: '向导已退出' }));
  console.log(JSON.stringify({ ok: true, verified: ['center selection', 'directory browsing', 'batch and per-project tools',
    'search', 'back navigation', 'preview consent', 'partial result', 'failed-only retry', 'desktop/mobile layout',
    'new/configured/legacy center layout at 1366/390/320px', 'center selection remains read-only', 'standalone management navigation without enrollment', 'management entry at every step', 'shutdown'], screenshots }, null, 2));
} finally {
  if (browser) await browser.close();
  if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  assert.equal(path.dirname(sandbox), os.tmpdir());
  assert.ok(path.basename(sandbox).startsWith('biz-project-web-ui-test-'));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
