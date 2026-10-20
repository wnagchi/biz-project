# 使用手册

本页保留平台、安装器、命令行和兼容行为的详细说明。首次使用请先阅读 [项目首页](../README.md)。

## 本地项目管理平台

功能栏支持「按状态 / 按时间」：默认按状态分组，开发中和受阻靠前，分组显示数量并可折叠。
按时间可选择最近更新或创建时间，以今天、本周（周一开始）、更早分组；异常的未来时间和缺失时间单独显示。
搜索与状态筛选可组合使用，切换视图不关闭右侧记录或丢弃草稿。同一浏览器、同一服务地址记住查看偏好；
浏览器禁用存储时仍可在当前页面切换。所有分组在前端完成，不请求接口或写记录。
创建时间来自原记录 `created_at`；更新时间沿用主文档/元数据修改时间，不代表发布或独立进展时间。
旧服务进程需手动重启才能返回新增的创建时间摘要；缺少字段时显示时间未知，不用文件时间代替。

Windows 双击 `start.cmd`，或运行 `npm start`。要求 Node.js 20+，无需安装第三方 Node 运行依赖。管理首页直接读取现有中心的项目、功能状态和独立进展；支持项目/功能筛选、查看与编辑项目约定、新建功能、编辑名称/负责人/状态/正文、追加独立进展、查看网页修改历史及跨项目搜索。

**Markdown 阅读与预览**：项目约定、功能正文、进展和修改历史默认渲染标题、加粗/强调/删除线、列表、只读任务清单、表格、引用、行内代码和代码块。编辑约定、功能正文或追加进展时可切换「源码 / 预览」，保存的仍是原 Markdown，不转换成 HTML；预览不丢失草稿。宽表格和代码块在内容区内滚动。解析器随工程本地打包，浏览器不请求 CDN；Node 服务仍仅内置模块。

记录中的 HTML 按文字显示，不执行脚本或嵌入元素。链接仅允许 HTTP、HTTPS、mailto 和本篇标题锚点，外部链接在新标签打开且不携带来源信息。相对文件链接和本机文件路径暂不映射到平台路由；图片显示为标签/安全链接，不自动联网加载或读取任意本机文件。阅读视图不是富文本编辑器，不包含语法高亮、图表或数学公式扩展。第三方解析器来源、固定版本和许可见 [vendor 说明](../web/vendor/README.md)。

平台与 Skill 共用原有 JSON/Markdown，不创建第二份数据库。中心尚未确认时不会采用默认目录，可以从本机页面打开原接入向导。`install.cmd` / `npm run setup` 仍是安装入口，平台不会代替你点击安装确认。

向导每一步的右上角都有「返回项目管理」；从平台打开时优先回到原标签，不重新加载，因此保留已选项目、功能和未保存草稿。原管理标签已关闭或不可用时，会在当前标签打开管理平台。独立启动向导时显示「打开项目管理」，只启动本机管理服务，不安装项目、不创建默认中心、不启用 LAN。「停止向导服务」与返回是两个操作，不会停止管理平台。

**总览工作台**：桌面为项目列表、当前项目功能列表、记录详情三栏联动，统计压缩为一行；项目和功能各自搜索/筛选，选择后直接在右栏查看正文、进展与历史。每栏独立滚动，列表位置与选中项保留；切换记录正文、进展记录和修改历史时，顶栏和左右列表保持不动，只更新记录栏。顶部导航和当前记录标签不随长正文消失。初始右栏显示跨项目最近进展。手机及窄屏一次只显示项目、功能或记录中的一层，通过返回按钮逐级切换，不上下堆叠三栏。编辑中切换项目、功能、标签、返回或创建功能前会确认未保存内容。界面源码是 TypeScript，在 `web/src`，预先编成 `web/platform.js`。修改界面后运行 `npm run build:web`；`start.cmd` 不编译，Node 服务也不加载这些开发依赖。

