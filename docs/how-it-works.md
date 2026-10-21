# How it works: shared progress across AI coding tools

**English** · [简体中文](how-it-works.zh-CN.md)

[Home](../README.md) · [User guide (中文)](usage.md) · [Collaboration contract](../references/collaboration.md)

Biz Project supports a common way of working: one person maintains several projects and uses different AI coding tools or conversations to develop them. Shared local files preserve project agreements and progress so later work has a traceable starting point. The rules library helps projects reuse and customize their development standards.

## 1. How the skill runs

The skill includes [`SKILL.md`](../SKILL.md) for the agent to read, supporting references, record templates, and a Node.js helper. After installation, supported tools can discover it. Invoke it with `$biz-project` in Codex or `/biz-project` in Cursor.

The current agent performs the work. It reads the skill instructions, then uses its command-line and file tools to follow these steps:

1. **Inspect the current project.** Run the skill's `scripts/biz-project.mjs ensure-service` helper with the project directory and the actual host, `--host codex` or `--host cursor`. Explicitly read-only tasks use `inspect`.
2. **Locate existing context.** Read the registration, project profile, and relevant feature record. Reuse the feature ID when continuing the same work, rather than creating a new record for every conversation.
3. **Develop and verify.** Record scope and key decisions first. Follow the project's own rules to change code, run verification, and check the current branch and actual results.
4. **Save and hand off.** Write changes, verification evidence, unresolved issues, and next steps back to the feature. Use `add-update` for individual progress updates.

`ensure-service` also checks the shared service. It starts the service only for an enrolled project with approved automatic startup, and respects explicit stops. The agent still performs development and recording; the background service primarily provides the workspace and document snapshots.

