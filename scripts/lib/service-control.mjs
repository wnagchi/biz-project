import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { inspectRecordsCenter } from './projects.mjs';
import { ensureCenterService, probeService, servicePolicy, stopCenterService } from './service-runtime.mjs';

const envelope = result => ({ kind: 'biz-project-service-control', protocol_version: 1, started: false, ...result });
export async function controlService(action, configFile, options = {}) {
  if (!['status', 'ensure', 'ensure-companion', 'stop', 'open'].includes(action)) throw new Error('支持 status、ensure、ensure-companion、stop 或 open。');
  if (typeof configFile !== 'string' || !path.isAbsolute(configFile)) throw new Error('请选择已有的配置文件绝对路径。');
  if (!fs.existsSync(configFile)) return envelope({ state: 'not_configured', message: '尚未选择可用的 Biz Project 配置。' });
  const stat = fs.statSync(configFile);
  if (!stat.isFile() || stat.size > 8192) throw new Error('配置文件无效或过大。');
  // The chosen profile is authoritative; environment overrides cannot select another center.
  const saved = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  if (typeof saved.records_root !== 'string' || !path.isAbsolute(saved.records_root)) throw new Error('配置需要明确的记录中心绝对路径。');
  const state = inspectRecordsCenter({ config: configFile, 'records-root': saved.records_root });
  if (!state.registry || state.registry.kind !== 'biz-project') return envelope({ state: 'not_configured', message: '记录中心缺失或尚未确认，请先在 Biz Project 中配置。' });
  let probe = await probeService(state), started = false;
  const compatible = value => value.health.capabilities?.includes('service-control-v1');
  if (probe && !compatible(probe)) return envelope({ state: 'incompatible', message: '正在运行的 Biz Project 版本较旧，请保存草稿后手动重启。' });
  if (action === 'stop') return envelope(await stopCenterService(state));
  if (!probe && ['ensure', 'ensure-companion'].includes(action)) {
    const result = await ensureCenterService(state, { resumeCompanion: action === 'ensure-companion' }); started = result.started;
    if (result.state !== 'running') return envelope(result);
    probe = await probeService(state);
  }
  if (!probe) {
    const policy = servicePolicy(state);
    return envelope({ state: policy.stopped ? 'stopped' : policy.auto_start === null ? 'confirmation_required'
      : !policy.auto_start ? 'disabled' : 'not_running' });
  }
  if (!compatible(probe)) return envelope({ state: 'incompatible', message: '共享服务版本不兼容，请手动重启。' });
  if (action === 'open') {
    if (options.openBrowser) await options.openBrowser(probe.value.url);
    else {
      const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', probe.value.url] : [probe.value.url];
      const browser = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => { browser.once('spawn', resolve); browser.once('error', reject); }); browser.unref();
    }
  }
  return envelope({ state: 'running', started, url: `${new URL(probe.value.url).origin}/` });
}