**局域网访问**：`start.cmd` 默认接受私人局域网。本机和其他设备打开管理地址都直接进入，不需要访问码。其他设备可以查看和编辑记录，但看不到设置，也不能打开目录浏览或安装器。在本机「设置」关掉局域网后，只剩本机可以进入。接入向导单独拉起的管理服务仍只监听本机。不会自动修改防火墙，也不开放公网。

LAN 开关使用独立的空闲端口，本机页面不会中断。只接受私人 IPv4 网络，当前不支持 IPv6、Tailscale/公网地址或跨机器 Agent 自动写入。已运行服务可能被复用，应核对本机设置中的实际 LAN 状态；需要关闭时在本机设置中关闭。另一台设备能否连通还取决于网络隔离和防火墙规则。

**默认 HTTP 不加密，只用于可信私人局域网。** 不应在公共 Wi-Fi 上使用，也不要设置路由器端口转发。可以通过证书和私钥显式启用 HTTPS：

```powershell
npm start -- --no-lan
node scripts/platform-web.mjs --no-open --port 0 --config "D:\work\example-config.json"
node scripts/platform-web.mjs --tls-cert "D:\certs\server.pem" --tls-key "D:\certs\server-key.pem"
```

证书和私钥由使用者提供，不打包进 Skill。局域网浏览器须信任该证书；访问地址应匹配证书。不要把带 token 的本机链接当成登录凭据；局域网设备直接打开管理地址。

保存时检查记录版本，冲突不会覆盖新内容；409 草稿与被撤销会话的草稿在当前页面中保留，可重新加载/登录后恢复。刷新或关闭页面不保留内存草稿，重要草稿可使用复制按钮。保存使用中心已有锁，并记录修改前后内容；不能阻止绕过锁的同时手工修改。独立进展保持追加式，追加不会改变功能状态。手动选中「已上线」只是记录编辑，不会执行 Git、部署或自动核验发布。

异常保存优先恢复本次已写入的文件；发现别人已再次修改时不覆盖，保留隐藏 `.pending` journal 并阻止该记录继续写入。此时先停止写入操作，由本机负责人检查 journal 的 before/after 和文件现状，恢复一致后再处理日志；不自动删除其他 Agent 的锁或恢复证据。项目约定修改也保存审计历史，目前历史界面展示功能记录历史。

开发验收运行 `npm run test:platform-ui`，外部测试依赖与下方安装器浏览器验收相同。当前工程仍未发布，不包含外部示例应用业务数据、团队账号、任务自动调度或云同步。

## 外部应用启动联动

外部桌面应用可调用 `scripts/service-control.mjs status|ensure|open --config "<已有配置文件绝对路径>"`，不依赖调用方项目登记。命令输出版本化 JSON；`status` 只读，`ensure` 按中心启动授权与停止标记检查/复用共享进程，只有主动 `open` 才打开网页。新联动启动仅本机监听，不改运行中服务的网络配置，不初始化中心、不改变拒绝登记偏好。调用方关闭后服务独立继续运行。

2026-10-19 增加明确手动 `stop` 和已授权联动的 `ensure-companion`：从桌面调用方停止后，普通 Agent 检查保持停服，下次联动可按既有中心授权恢复。停止等待已认证实例释放运行资料，不强杀进程；另一次 Biz/Agent 明确停服会取消联动恢复。调用方关闭或取消联动仍不自动停止服务，监听暂停保持不变。

旧进程缺少新能力时报告版本不兼容，由使用者保存草稿后手动重启，不自动杀进程或替换。外部示例应用桌面端的单向适配保存在它自己的工程中，不把业务代码或数据库并入本仓库。契约见 [服务联动](../references/service-control.md)。

## 开发规则模板

本机管理页面的「开发规则」提供独立的规则库，不与项目文档、目录结构模板混用，也不要求目标项目加入集中记录。局域网记录编辑者不能使用这些本机文件操作。

