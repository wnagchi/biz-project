# 隐私与发布检查

源码仓库包含可复用的 Skill、脚本、模板、界面和测试。真实项目记录、机器配置与服务身份必须留在外部目录。不要复制维护者的本机记录入口；安装向导会为使用者选择的项目生成自己的入口。

## 已排除的本机内容

| 内容 | 常见路径或文件 |
| --- | --- |
| 本机 Agent 入口 | `AGENTS.override.md`、`.cursor/rules/biz-project.mdc` |
| 记录与快照 | `records/`、`.biz-project/`、`.project-records/`、`.biz-project-history/` |
| 配置与服务资料 | `config.json`、`config.local.json`、`project-preferences.json`、`registry.json`、`services/` |
| 凭据与证书 | `.env*`、`.npmrc`、`.netrc`、私钥、证书、密钥库 |
| 开发产物 | `node_modules/`、`web/build/`、浏览器报告、截图、日志、数据库和压缩包 |
| 本机历史笔记 | `docs/superpowers/`、`docs/plans/`、`docs/verification.md` |

`.env.example`、`.env.sample`、`.env.template` 可提交，但只能包含虚构值。`web/platform.js` 是用户直接运行所需的预编译界面，应纳入版本管理；`web/build/` 是构建中间目录。

## 检查命令

Git 安装并初始化后，在仓库内运行：

```sh
npm run check:privacy
git diff --cached --stat
git diff --cached
npm run check:privacy -- --staged
```

默认模式检查 Git 已跟踪和未忽略的工作区文件；`--staged` 检查整个索引，直接读取暂存的字节，即使工作区已修改，也不会漏掉暂存内容。两种模式都会检查已被跟踪的私人文件，不因其后来加入 `.gitignore` 而跳过。退出码 0 表示未命中已知规则，1 表示有发现，2 表示运行失败或参数错误。

检查器使用 Node 内置模块和 Git，无需联网，不修改文件或索引。检查私人文件名、常见 GitHub/API/AWS 凭据、私钥标记、带账号密码的服务 URL，以及个人 home 绝对路径。输出仅包含类型、文件名和行号，不回显匹配内容。测试凭据通过字符串片段生成，避免在测试源码中留下完整密钥样式。

符号链接和 Git 子模块需人工审核，检查器会阻止通过；单文件超过 5 MiB 也会阻止通过。二进制文件仅检查路径，不分析其内容，截图、文档附件和压缩内容需要人工检查。源码示例请使用 `D:\work\example-project`、`<records-root>` 或 `~` 等中性占位表达。

该工具不扫描 Git 历史，不能识别所有密码、业务数据、内部地址、个人信息或经过编码的密钥。CI 会在推送后检查整个已跟踪索引；它不能撤回已经上传的数据，提交前的本地检查与人工审阅仍然必要。

## GitHub 仓库设置

源码内的配置上传后才会生效。维护者可在仓库设置中启用私人漏洞报告、可用的 Secret scanning / Push protection，并为 `main` 配置 PR 审阅和 CI 必须通过的规则。首次推送并完成 CI 后，再从设置中选择实际生成的检查名称；本地文件不会自动修改这些账户侧设置。
