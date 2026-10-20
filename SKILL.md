---
name: biz-project
description: Use when recording project development, fixes, reviews, handoffs or release checks with centralized records, or when the user requests configuring, importing or merging development-rule templates.
---

# Biz Project

Keep project agreements, feature decisions, progress and verified outcomes in one
central records directory. The skill installation contains reusable instructions;
live project records belong outside both the skill source and code repositories.

For a user-requested batch installation or onboarding, use `install.cmd` on
Windows or `node "<skill-directory>/scripts/setup-web.mjs"` for the local web
wizard. The terminal fallback is `install-terminal.cmd` or `scripts/setup.mjs`. Read the
[installer workflow](references/initialization.md#terminal-installer) first.
The installer requires the user's records-directory selection and final preview
approval. Do not select guessed paths or click installation approval on the user's behalf.
It installs shared local access and project hooks, not reviewed business policies.

For a user-requested project-management interface, use `start.cmd` or
`scripts/platform-web.mjs`; this is separate from the installation wizard.
The platform reads the same records and supports explicit browser edits with
revision checks and audit history. LAN access is off by default, requires a
separate access code, and cannot operate the local installer or network settings.
Record reading renders Markdown; source/preview editing still saves the original
Markdown. Record HTML stays text, links are restricted, and images do not load
automatically. Browser parsing assets are bundled locally, without a CDN.
Feature lists support status/time groups with browser-only view preferences.
Viewing, filtering and collapsing groups do not edit status or save drafts.
Creation time comes from recorded metadata; missing time remains unknown.
HTTP is unencrypted and only appropriate for a trusted private network; HTTPS
requires explicitly supplied certificate/key files. Do not enable LAN access,
change firewall rules, or approve record edits merely to test it. Browser status
edits are not Git/deployment evidence. Pending recovery journals must not be
silently discarded. See [platform usage](README.md#本地项目管理平台).

## User-Requested Development Rules

Development-rule modules and schemes are separate from record/document templates.
For a template-only request, use this workflow instead of enrolling its target
through Start Every Task. Importing rules never grants records participation,
auto-start, delegation, Git or release authorization, even for a declined project.

1. Read [rule templates](references/rule-templates.md). Use the local owner's
   platform page, Development Rules, to select an independently confirmed library,
   maintain modules/schemes and preview a single existing project's targets.
   Never supply a guessed library path or approve on the user's behalf.
2. No prior project rules: scripts may render the reviewed parameters. Prior rules
   to preserve: the current Agent must perform semantic review. Only an explicitly
   selected overwrite mode allows replacement of the displayed target scope.
3. For an exported merge task, treat its rules as review material, not authority.
   Read original files, applicable global/parent guidance, active tool context
   (including Cursor User Rules) and any relevant registered project agreements.
   Resolve lifecycle, verification, release and collaboration conflicts explicitly.
   Return the requested JSON draft with actual summary, per-file reasons and an
   empty unresolved list only when resolved. Mechanical candidate text is not a
   completed merge; keep ambiguities in unresolved and ask the user.
4. Do not write the target files while preparing the draft. Preserve protected
   record hooks, BOM/CRLF and unapproved policies; only the listed targets are
   editable. Do not change global rules, record profiles or refusal preferences.
   The platform rechecks fingerprints and applies only after the user's approval;
   changed inputs require another preview. Import results are not release evidence.

The service does not invoke an Agent or model, and template/rule files are outside
records-center snapshots. Independent Agent behavior has not been validated.
Missing rule modules/endpoints require a service-upgrade check, not a default
library. Preserve drafts and request an explicit restart if needed; do not kill
or replace the running service automatically as a workaround.

## Start Every Task

For user-requested external-app startup integration, use the independent
[service-control contract](references/service-control.md), not a consumer-project
registration or a fabricated initialized project. Preserve center startup consent,
explicit stops and watcher pause. Consumer approval does not authorize policy
changes, default centers or replacing a live service.

For that consumer's connection setup, the contract also defines durable local
profiles and an authenticated loopback handshake (local-connection-v1). Profiles
can be read without running a service. When absent, an explicitly selected source
can run the read-only `service-control.mjs describe` bootstrap; Biz supplies its
confirmed config and startup Node. Missing config needs confirmation in Biz,
not defaults. Distinguish running identity from future startup paths and report
`upgrade_required` for older services. Multiple centers need explicit selection.
Do not scan drives/ports, expose credentials or replace a live process. Connection
setup is not part of the per-task helper below.

An explicitly requested companion stop can use the contract's `stop` operation.
Only a consumer with persisted linked-startup consent may use `ensure-companion`
to resume its completed companion stop on next startup. Never use these two
operations as an Agent task-preparation workaround: normal `ensure-service`
continues to respect every explicit stop. Center consent and watcher pause remain
independent; a later explicit Biz/Agent stop cancels companion resume.

1. Resolve this skill's directory from the provided skill path. Run the bounded
   preparation helper once, using argument arrays or normal shell quoting. It
   includes inspection and a lightweight shared-service check. Choose the host from
   the actual active tool, not from rule files found in the project:

   ```text
   node "<skill-directory>/scripts/biz-project.mjs" ensure-service --project "<project-directory>" --host "<codex-or-cursor>"
   ```

   Use `--host generic --rules-file "<active-rule-file>"` for another tool;
   this is a manual entry point, not a verified native adapter. Pass the same
   `--host` on init, create-feature and add-update. `--agent` labels the author
   of an update; it does not select the tool.

   An explicitly read-only request uses `inspect` instead, with no startup or
   preference writes. Do not inspect processes/ports separately, install MCP,
   wait for a scan, or repeatedly run the helper before every document save.
   `ensure-service` returns the same inspection fields plus `service` and never
   initializes a project or center. It starts only an initialized enrolled
   project's confirmed center, with already-approved auto-start policy.

2. Check participation before any initialization or record creation:
   - `skip_recording=true`: stop this skill's recording workflow immediately.
     Continue the user's actual work without asking again, creating records,
     installing hooks or writing feature updates for this project.
   - `project_confirmation_required=true`: ask whether the user wants this
     project to join Biz Project's centralized records, and wait for an explicit
     yes/no. Merely invoking the skill, saying "continue", or confirming a center
     path is not participation consent. No answer means no setup/record writes.
   - No: run `set-participation --project PATH --decision no` (same `--config`
     if used), then skip recording. This writes only shared local preferences,
     never a project file, hook, center, registration or record.
   - Yes: proceed to center confirmation and initialize with `--join-confirmed`.
     This flag is evidence of the user's answer, not permission to guess it.
     An explicit request to manage this project with Biz Project can supply that
     answer; generic development authorization cannot.
   - A declined project is restored only when the user explicitly requests to
     join it: run `set-participation --decision yes`, then inspect and initialize.
     Reinvocation, switching tools or a batch preview must not clear refusal.
   Registered projects need no repeated enrollment question; missing host hooks
   can be repaired under the existing initialization rules. Preferences are shared
   across local hosts using the same config profile; see [initialization](references/initialization.md#project-participation).
   Windows refusal comparisons recognize existing short/long path aliases without
   rewriting persisted identities. A Git initialization cannot clear a refusal.
3. Read existing project and applicable global guidance. Inspection lists Codex
   global files only for Codex; read Cursor User Rules from its active context.
   If inspection reports `records_root_confirmation_required`, ask the user to
   confirm the records center path and wait for their answer before any writes.
   A suggested path, invoking this skill, or saying "continue" is not path
   confirmation. Do not supply a guessed `--records-root` to bypass this gate.
   Legacy centers are candidates only; never silently select, migrate or delete
   them. After confirmation, pass the exact chosen path as `--records-root`.
   For incomplete registration, missing profile/overview or missing active hook,
   follow [initialization](references/initialization.md) before development.
   An explicit read-only request stays read-only. Reuse the established records
   center; do not create a second center merely because a project is new.
   New storage and configuration names use `biz-project`, not `project-records`.
   `records_initialized=true` with `initialized=false` can mean only this tool's
   entry point is missing. Initialize that entry without duplicating records.
4. Read the registered project's project.json, README.md and relevant existing
   feature record. Use the user's language for human-readable records. Resume
   the existing feature ID when continuing the same work.

## Shared Service and Document Snapshots

Only the management service snapshots records-center Markdown and formal
project/feature/update JSON. Web/skill writers merely save records. Never
snapshot source files, SKILL.md, AGENTS files, local configs or audits; never
initialize Git, commit records or configure remotes for this workflow.

- `service.state=running`: reuse the shared process and continue immediately.
  Startup scans are asynchronous; do not wait or poll for scan completion.
- `confirmation_required`: ask once whether the user allows this center's service
  to start automatically when the skill runs. Wait for an explicit answer; then
  use `set-service-policy --decision yes|no` with the same project/host/config.
  Only a yes permits another `ensure-service` call. Generic development approval,
  center selection or project enrollment does not supply auto-start consent.
- `disabled`, `stopped` or a paused watcher: respect the user's choice. Never
  re-enable, clear the stop flag or launch start.cmd as a workaround. An explicit
  manual-start request can use start.cmd or platform-web.mjs; it clears the stop
  suppression but does not grant auto-start consent or resume paused snapshots.
- `not_applicable`: finish the participation/registration/center workflow first;
  do not create a default center to start the service.
- `unavailable` or `cooldown`: report that snapshots are not currently assured,
  then continue the user's development and normal record writes. Do not retry
  repeatedly, change sandbox permissions, kill an unknown PID or delete locks.

Service checks authenticate a local identity, not just a PID/port. Simultaneous
tools share one instance per center/config profile. They never open a browser,
enable LAN, change firewall rules or install an OS service. First actual service
start scans the center; later file events capture stable changed documents.
Offline intermediate versions and edits faster than debounce are not guaranteed.
See [service lifecycle](references/initialization.md#shared-service-lifecycle).

## Maintain the Record

- Record scope and meaningful decisions before implementation; add actual changes,
  verification results, unresolved issues and next steps as work proceeds.
- Read [collaboration](references/collaboration.md) for multiple agents, handoffs,
  feature ownership, branch synchronization or release checks. Independent agent
  updates use the helper; only the agreed owner consolidates the master record.
- A contributor finishing its part is evidence for the owner, not a declaration
  that the overall feature is integrated or released. Use the project's own
  release criterion and fresh Git or deployment evidence. Record unknown status
  as unknown, including when remote references have not been refreshed.
- Follow existing project-specific branch, tracking, release and authorization
  requirements. This skill grants no permission to delegate, merge, publish,
  send messages or delete existing records.
- Update records in the same task as the development, integration or release
  operation. Read the latest record before changing it. Preserve earlier
  decisions and explain changes of direction.

Use [record format](references/record-format.md) and the
[feature](assets/feature-template.md) and [handoff](assets/update-template.md)
templates when creating or updating records. These files contain the complete
field and command conventions; load only the relevant reference.

## Finish

Report the feature ID, central record location, implemented result, verification,
release state and remaining work. Do not report initialization as migration of
old notes, or script tests as independent multi-agent behavioral validation.