更新源码不等于后台进程已更新：旧服务可能读到新主界面，却还没有新增资源或接口。此时页面显示重启提示，其他导航仍可使用，不会把接口缺失误当成空模板库。先保存草稿，在「设置 → 停止服务」后重新启动平台，并使用启动器新打开的本机页面；只刷新浏览器不会更新后台进程。

首次使用先确认模板库的绝对路径，不能放进源码、业务项目或记录中心；未确认前不会创建任何模板文件。可以点击「使用通用方案」创建可编辑的基础模块和方案，或自行新建。不会默认创建，也不会猜测开发分支、验证命令或发布依据。

规则按生命周期、开发、验证、发布、Agent 协作五个领域维护。完整方案包含前四项，协作可选，每个领域至多一个模块。模块正文支持 Markdown 和 `{{parameter_name}}`；参数名、显示名、必填项用表单配置，方案默认值在应用表单中显示并由你确认。只做字面替换，不运行模板中的代码或命令。

模块与方案均支持编辑、复制、归档及恢复，编辑带修订检查。选择完整方案、已有项目目录和 Codex / Cursor 后，预览只读，最终「批准并写入」才修改所列目标：

| 项目情况 | 执行方式 |
| --- | --- |
| 没有已有项目规则 | 脚本生成，确认差异后写入 |
| 已有规则，需要保留 | 复制或下载合并任务交给当前 Agent；导入其 JSON 草案，解决冲突后再批准 |
| 明确允许覆盖 | 本次主动选择覆盖，查看范围并批准；原始文件字节保存在模板库的恢复副本中 |

平台不会自动调用模型、启动 Agent 或做语义合并。草案必须填写实际合并结论和逐文件理由，不能保留示例解释或未解决项。批准前重新核对模板修订、项目规则、约定和原文件指纹；有变化、超时或取消则重新预览。修改目标、参数、工具或模式会移除旧的批准入口。

Codex 默认写入根目录已有的 `AGENTS.override.md`，否则 `AGENTS.md`；Cursor 使用单独的 `.cursor/rules/biz-project-development.mdc`。项目登记调用区块受保护；全局/父目录规则、其他规则文件和中心档案只作为审阅材料，不在覆盖范围内。导入不登记项目、不解除拒绝、不创建 Git、不提交、不执行发布，也不将这些规则纳入记录快照。

恢复副本不是自动回滚：应用后又被手工修改时，需负责人核对现状再处理。部分目标失败会逐个报告，成功项保留；文件已写入但应用记录保存失败时会明确警告并显示原文件恢复路径。

第一版仅单项目导入，目录通过绝对路径表单输入；使用已知规则路径，自定义 Codex 规则目的地、Cursor User Rules 全量发现、批量升级、旧模板版本回滚和模型接入未实现。Agent 须补充其实际工具上下文。规则进入项目后独立可用，模块改动不会自动同步到已导入项目。详见 [数据格式与合并契约](../references/rule-templates.md)。验收：`npm run test:rules-ui`。

## 网页安装向导

要求 **Node.js 20 或以上**。Windows 双击工程根目录的 `install.cmd`，或在该目录的终端运行：

```powershell
npm run setup
```

启动后自动打开本机浏览器，端口自动分配。终端需保持运行；浏览器未自动打开时，打开终端输出的完整链接（包含会话凭据）。只监听 `127.0.0.1`，无需联网，也不需要上传目录。

1. **记录中心**：主动选择已发现的中心，或打开目录窗口选择其他目录；也可选择父目录后输入新目录名称。点击「确认并继续」，不自动采用任何候选或默认目录。
2. **项目与工具**：浏览项目父目录，列出直接子目录后批量勾选，支持搜索和全选；也可添加单个项目。Codex/Cursor 可全局选择，也能逐项目调整。点击「检查接入状态」查看已接入、待接入和冲突项，不执行写入。
3. **确认修改**：表格列出规则文件、项目记录、共享入口及配置；支持返回修改且保留选择。勾选确认后点击「确认安装」，不需要输入 INSTALL。
4. **安装结果**：分别显示新增/修复、跳过及失败。成功项保留；修复报错后可点击「仅重试失败项」，重新预览再安装。也可继续添加项目。

