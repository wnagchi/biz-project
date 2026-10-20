import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sourceDirectory, canonical, homeDirectory, loadRegistry } from './storage.mjs';
import { startSetupWeb } from './setup-web.mjs';
import { openRecords, dashboard, projectDetail, featureDetail, saveOverview, saveFeature,
  newFeature, newUpdate, searchRecords, renameProject, stopProject, resumeProject, deleteProject, projectRules, recordError } from './platform-records.mjs';
import { servicePolicy, setServicePolicy, markServiceStopped, claimService, resumeService, descriptor } from './service-runtime.mjs';
import { processAlive } from './process-lease.mjs';
import { connectionProfile, publishConnection } from './service-connection.mjs';
import { startHistoryWatcher } from './history-watcher.mjs';
import { createRulesWeb } from './rules-web.mjs';

const assets = new Map([['/', ['platform.html', 'text/html']], ['/platform.js', ['platform.js', 'text/javascript']],
  ['/marked.umd.js', ['vendor/marked.umd.js', 'text/javascript']], ['/markdown.js', ['markdown.js', 'text/javascript']],
  ['/platform.css', ['platform.css', 'text/css']], ['/rules.js', ['rules.js', 'text/javascript']], ['/rules.css', ['rules.css', 'text/css']],
  ['/styles.css', ['styles.css', 'text/css']], ['/icons.svg', ['icons.svg', 'image/svg+xml']]]);
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const address = value => String(value ?? '').replace(/^::ffff:/, '');
const loopback = value => address(value) === '127.0.0.1' || value === '::1';
function privateIPv4(value) {
  const parts = address(value).split('.').map(Number);
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}
function interfaces() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter(item => item && !item.internal
    && (item.family === 'IPv4' || item.family === 4) && privateIPv4(item.address)).map(item => item.address))];
}
async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw recordError('请求必须使用 JSON。', 415, 'CONTENT_TYPE');
  if (Number(request.headers['content-length']) > 1024 * 1024) { request.resume(); throw recordError('请求不能超过 1 MiB。', 413, 'BODY_TOO_LARGE'); }
  const bytes = await new Promise((resolve, reject) => {
    const chunks = []; let length = 0, rejected = false;
    request.on('data', chunk => {
      length += chunk.length;
      if (length > 1024 * 1024 && !rejected) { rejected = true; reject(recordError('请求不能超过 1 MiB。', 413, 'BODY_TOO_LARGE')); }
      if (!rejected) chunks.push(chunk);
    });
    request.once('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    request.once('error', reject);
  });
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw recordError('请求内容无效。', 400, 'INVALID_JSON'); }
}
const listen = (server, port, host) => new Promise((resolve, reject) => {
  const failed = cause => reject(cause);
  server.once('error', failed);
  server.listen(port, host, () => { server.removeListener('error', failed); resolve(); });
});
const stop = server => new Promise(resolve => {
  if (!server?.listening) { resolve(); return; }
  server.close(resolve); server.closeIdleConnections(); server.closeAllConnections();
});

