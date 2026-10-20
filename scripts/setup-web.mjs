import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { startSetupWeb } from './lib/setup-web.mjs';

try {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' },
    'no-open': { type: 'boolean' }, port: { type: 'string' }, config: { type: 'string' } } });
  if (values.help) {
    console.log('biz-project 网页安装向导 (Node.js >= 20)\n\n双击 install.cmd 或运行 npm run setup。\n--no-open 不自动打开浏览器\n--port <端口> 默认自动分配空闲端口\n--config <文件> 使用独立配置，不替换现有指针\n终端备用入口：install-terminal.cmd / npm run setup:terminal');
  } else {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20 或以上。');
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口应为 0 至 65535 的整数。');
    const service = await startSetupWeb({ configFile: values.config, port });
    const { url } = service;
    console.log(JSON.stringify({ url }));
    console.log('\nbiz-project 网页向导已启动。仅本机可访问。\n浏览器未打开时，请打开上方完整链接。保持此终端运行；退出可按 Ctrl+C。');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.close().catch(error => console.error(error.message)); });
    if (!values['no-open']) {
      let executable, args;
      if (process.platform === 'win32') {
        executable = 'rundll32.exe'; args = ['url.dll,FileProtocolHandler', url];
      } else { executable = process.platform === 'darwin' ? 'open' : 'xdg-open'; args = [url]; }
      const browser = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
      browser.on('error', () => console.error('无法自动打开浏览器，请使用上方完整链接。'));
      browser.unref();
    }
  }
} catch (error) { console.error(`网页向导启动失败: ${error.message}`); process.exitCode = 1; }
