import { parseArgs } from 'node:util';
import { controlService } from './lib/service-control.mjs';
import { describeConnections } from './lib/service-description.mjs';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { config: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) console.log('Biz Project companion service control\ndescribe [--config <existing config>]\nstatus|ensure|ensure-companion|stop|open --config <absolute existing config>\nJSON protocol 1. stop requires an explicit user action; ensure-companion requires linked-startup consent. No enrollment, browser or network changes unless explicitly requested.');
  else {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20 或以上。');
    if (positionals.length !== 1) throw new Error('请提供一个服务操作。');
    console.log(JSON.stringify(await (positionals[0] === 'describe' ? describeConnections(values.config) : controlService(positionals[0], values.config))));
  }
} catch {
  console.log(JSON.stringify({ kind: 'biz-project-service-control', protocol_version: 1, state: 'unavailable', started: false,
    message: '服务操作失败，请检查工程、Node 和已有配置；不会自动创建或替换服务。' }));
  process.exitCode = 1;
}