目录窗口由本机服务读取目录，默认不显示隐藏目录、node_modules，不递归扫描或默认勾选项目。支持上一级、磁盘/常用目录、筛选和可选地址栏。这里只选择要接入的工具，不安装工具本身。

安装器在 `~/.agents/skills/biz-project` 创建指向当前工程的目录链接，Codex 与本地 Cursor 共用一份 Skill。**不要移动或删除来源工程目录**。其他内容已占用该入口时会停止，不会覆盖或自动卸载。新记录中心还必须与配置文件和共享安装入口分开存放。

每个项目仍会分别保存 Codex / Cursor 的调用规则，但这批操作由安装器自动完成，不需要你逐个手工初始化。已有登记、项目 ID、已审阅档案、功能记录和旧文档保留；只补齐缺失的入口。预览后相关文件发生变化时会停止，要求重新预览。

主动选择新项目并批准最终预览，才算批量接入授权；浏览、检查状态或取消均不算。已拒绝项目在预览中阻止接入，不会被批量安装恢复。预览后接入偏好发生变化也会使计划失效。

安装器不会迁移旧文档、修改业务代码、执行提交或发布，也不会下载 Node.js。新建档案中的分支和发布规则保持未知，后续由 Agent 阅读原规则后补齐，不能把安装完成当成管理规范已经全部审阅。安装测试验证文件和脚本行为，尚未验证 Cursor 界面实际加载。

帮助和独立配置：

```powershell
.\install.cmd --help
node .\scripts\setup-web.mjs --config "D:\work\example-config.json"
node .\scripts\setup-web.mjs --no-open --port 0
```

`--config` 用于明确使用独立的配置指针；已有配置指向另一个中心时不会替换。网页模式从页面选择记录中心，没有无人值守的确认开关。再次增加项目时，已确认的当前记录中心会默认选中，仍要点击确认后才继续；旧记录中心和尚未确认的候选不会默认选中。右上角停止按钮只停止向导服务；仅关闭浏览器标签不会停止服务，终端 Ctrl+C 会结束该启动器所启动的服务。

会话凭据只提供本机访问控制，不应分享包含凭据的链接。接口校验 Host、Origin 和会话凭据，不开放 CORS；预览保存在服务端，30 分钟失效且安装/取消后不可再次执行。它不防御本机已有权限的恶意程序，也不承诺跨项目事务回滚。

原终端版本保留为备用入口：双击 `install-terminal.cmd` 或运行 `npm run setup:terminal`。该模式仍逐行输入项目路径，并在最终预览后输入 INSTALL；部分失败返回退出码 1。网页模式的部分失败显示在结果页面，服务器持续运行，不借服务器进程退出码表示单次安装结果。

## 首次运行

在一个项目中调用 Skill 时，先执行只读检查：

```powershell
node .\scripts\biz-project.mjs inspect --project "D:\work\example-project" --host codex
```

检查会发现接入意愿、全局记录目录、项目登记、已有规则文件和旧文档位置。**不是每个新项目都必须加入。** 未登记项目先询问是否加入，等明确回复；没有回复，不生成记录或调用规则。调用 Skill 或批准普通开发不算同意加入。

选择「不加入」时，Agent 只将拒绝保存到本机共享偏好，项目目录和记录中心都不写入。后续同一配置下，Codex、Cursor 和 generic 都直接跳过记录流程，不再询问或创建记录。偏好默认位于 `~/.config/biz-project/project-preferences.json`；指定 `--config` 时使用其旁边的偏好文件。不同机器/独立配置不自动同步。工具可能仍会加载 Skill 指令，但不会因此启动记录流程。

```powershell
node .\scripts\biz-project.mjs set-participation --project "D:\work\example-project" --decision no
```

