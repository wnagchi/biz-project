<div align="center">

<img src="docs/assets/brandmark.svg" alt="Biz Project" width="80" height="80" />

# Biz Project

### 把项目进展、开发规则和 Agent 交接，放进一个工作台。

本地运行的 AI 开发项目管理工具。<br />你在网页中看全局，Agent 按 Skill 约定读写同一份项目记录。

[![Release](https://img.shields.io/github/v/release/wnagchi/biz-project?style=flat-square&label=release&color=087f6b)](https://github.com/wnagchi/biz-project/releases) [![CI](https://github.com/wnagchi/biz-project/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/wnagchi/biz-project/actions/workflows/ci.yml) [![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-087f6b?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/) [![MIT](https://img.shields.io/badge/license-MIT-536b70?style=flat-square)](LICENSE)

[界面预览](#本地项目管理平台) · [核心能力](#把开发里的三件事接起来) · [快速开始](#快速开始) · [使用手册](docs/usage.md) · [更新记录](CHANGELOG.md)

</div>

## 本地项目管理平台

一个项目从哪里开始、某个功能为什么这样做、上次验证到了哪一步——把这些信息留在可继续维护的记录里，下次开发便有了起点。

<a href="docs/assets/workbench.png"><img src="docs/assets/workbench.png" alt="Biz Project 真实工作台：左侧项目、中间功能状态分组、右侧功能记录" width="100%" /></a>

<p align="center"><sub>真实工作台 · 项目 → 功能 → 记录三栏联动 · 截图中的项目与内容均为演示数据</sub></p>

## 把开发里的三件事接起来

### 01 · 多个项目，也能看清下一步

在工作总览中切换项目，按状态或时间整理功能，直接阅读当前记录。需求范围、关键决定、验证结果和待办有各自的位置，受阻项与正在推进的工作可以一起查看。

- **看进度**：项目与功能筛选、状态/时间分组、跨项目全文搜索。
- **维护记录**：项目约定、功能正文、独立进展和修改历史，支持 Markdown 阅读与源码/预览编辑。
- **找历史**：共享服务保存记录文档快照，可浏览过往内容、暂停监听和重新核对。

### 02 · 换一次对话，仍能沿着同一个功能继续

Biz Project 由**可视化平台与 Agent Skill**共同使用同一份记录。Codex 和 Cursor 分别安装调用入口，项目和功能保持稳定的 ID；接续开发时，Agent 先读取既有约定和进展，再维护本次结果。

```text
用 biz-project 继续这个项目的登录功能。
先读取项目约定和已有功能记录，核对当前代码，再处理尚未完成的联调。
本次完成后，把实际修改、验证结果和下一步写回同一个功能记录。
```

记录由遵循 Skill 指令的 Agent 或网页编辑维护。它不自动抓取聊天，也不会替你调度其他 Agent；接续时仍需核对实际代码与验证证据。

<details>
<summary><strong>查看独立进展示例</strong></summary>
<br />
<img src="docs/assets/progress.png" alt="同一功能下以 Cursor 和 Codex 为作者标签保存的独立进展，内容为演示数据" width="770" />

不同作者的进展分别保存，由负责人核对后汇总。作者标签用于记录来源，不是团队账号或自动调度功能。

</details>

### 03 · 把开发约定，变成下一项目可复用的规则

在独立的开发规则库中维护模块和完整方案，覆盖生命周期、开发、验证、发布与 Agent 协作。规则正文使用 Markdown，可设置项目参数，按项目组合后再预览应用。

- **复用约定**：编辑、复制、归档和恢复模块/方案。
- **先看差异**：选择目标项目和工具，确认参数与写入范围后再批准。
- **保留已有规则**：导出合并任务交给当前 Agent 审阅，导入草案后再次核对和确认。

规则库可以独立使用，目标项目无需先加入集中记录。已经应用到项目的规则独立保存，修改模板不会自动覆盖项目。

<details>
<summary><strong>查看规则模块编辑界面</strong></summary>
<br />
<img src="docs/assets/rules-module.png" alt="真实规则模块编辑窗口：Markdown 开发约定、规则领域及开发分支参数，内容为演示数据" width="620" />

</details>

## 快速开始

运行需要 **Node.js 20+**，已包含预编译网页资源，**无需先运行 `npm install`**。

### 1. 获取源码

[下载 ZIP](https://github.com/wnagchi/biz-project/archive/refs/heads/main.zip) 并解压，或使用 Git：

```sh
git clone https://github.com/wnagchi/biz-project.git
cd biz-project
```

### 2. 一次接入，后续复用

Windows 双击 **`install.cmd`**；其他终端在工程目录运行：

```sh
npm run setup
```

在浏览器中按 **选择外部记录中心 → 选择项目与 Codex / Cursor → 审阅预览 → 确认安装** 完成接入。已有记录和项目规则会保留，旧文档不会自动迁移。Skill 入口链接到此源码目录，接入后请保留该目录的位置。

### 3. 打开工作台，开始开发

向导中点击 **「打开项目管理」**，或 Windows 双击 **`start.cmd`**。之后可直接启动平台；终端用户在另一个终端进入工程目录运行：

```sh
npm start
```

在 Codex 中使用 `$biz-project`，在 Cursor 中选择 `/biz-project`。平台负责浏览和维护记录，Skill 为 Agent 提供读取、记录与交接的工作约定。

> **访问范围**：`npm start` / `start.cmd` 默认接受私人 IPv4 局域网，同网段设备可直接查看和编辑记录，无访问码。仅需本机访问时运行 `npm start -- --no-lan`；复用已有服务时请核对本机设置。安装向导与 Agent 联动启动仅监听本机。详见 [安全说明](SECURITY.md)。

## 数据留在你选择的位置

项目记录以 **Markdown + JSON** 保存，记录中心、规则库和源码分开存放。你可以直接查看与备份原文件，也可以从网页编辑；修改冲突会被检查，文档快照由共享服务在运行时维护。

源码发布不包含你的项目记录、本机配置或服务凭据。仓库提供忽略规则和提交候选检查，详见 [隐私指南](docs/privacy.md)。

<details>
<summary><strong>使用前需要了解的边界</strong></summary>

- 当前面向本地 Codex / Cursor 工作流；其他工具需显式选择规则文件，不代表已经提供原生适配。入口生成与共用数据流程已验证，不能代替各 Agent 产品 UI 的独立行为验证。
- 本项目不提供云同步、团队账号、模型 API 接入或 Agent 自动调度。私人局域网访问共用本机记录，不等于跨机器 Agent 同步。
- 功能状态记录实际进展。选择“已上线”不会执行 Git、部署或自动核验发布。
- 快照可浏览历史，当前不提供自动恢复、差异比较或自动清理。源码更新也不会替换已运行的后台服务，服务升级需先保存草稿再明确重启。
- 模板导入、项目接入和重要写入有各自的预览/确认流程。支持协作记录，不等于授权创建子 Agent 或自行合并代码。

</details>

## 继续探索

| 想了解什么 | 从这里开始 |
| --- | --- |
| 安装、平台操作与 CLI 用法 | [完整使用手册](docs/usage.md) · [运行示例](docs/walkthrough.md) |
| 接入与记录格式 | [初始化规范](references/initialization.md) · [记录契约](references/record-format.md) |
| 规则复用与交接 | [开发规则模板](references/rule-templates.md) · [协作与同步](references/collaboration.md) |
| 外部应用与服务 | [本机应用联动](references/service-control.md) |
| 参与开发与版本维护 | [贡献指南](CONTRIBUTING.md) · [版本规范](docs/versioning.md) · [更新记录](CHANGELOG.md) |

欢迎通过 [Issue](https://github.com/wnagchi/biz-project/issues) 交流使用场景与可复现的问题，也欢迎提交聚焦的改进。前端开发环境、验证命令与截图要求见贡献指南。

---

<div align="center">

**本地运行 · 文件可读 · 上下文可接续**

[MIT License](LICENSE) · [Lucide 许可](web/LUCIDE-LICENSE.txt) · [Marked 说明](web/vendor/README.md)

</div>
