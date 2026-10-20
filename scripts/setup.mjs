import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { inspectProject } from './lib/projects.mjs';
import { prepareSetup, applySetup } from './lib/setup.mjs';
import { loadRegistry } from './lib/storage.mjs';

const cancelled = Symbol('cancelled');
const cleanPath = value => value.trim().replace(/^("|')(.*)\1$/, '$2');

function discoverCenter(projects, hosts, values) {
  let firstError;
  for (const project of projects) {
    for (const host of hosts) {
      try {
        return inspectProject({ project, host, config: values.config, 'records-root': values['records-root'] });
      } catch (error) { firstError ??= error; }
    }
  }
  throw firstError;
}

function help() {
  console.log(`biz-project 终端安装器 (Node.js >= 20)

Windows: 双击 install.cmd
终端:    node scripts/setup.mjs [--config <配置文件>] [--records-root <候选目录>]

选择 Codex / Cursor、多个项目和记录中心，预览后输入 INSTALL 才写入。
没有记录中心时必须填写路径；取消或输入结束不会执行安装。
不会覆盖其他安装、修改业务代码、迁移旧文档或自动下载 Node.js。
--config 可使用独立配置，不覆盖现有记录中心指针。
--help   仅显示帮助，不安装。`);
}

function inputReader() {
  const rl = readline.createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY),
    output: process.stdout, crlfDelay: Infinity });
  const queued = [];
  let pending = null, closed = false;
  // Queue piped lines as well as terminal input; sequential question() loses buffered input.
  rl.on('line', line => {
    if (pending) { const resolve = pending; pending = null; resolve(line); }
    else queued.push(line);
  });
  rl.on('close', () => {
    closed = true;
    if (pending) { pending(undefined); pending = null; }
  });
  const interrupt = () => { queued.length = 0; rl.close(); };
  rl.on('SIGINT', interrupt);
  process.on('SIGINT', interrupt);
  return {
    async ask(prompt) {
      process.stdout.write(prompt);
      const line = queued.length ? queued.shift() : closed ? undefined
        : await new Promise(resolve => { pending = resolve; });
      if (line === undefined) throw cancelled;
      return line;
    },
    close() { process.off('SIGINT', interrupt); rl.close(); process.stdin.pause(); }
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, config: { type: 'string' },
    'records-root': { type: 'string' }
  } });
  if (values.help) { help(); return; }
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20 或更高版本，请先安装后重试。');

  const reader = inputReader();
  try {
    console.log('\nbiz-project 终端安装器\n');
    const choices = { '1': ['codex'], '2': ['cursor'], '3': ['codex', 'cursor'] };
    let hosts;
    while (!hosts) {
      const answer = (await reader.ask('工具 [1 Codex / 2 Cursor / 3 两者]，留空取消: ')).trim();
      if (!answer) throw cancelled;
      hosts = choices[answer];
      if (!hosts) console.log('请输入 1、2 或 3。');
    }
    console.log('\n逐行填写项目目录，可带引号；空行结束。');
    const projects = [];
    while (true) {
      const project = cleanPath(await reader.ask(`项目 ${projects.length + 1}: `));
      if (!project) break;
      projects.push(project);
    }
    if (!projects.length) throw cancelled;
    const discovery = discoverCenter(projects, hosts, values);
    const reusable = discovery.records_root && !discovery.records_root_confirmation_required
      && loadRegistry(discovery.records_root)?.kind === 'biz-project';
    if (discovery.records_root) console.log(`\n发现记录中心候选: ${discovery.records_root}`);
    if (discovery.legacy_records_centers.length) {
      console.log('发现旧记录中心，仅作为候选，不会自动选择或迁移:');
      discovery.legacy_records_centers.forEach(center => console.log(`  ${center.records_root}`));
    }
    let recordsRoot;
    while (!recordsRoot) {
      const answer = cleanPath(await reader.ask(reusable
        ? '记录中心路径（回车确认使用上述目录）: '
        : '请明确填写记录中心路径（不会使用默认值）: '));
      recordsRoot = answer || (reusable ? discovery.records_root : null);
      if (!recordsRoot) console.log('尚未选择记录中心。填写路径，或按 Ctrl+C 取消。');
    }
    const plan = prepareSetup({ projects, hosts, recordsRoot, configFile: values.config });
    console.log('\n修改预览');
    console.log(`记录中心: ${plan.records_root}`);
    console.log(`登记文件: ${plan.registry_file}`);
    console.log(`配置指针: ${plan.config_file}（已有指针不覆盖）`);
    console.log(`Skill 来源: ${plan.installation.source}`);
    console.log(`共享入口: ${plan.installation.target} (${plan.installation.action === 'link' ? '创建目录链接' : '已安装，跳过'})`);
    for (const item of plan.items) {
      const label = { skip: '已接入，跳过', initialize: '补齐登记与调用规则', blocked: '无法接入' }[item.action];
      console.log(`\n[${item.host}] ${item.project}: ${label}`);
      if (item.rules_file) console.log(`  调用规则: ${item.rules_file}`);
      if (item.project_directory) console.log(`  项目记录: ${item.project_directory}（保留已有内容）`);
      else if (item.action === 'initialize') console.log(`  新项目记录: ${plan.records_root}/projects/<生成的项目 ID>/`);
      if (item.error) console.log(`  原因: ${item.error}`);
    }
    console.log('\n只安装共享入口、登记项目并补齐管理调用规则。原规则、记录和旧文档保留。');
    console.log('新建项目档案仍需 Agent 阅读项目规则，确认分支、验证与发布约定。');
    console.log('目录链接依赖 Skill 来源目录；请勿移动或删除来源。未验证工具界面已加载。');
    const approval = (await reader.ask('\n确认以上记录中心及全部修改，请输入 INSTALL（其他输入取消）: ')).trim();
    if (approval !== 'INSTALL') throw cancelled;
    const result = applySetup(plan, { confirmed: true, recordsRootConfirmed: true });
    console.log(`\n共享入口: ${result.installation.status}${result.installation.error ? ` (${result.installation.error})` : ''}`);
    for (const item of result.items) {
      console.log(`[${item.host}] ${item.project}: ${item.status}${item.error ? ` (${item.error})` : ''}`);
    }
    const count = status => result.items.filter(item => item.status === status).length;
    console.log(`\n新增/修复 ${count('initialized')}，跳过 ${count('skipped')}，失败 ${count('failed')}。`);
    if (!result.ok) {
      console.log('已完成项保留。解决报告的问题后重新运行，已接入项会跳过。');
      process.exitCode = 1;
    } else console.log('接入完成。工具未显示 Skill 时，请重新开启会话后检查。');
  } finally { reader.close(); }
}

try { await main(); }
catch (error) {
  if (error === cancelled) console.log('\n已取消，未执行安装。');
  else { console.error(`\n安装器失败: ${error.message}`); process.exitCode = 1; }
}