只有使用者明确要求重新加入被拒绝项目，才允许执行 `set-participation --decision yes` 恢复，然后按正常流程确认中心并初始化；再次调用 Skill、切换工具或勾选安装预览不会自行恢复。已登记项目不重复询问，增加工具入口或修复缺失文件也不重建档案。

同意加入后，没有记录中心时仍需确认存放路径并等待回复。确认前不能创建中心、指针、项目登记或调用规则；加入意愿不等于确认默认路径。

以下例子假设使用者已明确同意该项目加入，并确认记录中心为 `D:\work\biz-project-data`，然后才执行首次初始化：

```powershell
node .\scripts\biz-project.mjs init --project "D:\work\example-project" --host codex --join-confirmed --records-root "D:\work\biz-project-data"
```

- 优先复用已配置或已发现的 `biz-project` 中心；没有时必须询问，不自动创建默认中心。
- `~/.biz-project` 只是建议位置；使用者可以选择其他目录。不能把建议路径自行填进 `--records-root` 绕过确认。
- 路径优先级：已确认的 `--records-root`、`BIZ_PROJECT_HOME`、用户配置、已存在的 `~/.biz-project` 或 `~/biz-project`。
- 用户配置在 `~/.config/biz-project/config.json`，可用 `--config` 单独指定。新登记类型和托管区块标记也使用 `biz-project`。
- `inspect` 返回 `records_root_confirmation_required`。没有有效中心、配置指向不存在的中心或需要选择旧中心时，未经明确传入已确认路径的 `init` 会失败，并且零写入。
- 为项目登记稳定 ID；同一 Git 仓库的多个 worktree 共用登记。
- Codex 优先使用已有 `AGENTS.override.md`，否则向 `AGENTS.md` 添加一个调用规则区块。
- Cursor 使用 `--host cursor`，新接入默认生成 `.cursor/rules/biz-project.mdc`，设置 `alwaysApply: true`。
- 两种工具共用同一个项目 ID 与功能记录，分别保存调用入口，切换工具不会重建项目。
- Cursor 也可显式选择 `--rules-file "AGENTS.md"`；共享区块同时保留两种工具的调用提示。
- 其他工具可用 `--host generic --rules-file "CLAUDE.md"` 等选项指定它实际加载的规则文件；这不代表已完成该工具的原生适配。
- 保留规则区块外的原文、UTF-8 BOM 和换行；重复初始化不会重复插入。
- 初始化后，Agent 读取已有规则并补齐中心里的项目配置，不能凭当前分支猜测发布规则。
- 初始化不会自动移动旧文档、删除记录或改写项目原有约束。

同一个已配置中心存在后，已登记或已通过 `set-participation --decision yes` 同意的项目可使用以下命令。未登记且尚未回答的项目仍须先询问，同意后才增加 `--join-confirmed`：

```powershell
node .\scripts\biz-project.mjs init --project "D:\work\example-project" --host codex
```

数据目录不能位于 Skill 工程或受管理代码项目内。已有配置指向不同目录时，不会自动覆盖；先明确使用哪个中心。旧 `project-records` 配置与中心只列为候选，不默认复用、迁移或删除。详细流程见 [初始化规范](../references/initialization.md)。

## 文档快照与共享服务

管理服务每次真正启动时扫描整个已确认的记录中心；运行期间监听文档变化，默认稳定 2 秒后快照。只记录中心内已登记项目的 Markdown、项目/功能档案和进展 JSON，不记录工程源码、Skill、Agent 规则、审计、临时文件或凭据。网页与 Skill 只保存文档，不负责生成快照，也不依赖 Git。设置页可暂停监听、重新核对、浏览快照和查看 Markdown/源码历史。

快照保存原始字节和时间，连续相同内容不重复存储，恢复旧内容时复用内容对象但记录新版本。重启可补当前状态，无法补造停机期间的中间版本。快照失败不会阻塞或撤销文档保存。历史只读，当前不提供恢复、差异比较或自动清理；请留意磁盘空间。