First-time wizard setup requires confirmation of project participation, the external records center, and the installation preview. Daily work reuses the registration, so switching tools does not create another center. See the [multi-tool instructions (中文)](usage.md#多工具接入) for commands.

## 2. How AGENTS.md and the skill work together

`AGENTS.md` is a project rule file read by agent tools. It describes the agreements to follow in that project; the skill supplies a reusable workflow. Together, they let the agent connect the current project to the right process and its existing records.

| Tool | Default project entry | Invocation |
| --- | --- | --- |
| Codex | Update an existing `AGENTS.override.md` first; otherwise use `AGENTS.md` | `$biz-project` |
| Cursor | `.cursor/rules/biz-project.mdc` with `alwaysApply: true` | `/biz-project` |
| Other tools | A rule file explicitly selected by the user and actually loaded by that tool | Manual integration through `--host generic --rules-file …`; native adapter behavior has not been verified |

The installer configures skill access for the selected tools and adds a managed invocation block to the project. That block contains the project records ID and instructions to inspect before working, read existing context, follow project agreements, and maintain records afterward. Project registration alone installs invocation guidance; it does not separately install the skill.

The block can be summarized as follows. This is a reading example; the installer generates the actual entry while preserving existing rules:

```text
Use the biz-project skill for development, fixes, reviews, and handoffs in this project.
Select the actual tool's host and locate the registered project records ID.
Read project agreements and existing feature records before working.
Write actual changes, verification evidence, and next steps back to the same feature.
```

**Project rules provide the entry point, the skill provides the process, and central records provide the context.** The agent must load and follow these instructions. Entry files do not execute scripts, collect conversations, or start other agents on their own.

## 3. One center, separate project agreements

The records center lives outside source repositories. Angle brackets below stand for actual IDs:

```text
records-center/
├── registry.json                         Project registration and tool entries
└── projects/
    ├── <project-a-id>/
    │   ├── project.json                  Branch, verification, release, collaboration rules
    │   ├── README.md                     Project overview and current context
    │   └── features/
    │       └── <feature-id>/
    │           ├── feature.json          Identity, owner, and status
    │           ├── README.md             Scope, decisions, progress, and handoffs
    │           └── updates/*.json        Individual contributor updates
    └── <project-b-id>/                    Separate agreements and feature records
```

For example, a storefront frontend and an order service can appear in one workspace while keeping different verification commands and release criteria. When the agent switches projects, it locates that project's ID and reads its profile and rules.

Linked worktrees of the same local Git repository are identified through their shared Git directory. Non-Git projects use their resolved directory identity. Codex and Cursor register separate entries while keeping the same project and feature IDs. An independent clone or another machine is not automatically matched to the original registration, and there is no automatic cross-machine synchronization.

## 4. How multiple agents share progress

### Sequential handoffs: change tools, continue the feature

| Stage | Agent action | Context left for the next task |
| --- | --- | --- |
| Codex implements an API | Read the login feature record, implement the API, and verify it | Interface decisions, changed code, test results, pending integration work |
| Cursor continues the UI | Read the same feature, check the code, and continue integration | UI integration results, encountered issues, new verification evidence |
| A later conversation resumes | Read the latest record again and check remaining work | A clear starting point and conclusions that still need verification |

Even an existing conversation needs to reread current records. Records provide a persistent handoff; actual code, tests, and release evidence determine the current state.

### Parallel work: separate updates, one consolidated record

For a shared feature, first agree on its owner and each contributor's scope, interfaces, branch or worktree. Then follow this workflow:

1. Each contributor reads the current feature and confirms their assignment.
2. Contributors submit separate files through `add-update`, including an author label, changes, verification results, and remaining issues. They do not compete to append to one log.
3. Retry the same submission with the same checkpoint ID. Changed results use a new ID and explain which earlier conclusion they replace.
4. The owner reads the updates, checks the code and verification results, and consolidates accepted conclusions into the master feature record, retaining source update IDs.
5. The owner adjusts the overall status using evidence for the entire feature, and identifies work still awaiting integration and the next steps.

Submitting an individual update does not advance the overall status. Ownership is a collaboration agreement rather than account-based access control. The helper's lock does not protect arbitrary manual edits to the master document. Browser saves check revisions for conflicts, but contributors should still avoid editing the master record simultaneously.

Biz Project provides the recording convention and file mechanisms. Spawning agents, messaging other conversations, merging code, and publishing still follow user authorization and project rules. Integration records should include source and target commits, verification results, and the observation time. Marking a feature as released does not deploy or verify a release.

## 5. Define and reuse rules for different projects

**The development rules library is separate from the records center.** It stores reusable modules and schemes; project profiles and rule files hold the agreements actually adopted by each project.

For example, reuse these agreements while supplying different project parameters:

| Reusable agreement | Project A might use | Project B might use |
| --- | --- | --- |
| Read project context before development | Frontend directories and component conventions | Service directories and interface conventions |
| Verify changes before committing | Frontend tests and build commands | Backend tests and API acceptance commands |
| Check integration and releases | Its own branches and deployment conditions | Its own branches and packaging conditions |
| Include evidence in agent handoffs | Changes, verification, and next steps | Changes, verification, and next steps |

In the workspace, select modules or a scheme, a target project, and a tool. Fill in parameters and preview the write scope. Codex targets an existing `AGENTS.override.md`, otherwise `AGENTS.md`. Cursor's development rules go to `.cursor/rules/biz-project-development.mdc` by default, separate from its records invocation entry.

To preserve existing rules, export a merge task for the current agent to review against the originals, then import its draft and approve application in the workspace. Protected records invocation blocks are retained. Importing rules does not modify the central project profile. When branch, verification, or release agreements change, update the profile too, so the two remain consistent.

A target project can use the rules library without joining centralized records. Updating a template does not automatically overwrite files already applied to projects. See [development rule templates](../references/rule-templates.md) for the full process.

## 6. Scope

Shared progress depends on contributors using the same center, locating the same project and feature, and reading and writing records as they work. The current target is local Codex / Cursor workflows. Tests of entry generation and shared data mechanisms do not replace independent behavior checks in each agent product's UI.

The workspace lets you browse, edit, and search records; the shared service captures document snapshots while running. There is no cloud sync, team account system, conversation transfer, model API integration, or automatic agent scheduling. Private LAN access shares local records but does not automatically connect agents on another machine.

Keep live records, pointer configuration, and credentials outside the repository. See the [privacy guide (中文)](privacy.md) for the boundary between source and personal data, and [Security (中文)](../SECURITY.md) for network access and settings.
