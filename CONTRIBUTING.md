# 参与贡献

欢迎通过 [Issue](https://github.com/wnagchi/biz-project/issues) 反馈问题、讨论改进，或提交 Pull Request。请提供可复现的脱敏示例。较大的行为或数据契约调整先讨论范围，避免重复工作。安全问题请遵循 [SECURITY.md](SECURITY.md)。

## 本地开发

先阅读 [AGENTS.md](AGENTS.md)。运行平台和 Node 测试只需 Node.js 20+ 与 Git；开发前端建议 Node.js 24，并使用锁文件安装开发依赖：

```sh
git clone https://github.com/wnagchi/biz-project.git
cd biz-project
npm ci
npm test
npm run check
npm run version:check
npm run check:privacy
```

Node 服务使用内置模块。React、TypeScript 与 Vite 用于前端开发和构建，不需要用户为运行预编译平台安装这些工具。不要顺手升级依赖或重建锁文件；依赖更新应单独说明原因。

## 修改与验证

`README.md` 与 `docs/how-it-works.md` 为默认英文页面；对应中文版为 `README.zh-CN.md` 与 `docs/how-it-works.zh-CN.md`。修改这些文档时，请在同一变更中同步两种语言的能力说明、命令、图表与链接，保留双向语言入口。产品界面与其他文档的语言不因 README 翻译而改变。

| 改动范围 | 验证要求 |
| --- | --- |
| 文档、模板、项目配置 | 检查链接、示例与隐私范围；修改 CI 时核对命令与权限 |
| Node 脚本 | `npm test`、`npm run check`；缺陷修复先补可复现测试 |
| `web/src` 或界面资源 | `npm run build:web`，提交生成的 `web/platform.js`；运行相关浏览器验收 |
| 初始化、发现、数据契约 | 先读 `docs/design.md`、`references/record-format.md`，同步 Skill、引用与使用说明 |

浏览器验收命令为 `npm run test:ui`、`npm run test:platform-ui` 和 `npm run test:rules-ui`。需要开发环境提供 Playwright、pngjs 和已安装的 Edge；可用 `BIZ_PROJECT_TEST_MODULES` 指定外部模块目录，`BIZ_PROJECT_TEST_BROWSER` 指定 Playwright 浏览器通道。它们不是运行平台的依赖，目前 CI 不执行这部分验收。

测试写入只能使用临时 home、临时项目和临时记录中心。不要用真实中心测试初始化、迁移、安装或服务控制，也不要为测试启动/停止使用者正在使用的服务、改防火墙或启用 LAN。

## 提交前隐私检查

1. 运行 `npm run check:privacy`，检查已跟踪和未忽略的工作区文件。
2. 只暂存本次修改，检查 `git diff --cached --stat` 和 `git diff --cached`。
3. 运行 `npm run check:privacy -- --staged`，检查整个 Git 索引的实际内容。
4. 确认新增截图、文档和日志已脱敏；发现凭据泄露时先撤销凭据。

不要使用 `git add -f` 绕过私人文件忽略规则。`.gitignore` 不会自动停止跟踪已经加入索引的文件；确认后可用 `git rm --cached -- <文件>` 仅移除索引条目并保留本地文件。详细范围和检查器限制见 [隐私发布指南](docs/privacy.md)。

## Pull Request

产品版本由 `package.json` 统一管理；涉及发布时，按 [版本规范](docs/versioning.md) 同步锁文件、更新日志与版本说明，禁止只改一个版本字段。普通 PR 不需要各自递增版本。

每个 PR 聚焦一个问题，说明原因、最终行为和实际验证结果。保留已有配置、未知字段与用户数据；避免无关格式化。不要把本机工程记录或聊天转录提交到仓库。Agent 使用者可在外部中心维护自己的记录，不需要复用维护者的记录入口、ID 或路径。

提交的贡献按本项目 [MIT 协议](LICENSE) 分发；引入第三方代码时保留其原始许可与归属。交流时尊重他人、围绕具体问题讨论，不发布任何人的私人信息。