正常 Skill 准备使用一次 `ensure-service`，它同时返回检查结果与服务状态，不等待全局扫描。明确的只读任务仍使用 `inspect`。自动启动须在本机设置中允许一次，或明确选择后执行：

```powershell
node .\scripts\biz-project.mjs set-service-policy --project "D:\work\example-project" --host codex --decision yes
node .\scripts\biz-project.mjs ensure-service --project "D:\work\example-project" --host codex
node .\scripts\biz-project.mjs service-status --project "D:\work\example-project" --host codex
node .\scripts\biz-project.mjs stop-service --project "D:\work\example-project" --host codex
```

选择 no 则禁止自动启动。已运行服务会被多个项目/工具复用；缺失服务只在已登记、中心已确认且允许自动启动时隐藏启动，不打开浏览器。主动停止后不自动拉起；明确运行 `start.cmd` 可再次启动，但不会改变自动启动偏好或取消文档监听暂停。私有运行信息在配置指针旁的 `services/` 下，不能发布。不同配置档案的偏好独立。

正常健康检查只验证身份和内存状态，不扫描文档。启动锁防止并发启动；健康请求超时 350 ms，启动最多等待 5 秒，失败后冷却 30 秒。监听队列和并发有上限，空闲不读取正文；15 分钟进行元数据核对，原生监听失败时 60 秒兜底。不会自动开局域网、改防火墙、注册 Windows 服务或安装 MCP。性能与浏览器验收应使用隔离的临时数据，验收产物不纳入源码分发。

## 多工具接入

已选定并建立中心后，在 Cursor 中运行同一套脚本时，把每条命令的 `--host` 设为 `cursor`：

```powershell
node .\scripts\biz-project.mjs inspect --project "D:\work\example-project" --host cursor
node .\scripts\biz-project.mjs init --project "D:\work\example-project" --host cursor
```

`records_initialized` 表示项目记录已登记完整；`initialized` 还要求当前工具的调用入口有效。因此，项目已在 Codex 登记，但 Cursor 首次接入时，只需补齐 Cursor 入口。

省略 `--host` 时仍默认 Codex，兼容已有命令。`--agent` 只用于标记进展的作者，不用于选择工具。已有 Cursor 规则的原文和触发方式不会被强行改写；复杂 YAML、缺失元数据或非 `alwaysApply: true` 的入口会提示人工处理。Cursor 的全局 User Rules 由当前宿主上下文提供，脚本不会读取 Codex 全局规则来代替它。

这版已验证两种工具的入口生成与共用数据流程，尚未在 Cursor UI 中做实际加载测试。支持范围是本地共同可访问的记录中心，不包含云端分发、跨机器同步或 Agent 自动调度。文字模拟见 [运行示例](walkthrough.md)。

## 功能与协作记录

创建功能并指定汇总负责人：

```powershell
node .\scripts\biz-project.mjs create-feature --project "D:\work\example-project" --host codex --title "优惠券流程修复" --owner "coordinator"
```

执行 Agent 使用返回的功能 ID，按 [交接模板](../assets/update-template.md) 准备内容后提交独立进展：

```powershell
node .\scripts\biz-project.mjs add-update --project "D:\work\example-project" --host codex --feature "feature-id" --agent "worker-a" --body-file "D:\work\update.md" --update-id "worker-a-checkpoint-1"
```

不同 Agent 的记录分别发布，同一进展重试可复用 `update-id`；相同 ID 的不同内容会被拒绝。负责人核对修改和验证结果后，更新功能主文档。单个 Agent 完成自己的部分，不会自动把整体功能标为已集成或已发布。

本版的锁保护登记和创建操作，独立进展采用原子发布。主文档的手工编辑仍需遵守单一负责人约定。支持多 Agent 协作不等于授权创建子 Agent、跨聊天发送消息或执行代码合并。

详见 [协作与同步规范](../references/collaboration.md)、[记录格式](../references/record-format.md) 和 [功能模板](../assets/feature-template.md)。

