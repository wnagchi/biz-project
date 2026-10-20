# 版本与发布规范

## 版本来源

从 **0.5.0** 开始维护对外源码版本。`package.json` 的 `version` 是唯一版本来源，`package-lock.json` 的顶层与根包版本必须一致。此前 `0.1.0` 是内部占位值，不补造其公开发布记录。

使用 `MAJOR.MINOR.PATCH` 格式，版本字段不带 `v`，Git 注释标签使用 `v<version>`。支持 SemVer 预发布与构建标识，如 `0.6.0-rc.1`、`0.6.0+build.1`；预发布标识的纯数字段不能有前导零。

在本项目的 `0.x` 阶段，约定补丁号用于兼容修复，小版本号用于功能迭代或不兼容调整；不兼容变化必须在更新记录和版本说明中解释。进入 `1.x` 后，不兼容调整递增主版本号。产品版本与记录格式、服务协议的 `schema_version` 独立，不因改产品版本而伪造数据迁移。

## 每个版本的记录

- [CHANGELOG.md](../CHANGELOG.md)：顶部保留「未发布」，其后按新到旧排列 `## [版本] - YYYY-MM-DD` 条目，同一版本只出现一次。
- `docs/releases/v<version>.md`：第一行为 `# v<version>`，并包含 `发布日期：YYYY-MM-DD`；日期须与更新日志一致。
- 版本说明写清能力、修复、升级/迁移要求和已知限制。运行中服务不会因源码更新而自动替换，重启或迁移须明确说明。
- 已推送标签保持不变。发现问题发布新版本，不移动已公开的版本标签来掩盖变更。

## 发布步骤

只有使用者或维护者明确要求时才提交、打标签和推送；检查脚本不会执行这些操作。以下命令以仓库当前默认分支 `main` 为例，执行前核对实际分支和远端，不强制推送。

1. 将本次变化写入新的更新日志条目与版本说明，确认发布日期与兼容影响。
2. 用 npm 同步 package 与 lock。以补丁版本为例：

   ```sh
   npm version patch --no-git-tag-version --ignore-scripts
   ```

   功能版本使用 `minor`，或显式传入版本号。这里不自动创建提交或标签。

3. 在将要发布的源码上验证：

   ```sh
   npm run version:check
   npm test
   npm run check
   npm run check:privacy
   ```

   界面源码或构建配置变化时再执行 `npm ci`、`npm run build:web` 和相关浏览器验收，提交需分发的 `web/platform.js`。

4. 暂存审阅后的文件，检查差异，再运行 `npm run check:privacy -- --staged`。不要用强制添加绕过私人文件规则。
5. 创建版本提交并推送主分支，先让 GitHub CI 验证这份提交。以下以 `0.5.1` 为示例，替换为实际待发布版本：

   ```sh
   npm run version:check -- --tag v0.5.1
   git commit -m "release: v0.5.1"
   git push origin main
   ```

6. 等待该提交的 CI 通过，核对本地 HEAD 仍是已验证的提交，再创建和推送注释标签：

   ```sh
   git tag -a v0.5.1 -m "Biz Project v0.5.1"
   git push origin v0.5.1
   ```

   核对远端分支、标签目标和 CI 的提交一致，再记录发布证据。若本地或远端已有新提交，先核对目标，不给未验证的提交打版本标签。GitHub Release 如需单独创建，正文取自对应版本说明，并核对其目标标签。

## 自动检查

`npm run version:check` 只读检查包版本、两处锁文件版本、更新日志首个版本/重复条目/有效日期，以及当前版本说明标题和日期。可传 `--tag v<version>`；GitHub 标签事件会自动检查 `GITHUB_REF_NAME`，错误标签无法通过 CI。

本地创建标签时应使用命令中的显式 `--tag` 校验；检查器不会擅自扫描或修改 Git 标签。CI 在分支和标签推送时运行检查。`private: true` 保持开启，源码版本发布不意味着允许 npm 发布。
