import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { inspectRecordsCenter } from './projects.mjs';
import { prepareSetup, applySetup } from './setup.mjs';
import { canonical, homeDirectory, sourceDirectory } from './storage.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']], ['/icons.svg', ['icons.svg', 'image/svg+xml']]
]);

function error(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function absolute(value) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value) || value.includes('\0')) {
    throw error('请选择有效的绝对目录路径。');
  }
  return canonical(value);
}

function directoryRoots() {
  const roots = [homeDirectory, path.dirname(sourceDirectory)];
  if (process.platform === 'win32') {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`;
      if (fs.existsSync(root)) roots.push(root);
    }
  } else roots.push('/');
  return [...new Set(roots.map(canonical))].map(root => ({ path: root,
    name: root === canonical(homeDirectory) ? '用户目录' : root }));
}

function listDirectories(value, showHidden) {
  const directory = absolute(value);
  if (!fs.statSync(directory).isDirectory()) throw error('所选路径不是目录。');
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (!showHidden && (entry.name.startsWith('.') || entry.name === 'node_modules')) continue;
    const filename = path.join(directory, entry.name);
    try {
      if (!entry.isDirectory() && !(entry.isSymbolicLink() && fs.statSync(filename).isDirectory())) continue;
      directories.push({ name: entry.name, path: filename,
        project_hint: ['.git', 'AGENTS.md', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'SKILL.md']
          .some(marker => fs.existsSync(path.join(filename, marker))) });
    } catch { /* Inaccessible entries do not block browsing sibling directories. */ }
  }
  directories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const parent = path.dirname(directory);
  return { path: directory, parent: parent === directory ? null : parent,
    directories: directories.slice(0, 1000), truncated: directories.length > 1000 };
}

async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw error('请求必须使用 JSON。', 415);
  const chunks = [];
  let size = 0;
  for await (const bytes of request) {
    size += bytes.length;
    if (size > 65536) throw error('请求过大。', 413);
    chunks.push(bytes);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw error('请求内容无效，请重新操作。'); }
}

function publicPlan(plan, id) {
  return { plan_id: id, records_root: plan.records_root, config_file: plan.config_file,
    registry_file: plan.registry_file, installation: plan.installation, items: plan.items };
}

export async function startSetupWeb(options = {}) {
  if (options.platformUrl) {
    const parent = new URL(options.platformUrl);
    if (!['http:', 'https:'].includes(parent.protocol) || parent.hostname !== '127.0.0.1'
      || parent.username || parent.password || parent.pathname !== '/') throw error('Invalid local management URL.');
  }
  const token = randomBytes(32).toString('hex');
  const plans = new Map();
  let platform = null, platformOpening = null;
  const managementUrl = async () => {
    if (options.platformUrl) return options.platformUrl;
    const center = platform && !platform.owned
      ? inspectRecordsCenter({ config: options.configFile, 'records-root': options.recordsRoot }) : null;
    if (!platform || !platform.server || platform.server.listening === false
      || (center?.registry && !center.records_root_confirmation_required)) {
      platformOpening ??= (async () => {
        if (platform && !platform.owned) await platform.close();
        const { startSharedPlatform } = await import('./shared-platform.mjs');
        return startSharedPlatform({ configFile: options.configFile, recordsRoot: options.recordsRoot, connectionHome: options.connectionHome });
      })()
        .then(value => { platform = value; return value; }).finally(() => { platformOpening = null; });
      await platformOpening;
    }
    return platform.url;
  };
  let origin;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    try {
      if (request.headers.host !== new URL(origin).host) throw error('拒绝非本机服务地址。', 403);
      const url = new URL(request.url, origin);
      const asset = assets.get(url.pathname);
      if (asset && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
        response.end(fs.readFileSync(path.join(sourceDirectory, 'web', asset[0])));
        return;
      }
      if (!url.pathname.startsWith('/api/')) { send(404, { error: '没有此页面。' }); return; }
      const provided = Buffer.from(String(request.headers['x-biz-token'] ?? ''));
      if (provided.length !== token.length || !timingSafeEqual(provided, Buffer.from(token))
        || (request.headers.origin !== undefined && request.headers.origin !== origin)
        || request.headers['sec-fetch-site'] === 'cross-site'
        || (request.method === 'POST' && request.headers.origin !== origin)) {
        throw error('会话无效或请求来源不受信任。请使用启动器给出的本机链接。', 403);
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        let discovery = null, discoveryError = null;
        try { discovery = inspectRecordsCenter({ config: options.configFile,
          'records-root': options.recordsRoot }); }
        catch (cause) { discoveryError = cause.message; }
        send(200, { has_platform: Boolean(options.platformUrl), records_root: discovery?.records_root ?? options.recordsRoot ?? null, records_root_confirmed: false,
          confirmation_required: discovery?.records_root_confirmation_required ?? true,
          legacy_centers: discovery?.legacy_records_centers ?? [], discovery_error: discoveryError,
          config_file: discovery?.config_file ?? options.configFile ?? path.join(homeDirectory, '.config/biz-project/config.json'),
          source: sourceDirectory, install_target: path.join(homeDirectory, '.agents/skills/biz-project'),
          roots: directoryRoots(), home: homeDirectory });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/directories') {
        send(200, listDirectories(url.searchParams.get('path'), url.searchParams.get('hidden') === 'true'));
        return;
      }
      if (request.method !== 'POST') throw error('此接口不支持该请求方法。', 405);
      const body = await readBody(request);
      if (url.pathname === '/api/platform') {
        send(200, { url: await managementUrl() });
        return;
      }
      if (url.pathname === '/api/preview') {
        if (!Array.isArray(body.projects) || !body.projects.length || body.projects.length > 200) {
          throw error('请选择 1 至 200 个项目。');
        }
        const selected = { projects: body.projects.map(absolute), hosts: body.hosts,
          recordsRoot: absolute(body.recordsRoot), configFile: options.configFile,
          projectHosts: body.projectHosts };
        const plan = prepareSetup(selected);
        const id = randomUUID();
        // Bound session memory; previews expire and are consumed on apply/cancel.
        for (const [key, value] of plans) if (Date.now() - value.created > 30 * 60 * 1000) plans.delete(key);
        if (plans.size >= 32) plans.delete(plans.keys().next().value);
        plans.set(id, { plan, created: Date.now() });
        send(200, publicPlan(plan, id));
        return;
      }
      if (url.pathname === '/api/cancel') {
        plans.delete(body.plan_id);
        send(200, { cancelled: true });
        return;
      }
      if (url.pathname === '/api/apply') {
        if (body.confirmed !== true || body.records_root_confirmed !== true) {
          throw error('请先确认记录中心与修改预览。');
        }
        const saved = plans.get(body.plan_id);
        if (!saved || Date.now() - saved.created > 30 * 60 * 1000) throw error('预览已失效，请重新预览。', 409);
        plans.delete(body.plan_id);
        try { send(200, applySetup(saved.plan, { confirmed: true, recordsRootConfirmed: true })); }
        catch (cause) { throw error(`无法执行此预览，请返回重新预览：${cause.message}`, 409); }
        return;
      }
      if (url.pathname === '/api/shutdown') {
        plans.clear();
        send(200, { stopped: true });
        server.close(); server.closeIdleConnections();
        return;
      }
      send(404, { error: '没有此接口。' });
    } catch (cause) {
      if (!response.headersSent) send(cause.status ?? 400, { error: cause.message });
      else response.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: `${origin}/#token=${token}`, async close() {
    if (platformOpening) await platformOpening;
    if (platform) await platform.close();
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); server.closeAllConnections(); });
  } };
}
