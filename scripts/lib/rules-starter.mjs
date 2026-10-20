import { randomUUID } from 'node:crypto';
import { check } from './rules-render.mjs';
export function createStarter(library) {
  const s = library.state(); check(s.configured, '请先明确确认模板库路径。');
  check(s.module_total <= 196 && s.scheme_total < 100, '模板库没有足够空间导入通用方案。');
  const definitions = [
    ['lifecycle', '生命周期判定', '开发中：正在实施，不能声称完成。\n已验证：已执行并记录规定的检查。\n已发布：满足 {{release_criterion}}，且有可核对的发布证据。\n提交、推送、合并或打标签本身不自动视为发布。', [{ name: 'release_criterion', label: '发布判定标准', required: true }]],
    ['development', '开发规范', '先读取现有约定，限定本次修改范围。\n开发分支约定：{{development_branch}}\n不猜测分支或覆盖无关修改；未知要求先确认。\n规则模板不授予委派、提交、推送或发布权限。', [{ name: 'development_branch', label: '开发分支约定', required: false }]],
    ['verification', '验证要求', '完成前执行并记录以下检查：\n{{verification_commands}}\n检查未运行或失败时明确说明，不能沿用过期结果证明本次完成。', [{ name: 'verification_commands', label: '验证命令或人工检查', required: true }]],
    ['release', '发布规范', '发布标准：{{release_criterion}}\n发布前确认授权、发布目标、实际改动和验证结果。\n只在标准全部满足且证据可追溯时宣称已发布；否则保留开发或已验证状态。\n不自动执行发布、修改全局约定或替使用者批准。', [{ name: 'release_criterion', label: '发布判定标准', required: true }]]
  ];
  const modules = {};
  for (const [domain, title, body, variables] of definitions) { const id = `base-${domain}-${randomUUID()}`;
    library.save('modules', { id, title, body, variables, domain, revision: 0 }); modules[domain] = id; }
  const scheme = library.save('schemes', { id: `base-${randomUUID()}`, title: '通用开发方案', revision: 0, modules, defaults: {} });
  return { scheme: library.get('schemes', scheme.id), state: library.state() };
}