## 安装与工程维护

要求 Node.js 20 或以上，无第三方运行依赖。优先使用上面的网页安装向导。也可直接从这个目录运行脚本，或手工建立安装入口。网页图标是本地打包的 Lucide 静态资源，许可见 `web/LUCIDE-LICENSE.txt`，不依赖 CDN。

Codex 和本地 Cursor 都能从 `~/.agents/skills/` 加载 Skill，因此可以共用一个工程目录。以下命令在工程根目录执行，并且不会覆盖已有安装：

```powershell
$recordsSkillSource = (Get-Location).Path
$recordsSkillInstallRoot = Join-Path $env:USERPROFILE ".agents\skills"
New-Item -ItemType Directory -Path $recordsSkillInstallRoot -Force
New-Item -ItemType Junction -Path (Join-Path $recordsSkillInstallRoot "biz-project") -Target $recordsSkillSource
```

安装后在 Codex 中通过 `$biz-project` 调用，在 Cursor Agent 中通过 `/biz-project` 选择调用。目录链接使工程修改同步到安装入口，不需要复制第二份 Skill。每个参与的 Agent 都需要能访问 Skill 和同一个记录中心。初始化项目规则不等于安装 Skill，常驻规则也不保证模型一定执行全部流程；应检查实际记录和验证证据。

加载路径和调用方式依据 [OpenAI 官方文档](https://learn.chatgpt.com/docs/build-skills)、[Cursor Skills 文档](https://cursor.com/docs/skills)；Cursor 入口元数据依据 [Cursor Rules 文档](https://cursor.com/docs/rules)。本地用户 Skill 不会自动分发到云端或远程机器。

运行验证：

```powershell
npm test
npm run check
```

测试只在临时目录运行，覆盖只读检查、未确认中心时零写入、新命名、旧中心候选、首次登记、重试、规则保留、worktree 身份、并发进展提交、批量接入、取消、部分失败、Windows 启动路径引号和本机网页接口的确认/会话边界。它们不代表已完成独立 Agent 的行为评测。

额外的真实浏览器验收：`npm run test:ui`。开发验证环境需提供 Playwright、pngjs 与已安装的 Edge（可用 `BIZ_PROJECT_TEST_BROWSER` 指定其他 Playwright 浏览器通道）；如果模块在外部运行环境，设置 `BIZ_PROJECT_TEST_MODULES` 为其 node_modules 目录。测试自动创建临时 home/项目/中心，走完整安装与失败重试，检查桌面/手机布局并输出截图目录；还在 1366、390、320 像素宽度检查新选、已有及旧中心候选的单选控件、文字宽度和内容重叠，验证选择仍不写入记录。这些不是用户安装向导的运行依赖。

本项目采用 [MIT 协议](../LICENSE)。源码开源不包含真实记录、机器配置或凭据；仓库准备完成也不代表已完成正式发布。

## 改名兼容

工程与 Skill 从 `project-records` 改名为 `biz-project`，脚本入口为 `scripts/biz-project.mjs`。新中心、配置、环境变量、登记类型和托管标记统一采用 `biz-project`；改名不自动迁移已有私人记录，也不改变稳定的项目和功能 ID。

旧 `~/.project-records`、`~/project-records`、`~/.config/project-records/config.json` 和 `PROJECT_RECORDS_HOME` 只用于只读发现，列在 `legacy_records_centers` 中。Agent 应先报告候选并询问使用者，不把它们当成默认选择。只有明确选择旧中心时，才能以 `--records-root` 接入；对旧登记类型的每次写入都需要该参数，并保留原有类型和 ID。迁移、更名或删除旧数据需要另行授权。

旧调用区块在授权初始化时替换为 `biz-project` 标记和调用名，区块外原文不变。混合或损坏的标记会阻止写入。已登记且仍存在的旧 Cursor 文件 `.cursor/rules/project-records.mdc` 会原地更新，不额外创建第二份规则；新接入使用 `biz-project.mdc`。
