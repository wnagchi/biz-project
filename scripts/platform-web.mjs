import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { startSharedPlatform } from './lib/shared-platform.mjs';

try {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, 'no-open': { type: 'boolean' },
    port: { type: 'string' }, config: { type: 'string' }, 'records-root': { type: 'string' }, lan: { type: 'boolean' }, 'no-lan': { type: 'boolean' },
    'tls-cert': { type: 'string' }, 'tls-key': { type: 'string' }, background: { type: 'boolean' } } });
  if (values.help) {
    console.log('Biz Project 本地管理平台 (Node.js >= 20)\n\n双击 start.cmd 或 npm start。\n--no-open 不自动打开浏览器\n--port <端口> 默认空闲端口\n--config <文件> 指定中心配置\n--records-root <路径> 已明确确认的现有中心\n--no-lan 只监听本机。默认同时接受私人局域网，打开页面不需要访问码\n--tls-cert <证书> --tls-key <私钥> 启用 HTTPS\n局域网也可在本机页面的访问设置中关闭。HTTP 不加密，只用于可信私人网络，不自动设置防火墙。');
  } else {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20 或以上。');
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口应为 0 至 65535。');
    const platform = await startSharedPlatform({ port, configFile: values.config, recordsRoot: values['records-root'],
      ownerToken: process.env.BIZ_PROJECT_OWNER_TOKEN, background: values.background,
      lan: !values['no-lan'], tlsCert: values['tls-cert'], tlsKey: values['tls-key'] });
    console.log(JSON.stringify({ url: platform.url, lan_urls: platform.lanUrls }));
    console.log(values.background ? '\n共享后台服务已启动。' : platform.owned ? '\n本地管理平台已启动。保持终端运行；Ctrl+C 退出。' : '\n已连接到管理平台。');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      platform.stop().catch(console.error);
    });
    if (!values['no-open']) {
      const executable = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', platform.url] : [platform.url];
      const browser = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
      browser.on('error', () => console.error('无法打开浏览器，请使用上方完整本机链接。')); browser.unref();
    }
  }
} catch (cause) { console.error(`管理平台启动失败: ${cause.message}`); process.exitCode = 1; }