export async function startPlatformWeb(options = {}) {
  options = { ...options };
  if (options.ownerToken !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(options.ownerToken)) throw recordError('本机拥有者 token 凭据无效。');
  const rules = createRulesWeb(options);
  const localToken = options.ownerToken ?? random(); let recordsRoot = null, centerError = null;
  const sessions = new Map();
  let lanServer = null, installer = null, installerOpening = null, closing = false, historyWatcher = null;
  let lease = null, urlForOwner = null;
  const serviceState = root => ({ records_root: root, config_file: canonical(options.configFile ?? path.join(homeDirectory, '.config/biz-project/config.json')) });
  const publish = () => {
    if (!lease) return;
    lease.publish(urlForOwner);
    try { publishConnection(options.connectionProfile, options.connectionHome); }
    catch (error) { console.error(`本机连接资料发布失败，服务继续运行: ${error.message}`); }
  };
  const register = root => {
    if (!options.managedService || lease) return;
    const state = serviceState(root);
    const old = descriptor(state);
    if (old && processAlive(old.pid)) throw recordError('已有服务正在运行或等待检查，请重新打开管理平台；不会启动重复监听。', 409, 'SERVICE_ALREADY_RUNNING');
    lease = claimService(state);
    try {
      if (!options.background) resumeService(state);
      options.serviceIdentity = lease.identity;
      options.connectionProfile = connectionProfile(state);
      if (urlForOwner) publish();
    } catch (error) { lease.release(); lease = null; throw error; }
  };
  const watchCenter = root => {
    if (!historyWatcher && Object.keys(loadRegistry(root).projects).length) historyWatcher = startHistoryWatcher(root, options.historyOptions);
  };
  if (Boolean(options.tlsCert) !== Boolean(options.tlsKey)) throw recordError('TLS 证书与私钥必须同时指定。');
  const tls = options.tlsCert ? { cert: fs.readFileSync(options.tlsCert), key: fs.readFileSync(options.tlsKey) } : null;
  const protocol = tls ? 'https' : 'http';
  const resolveCenter = () => {
    if (!recordsRoot) {
      try { recordsRoot = openRecords(options); centerError = null; }
      catch (cause) { centerError = cause.status ? cause : recordError('无法读取记录中心，请在本机检查配置。', 503, 'CENTER_REQUIRED'); }
    }
    if (!recordsRoot) throw centerError;
    register(recordsRoot);
    watchCenter(recordsRoot);
    return recordsRoot;
  };
  try { resolveCenter(); } catch (error) {
    if (recordsRoot) { rules.close(); lease?.release(); throw error; }
    // The owner can launch the existing confirmation wizard.
  }
  const lanUrls = () => lanServer ? interfaces().map(ip => `${protocol}://${ip}:${lanServer.address().port}/`) : [];
  const sessionData = local => ({ local, records_root: recordsRoot, center_error: centerError?.message ?? null,
    lan_enabled: Boolean(lanServer), lan_urls: local ? lanUrls() : [], secure: Boolean(tls), ...(local ? {
      service_policy: recordsRoot ? servicePolicy(serviceState(recordsRoot)) : null,
      history: historyWatcher?.status() ?? null, watcher: historyWatcher?.status() ?? null } : {}) });
  const historyData = () => ({ ...historyWatcher?.status(), watcher: historyWatcher?.status() ?? null });
  const requireOwner = local => { if (!local) throw recordError('此操作仅允许从本机拥有者页面执行。', 403, 'LOCAL_ONLY'); };
  const createServer = () => {
    const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    return server;
  };
  async function network(enabled) {
    if (enabled && !lanServer) {
      const next = createServer(); await listen(next, 0, '0.0.0.0'); lanServer = next;
    } else if (!enabled && lanServer) {
      const previous = lanServer; lanServer = null; sessions.clear(); await stop(previous);
    }
  }
  async function handle(request, response) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      const port = request.socket.localPort;
      const allowed = [`127.0.0.1:${port}`, `localhost:${port}`, ...interfaces().map(ip => `${ip}:${port}`)];
      if (!allowed.includes(request.headers.host)) throw recordError('不允许的访问地址。', 403, 'HOST_DENIED');
      const localAddress = loopback(request.socket.remoteAddress);
      if (!localAddress && (!lanServer || !privateIPv4(request.socket.remoteAddress))) throw recordError('只允许私人局域网来源。', 403, 'NETWORK_DENIED');
      const origin = `${protocol}://${request.headers.host}`;
      if ((request.headers.origin !== undefined && request.headers.origin !== origin)
        || request.headers['sec-fetch-site'] === 'cross-site'
        || (request.method === 'POST' && request.headers.origin !== origin)) throw recordError('拒绝跨站请求。', 403, 'ORIGIN_DENIED');
      const url = new URL(request.url, origin), asset = assets.get(url.pathname);
      if (asset && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
        response.end(fs.readFileSync(path.join(sourceDirectory, 'web', asset[0]))); return;
      }
      if (!url.pathname.startsWith('/api/')) { send(404, { error: '没有此页面。', code: 'NOT_FOUND' }); return; }
      const internal = options.serviceIdentity && localAddress && equal(String(request.headers['x-biz-service-token'] ?? ''), options.serviceIdentity.service_token);
      if (url.pathname === '/api/service/health' && request.method === 'GET') {
        if (!internal) throw recordError('此接口需要本机服务身份凭据。', 403, 'SERVICE_IDENTITY_REQUIRED');
        const w = historyWatcher?.status();
        send(200, { kind: 'biz-project-service', protocol_version: 1, capabilities: ['service-control-v1', ...(options.connectionProfile ? ['local-connection-v1'] : [])], instance_id: options.serviceIdentity.instance_id,
          records_root: recordsRoot, pid: process.pid, watcher: w ? { scan_state: w.scan_state, active: w.active } : null }); return;
      }
      if (url.pathname === '/api/service/connection') {
        if (!internal) throw recordError('此接口需要本机服务身份凭据。', 403, 'SERVICE_IDENTITY_REQUIRED');
        if (request.method !== 'GET' || !options.connectionProfile) throw recordError('此服务不支持本机连接资料，请手动重启新版。', 409, 'CONNECTION_UNAVAILABLE');
        send(200, { kind: 'biz-project-connection-handshake', protocol_version: 1,
          instance_id: options.serviceIdentity.instance_id, pid: process.pid, profile: options.connectionProfile }); return;
      }
      if (url.pathname === '/api/service/stop' && request.method === 'POST' && internal) {
        const stopId = request.headers['x-biz-stop-request'];
        if (recordsRoot) markServiceStopped(serviceState(recordsRoot), typeof stopId === 'string' && /^[a-f0-9-]{36}$/.test(stopId) ? stopId : undefined); send(200, { stopping: true });
        setTimeout(() => (options.onStop?.() ?? closePlatform()), 25); return;
      }
      const provided = String(request.headers['x-biz-token'] ?? '');
      const local = localAddress;
      if (!local && !lanServer) throw recordError('局域网访问尚未开启。', 403, 'LAN_DISABLED');
      if (url.pathname.startsWith('/api/rules/')) {
        requireOwner(local);
        const input = request.method === 'POST' ? await body(request) : undefined;
        send(200, rules.dispatch(request.method, url, input)); return;
      }
      if (request.method === 'GET') {
        if (url.pathname === '/api/session') { send(200, sessionData(local)); return; }
        const root = resolveCenter();
        if (url.pathname.startsWith('/api/history/')) {
          requireOwner(local);
          if (url.pathname === '/api/history/status') { send(200, historyData()); return; }
          const store = historyWatcher?.store; if (!store) throw recordError('文档快照未就绪，请检查监听状态。', 503, 'SNAPSHOT_UNAVAILABLE');
          if (url.pathname === '/api/history/documents') { send(200, await store.documents(Number(url.searchParams.get('offset') ?? 0))); return; }
          const file = url.searchParams.get('file');
          if (url.pathname === '/api/history/versions') { send(200, { versions: await store.versions(file, Number(url.searchParams.get('offset') ?? 0)) }); return; }
          if (url.pathname === '/api/history/version') { send(200, await store.readVersion(file, url.searchParams.get('id'))); return; }
        }
        if (url.pathname === '/api/dashboard') { send(200, dashboard(root, options.configFile)); return; }
        if (url.pathname === '/api/search') { send(200, searchRecords(root, url.searchParams.get('q') ?? '', options.configFile)); return; }
        const rulesPreview = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/rules$/);
        if (rulesPreview) { requireOwner(local); send(200, projectRules(root, rulesPreview[1])); return; }
        const project = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)$/);
        if (project) { send(200, projectDetail(root, project[1])); return; }
        const feature = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/features\/([a-z0-9-]+)$/);
        if (feature) { send(200, featureDetail(root, feature[1], feature[2])); return; }
      } else if (request.method === 'POST') {
        if (['/api/network', '/api/installer', '/api/service/policy', '/api/service/stop'].includes(url.pathname) || url.pathname.startsWith('/api/history/')) requireOwner(local);
        const input = await body(request);
        if (url.pathname === '/api/logout') { sessions.delete(provided); send(200, { ok: true }); return; }
        if (url.pathname === '/api/network') {
          if (typeof input.enabled !== 'boolean') throw recordError('请明确开启或关闭局域网访问。');
          await network(input.enabled); send(200, sessionData(true)); return;
        }
        if (url.pathname === '/api/installer') {
          if (!installer?.server.listening) {
            installerOpening ??= startSetupWeb({ configFile: options.configFile, recordsRoot: options.recordsRoot,
              platformUrl: urlForOwner }).then(value => { installer = value; }).finally(() => { installerOpening = null; });
            await installerOpening;
          }
          send(200, { url: installer.url }); return;
        }
        const root = resolveCenter(), actor = local ? 'browser-local' : 'browser-lan';
        if (url.pathname === '/api/service/policy') {
          if (typeof input.auto_start !== 'boolean') throw recordError('请明确选择是否允许自动启动服务。');
          setServicePolicy(serviceState(root), input.auto_start ? 'yes' : 'no'); send(200, sessionData(true)); return;
        }
        if (url.pathname === '/api/service/stop') {
          markServiceStopped(serviceState(root)); send(200, { stopping: true });
          setTimeout(() => (options.onStop?.() ?? closePlatform()), 25); return;
        }
        if (url.pathname === '/api/history/rescan') {
          historyWatcher?.rescan(); send(200, historyData()); return;
        }
        if (url.pathname === '/api/history/watch') {
          if (typeof input.enabled !== 'boolean') throw recordError('请明确开启或暂停监听。');
          watchCenter(root);
          if (!historyWatcher) throw recordError('文档快照未就绪。');
          if (input.enabled) await historyWatcher.resume(); else await historyWatcher.pause();
          send(200, historyData()); return;
        }
        const managed = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/(rename|stop|resume|delete)$/);
        if (managed) {
          requireOwner(local);
          const id = managed[1], action = managed[2];
          if (action === 'rename') send(200, renameProject(root, id, input));
          else if (action === 'stop') send(200, stopProject(root, id, options.configFile));
          else if (action === 'resume') send(200, resumeProject(root, id, options.configFile));
          else send(200, deleteProject(root, id, input, options.configFile));
          return;
        }
        const overview = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/overview$/);
        if (overview) { send(200, saveOverview(root, overview[1], input, actor)); return; }
        const features = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/features$/);
        if (features) { send(200, newFeature(root, features[1], input, actor)); return; }
        const feature = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/features\/([a-z0-9-]+)$/);
        if (feature) { send(200, saveFeature(root, feature[1], feature[2], input, actor)); return; }
        const update = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/features\/([a-z0-9-]+)\/updates$/);
        if (update) { send(200, newUpdate(root, update[1], update[2], input, actor)); return; }
      }
      send(404, { error: '没有此接口。', code: 'NOT_FOUND' });
    } catch (cause) {
      const status = cause.status ?? (cause.code === 'ENOENT' ? 404 : /busy|lock retained/i.test(cause.message) ? 423 : 400);
      send(status, { error: cause.status ? cause.message : status === 423 ? '记录正在被其他操作使用，请稍后重试。' : '记录不可读取或操作无效，请检查本机记录。', code: cause.status ? cause.code : 'RECORD_ERROR' });
    }
  }
  const server = createServer();
  try { await listen(server, options.port ?? 0, '127.0.0.1'); if (options.lan) await network(true); }
  catch (cause) { await closePlatform(); throw cause; }
  const url = `${protocol}://127.0.0.1:${server.address().port}/#token=${localToken}`;
  urlForOwner = url;
  try { publish(); } catch (cause) { await closePlatform(); throw cause; }
  async function closePlatform() {
      if (closing) return; closing = true;
      const lan = lanServer; lanServer = null; sessions.clear();
      try {
        rules.close(); await historyWatcher?.close();
        if (installerOpening) await installerOpening;
        if (installer) await installer.close();
      } finally {
        try { await stop(lan); await stop(server); }
        finally { lease?.release(); }
      }
  }
  return { server, url, get owned() { return Boolean(lease); }, get historyWatcher() { return historyWatcher; },
    get lanUrls() { return lanUrls(); }, close: closePlatform,
    async stop() { if (lease && recordsRoot) markServiceStopped(serviceState(recordsRoot)); await closePlatform(); } };
}
