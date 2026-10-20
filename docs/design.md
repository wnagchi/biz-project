# Biz Project v0.1

The skill standardizes project registration, feature records, agent handoffs,
branch synchronization evidence and release checks. All live records belong to
an external records directory. This repository contains only reusable skill
instructions, templates, executable helpers and tests.

## First use

External desktop connection discovery uses the independent contract in
references/service-control.md, extended by the approved 2026-10-15 offline source
bootstrap. An explicitly selected source describes its confirmed configuration
without a running service or published profile. Default discovery stays bounded
and spawn-free. Production wizard/platform starts share registration, including
late center confirmation. Older live services require manual restart; startup
paths are not fabricated running identity.

The original local-profile contract is in
references/service-control.md. Actual confirmed-center service starts publish a
credential-free durable profile beside per-user configuration, never in source
or records. Authenticated loopback handshake verifies its current instance and
actual startup paths. Bounded local discovery and explicit profile selection
replace consumer-side path guessing; offline startup retains the existing
service-control authorization/stop/pause gates. An older live process is never
replaced to obtain these capabilities.

Project enrollment is independent from selecting a center. Unregistered projects
must receive an explicit yes/no before initialization; no answer means no writes.
Inspect exposes project_confirmation_required. An explicit yes is supplied as
--join-confirmed on init or stored via set-participation --decision yes. Existing
registrations retain consent during repairs/host switches. Center confirmation
remains a separate gate and is never implied by enrollment.

Refusal is stored only in shared local project-preferences.json beside the config
pointer; never add a refusal marker, hook or record inside the project/center.
Inspect checks it first and returns skip_recording without center/guidance prompts;
all record-writing helpers reject it. Only the user's explicit re-enrollment
request permits changing no to yes; invoking the skill or a preview cannot reset
it. Decisions share canonical Git identity and paths across tools on the same
config profile. Independent clones/moves/machines/profiles are not inferred.
Center discovery used by management is independent from source-project enrollment.

Windows refusal matching resolves existing short/long aliases through native
realpath before case folding. This preserves the decision when Git reports a
different spelling of the same directory; comparison does not migrate stored
identities or rewrite existing preference paths.

Run a read-only inspection before making changes. Resolve the records root from
an explicit argument, BIZ_PROJECT_HOME, the user configuration, or existing
recognized directories. Multiple discovered centers require a deliberate
selection. If no recognized center exists, ask the user to confirm a path and
wait before creating any center, pointer, registration or project hook. The CLI
rejects init without an explicit --records-root in that state, even when an
environment variable or dangling pointer supplies a path. ~/.biz-project is
only a suggestion, never a fallback. Do not invent an explicit argument to
bypass confirmation. Never use the skill source directory as the records root.

Identify Git projects by their shared Git directory so linked worktrees share
one registration. Non-Git projects use their resolved directory. Inspect existing
project guidance before adding a bounded invocation block to the rule file the
active agent actually loads. For Codex, prefer AGENTS.override.md when present,
otherwise AGENTS.md. Support an explicit alternative rule file inside the project.
Preserve existing bytes outside the block, including BOM and line endings.

Select the active tool explicitly with --host (codex, cursor, generic), defaulting
to codex for older callers. Cursor installs a dedicated always-applied
.cursor/rules/biz-project.mdc, or an explicitly selected root AGENTS.md.
Both tools share project identity and records, but registrations keep per-host
guidance selections. A shared managed block mentions both native invocations;
it remains usable if the user deliberately chooses one shared AGENTS.md.
Generic mode requires an explicit active rule file; it is not a native adapter.

Cursor User Rules are host context, not inferred disk files. Existing MDC headers
are preserved, with conservative validation of a flat scalar frontmatter subset.
Inactive or complex metadata requires review, rather than changing activation
conditions. The CLI reports shared records readiness separately from overall
readiness including the selected tool's hook. This does not verify skill discovery
inside either UI or install the skill.

Registration and hook installation are retryable. First use does not silently
migrate existing notes or override project-specific branch, release, telemetry,
tracking, or delegation requirements. Migration is a separate scoped operation.

## Terminal installer

install-terminal.cmd opens scripts/setup.mjs on Windows; npm run setup:terminal is the terminal
entry point. Node 20+ and built-ins only. The wizard selects tools, collects
project directories and discovers a center read-only. A recognized established
center may be explicitly reused. Missing and legacy centers require a typed
selection; no default center is created. A final INSTALL approval follows a
preview of all selected paths and per-entry changes. EOF/Ctrl+C/cancellation
before approval performs no setup writes.

scripts/lib/setup.mjs separates prepareSetup (read-only) and applySetup
(requires both directory selection and final approval). Preparation validates
the center, pointer, source, existing installation and entries. It snapshots
relevant guidance, config, registry, participation preferences and existing profile
files. Selected new projects are joined only after final batch approval. Declined
entries are blocked, not restored by selection. Apply repeats
preflight and rejects a stale or altered plan before writes. This detects preview
drift; it is not a cross-project transaction or a continuous filesystem lock.
Existing per-operation registry locks still guard initialization.

The global ~/.agents/skills/biz-project directory link references one local
source for both hosts. Never overwrite a foreign installation. Keep the center
separate from the source, projects, config pointer and installation location.
Apply uses existing inspect/init APIs without changing record schemas. Normalize
and deduplicate project/host inputs; keep worktree entry points distinct while
the shared Git identity remains one record. Skip complete entries, repair
missing ones, preserve reviewed records and report partial failures with a
nonzero exit. Retain successful entries for idempotent retry, without rollback
deletion. Invalid entries do not block other approved usable entries; a wholly
blocked plan creates nothing. New profiles still need agent agreement review.

No automatic migration, Node download, business-code edits, tool installation,
commits, publishing, cloud distribution or UI loading guarantee is added.

## Local web interaction

The user's review rejected the sequential terminal input experience. The default
install.cmd / npm run setup now launches scripts/setup-web.mjs, a built-in HTTP
server with static HTML/CSS/JavaScript. The terminal remains a fallback, and the
record schema remains unchanged. Reuse prepareSetup/applySetup rather than a
second installation implementation. Optional per-project host selection belongs
to ephemeral setup options, not stored record metadata.

Four steps: explicit center selection, directory-based project/tool selection,
change preview/approval, and per-entry results. An already confirmed current
center is preselected when adding another project; the user still confirms that
step before any write. Unconfirmed discoveries and legacy centers are not
preselected. Directory browsing reads immediate children only and never
preselects projects; it supports
drive/common roots, filtering, parent traversal and new-center names without
creation. Back navigation preserves input, invalidates old plans, and failed-only
retry rebuilds a fresh selection. UI state never substitutes for backend checks.
Unknown business agreements still need an agent's review.

Only loopback is bound; authenticate every API with a random 256-bit token and
check Host and Origin to reject cross-site requests and DNS rebinding. Static
assets are allowlisted; arbitrary file contents cannot be read through this API.
Use same-origin CSP, no CORS, no external assets or telemetry. Tokens start in the
URL fragment and remain in tab session storage after URL cleanup. This boundary
does not defend against privileged local malware. Request bodies, project counts,
directory result counts and server-held plan counts are bounded. Decode complete
UTF-8 request bodies, not individual TCP chunks. Plans live in server memory,
expire after 30 minutes, and are single-use on apply/cancel. Fresh preflight
detects changes; existing per-operation locks still protect registration writes.

Auto-assign a free port and print the credentialed URL; browser-opening failure
does not hide the link. Explicit exit closes the wizard server; tab close does not.

Every wizard step exposes a management navigation command, separate from stopping
the wizard. Platform-launched wizards use a server-supplied local parent URL and
an exact-origin/source acknowledgement to focus the original tab without reload
or draft loss. No valid opener means navigating to that authenticated URL. A
standalone wizard starts a local-only management listener on explicit navigation,
without installation, LAN activation or guessed-center creation. Stopping the
wizard does not stop management; the launcher can close both with Ctrl+C.

The web server's ongoing exit status does not represent individual partial
installation results. Validate HTTP boundaries using isolated child processes,
and the actual UI using optional development Playwright/pngjs with real temporary
files, desktop/mobile screenshots, partial-failure retry and preserved rules.

## Naming and legacy data

New storage uses the biz-project registry kind, ~/.config/biz-project/config.json,
BIZ_PROJECT_HOME and biz-project managed markers. Existing centers are recognized
at ~/.biz-project or ~/biz-project; the former is also the suggested location.
Legacy project-records directories, pointer and environment variable are reported
as candidates only, never automatically selected or migrated. Selection
is required when unconfigured discovery finds both a new and a legacy center.
An already configured new center can still be reused without reselecting it.
Explicit selection of a legacy registry is required for each writing command;
preserve its existing
kind, IDs and data instead of silently converting it. Migration or removal needs
separate authorization. Authorized initialization replaces a single old managed
block with new markers, preserving the surrounding bytes. Mixed or malformed
blocks fail before writing. Registered legacy Cursor files are updated in place
while present; only new entries use biz-project.mdc.

## Storage and coordination

Use versioned JSON metadata and Markdown records. A feature has a stable ID,
one owner, a master record and separate update files. Agents submit independent
updates; the owner verifies and consolidates them. An update does not advance
the overall feature status. Explicit update IDs make retries idempotent and
reject different content using the same ID.

Registry and feature creation use an exclusive filesystem lock and atomic file
replacement. Do not automatically remove another process's lock. Each update
is published atomically, with a unique ID and no shared append file. Conflicting
updates must remain visible instead of replacing earlier evidence.

## Product integration and distribution

Keep records independent of the skill installation. A future ai_chat adapter
can consume the documented schema; no ai_chat changes, accounts, cloud sync,
publishing, or private data migration are included in this release. Do not choose
an open-source license or publish a repository on the user's behalf.

## Native Snapshots and Shared Service

The approved 2026-10-12 revision supersedes the unfinished Git prototype.
Record writers have no history capture hooks; only the running management
service observes center documents. Snapshot objects preserve bytes with SHA-256
deduplication and immutable version receipts. Startup enumeration is asynchronous;
file events debounce per path with bounded workers. Slow metadata reconciliation
replaces per-second full-content scans. Empty centers create no snapshot files.
See superpowers/specs/2026-10-12-document-snapshots-design.md and record-format.

Skill ensure-service combines inspection and a constant-cost authenticated
loopback probe. Explicit per-center auto-start consent gates hidden detached
startup; participation and center confirmation precede it. Startup/process leases
and rechecking prevent duplicate instances. Explicit stops suppress restart,
and persisted watcher pause is independent of service startup. Inspect remains
read-only. Private runtime descriptors live beside config, excluded from source
and snapshots. No MCP adapter, Windows service or ai_chat integration is added.

## External Companion Startup

The approved 2026-10-15 extension exposes a project-independent service-control
CLI for external desktop applications. The chosen existing config selects its
confirmed center; consumer enrollment/refusal is irrelevant and unchanged.
ensureCenterService reuses the same authenticated identity check, leases, deadlines,
stop suppression and startup policy as the skill entry point, with loopback-only
startup. Existing network settings and watcher pause are never changed.

Versioned JSON output contains public status only. Health advertises the
service-control-v1 capability; old healthy processes require explicit user restart,
not replacement. Opening the actual owner URL stays internal and requires the
explicit open operation. Closing the caller does not terminate the detached shared
process. The separate 日周记 adapter owns desktop-only settings and asynchronous
native orchestration; there is no database/business dependency in Biz Project.
See references/service-control.md and the dated implementation plan.

The approved 2026-10-19 companion lifecycle extension adds a user-triggered stop
and an authorized next linked start. It authenticates the existing stop endpoint,
waits for runtime release and uses a private stop receipt to distinguish that stop
from a subsequent explicit Biz/Agent stop. Only ensure-companion may resume the
former, with center startup consent still required; ordinary ensure never does.
No user records, enrollment, watcher pause, browser or LAN policy changes result.
See references/service-control.md and references/record-format.md.

## Development Rule Templates

The approved 2026-10-13 extension maintains five-domain rule modules and complete
schemes in an explicitly confirmed independent private library. A summary index
keeps routine lists bounded; details load on demand. Literal parameter rendering
never executes code. Library CAS/journaling and application plans are separate
from center locks, snapshots, registration and participation preferences.

Owner-only routes reuse the platform's Host/Origin and loopback authorization,
but precede records-center resolution so no enrollment is required. Fresh projects
receive deterministic candidates; existing policies require the current Agent's
semantic draft unless the user explicitly chooses overwrite. There is no model
invocation or auto-delegation. The draft must match targets/hashes and protect
record entry blocks and original encoding. Final approval rechecks templates,
discovered guidance (including newly present files), registered context and target
bytes, then saves recovery copies and reports per-file results. Receipts failing
after a rule write are reported as applied with warning, never falsely unchanged.

The UI follows the existing owner workspace: scheme/module tabs, parameter forms,
Markdown editing, archive/restore, side-by-side desktop previews and narrow-screen
stacking. Default values remain visible project parameters. Preview-affecting edits
invalidate approval. Known-file discovery is bounded and not complete tool-context
discovery. No live rule inheritance, batch upgrade or old-template archive is
introduced. See references/rule-templates.md and the dated specification/plan.

## Local management platform

The approved extension adds an operational overview, project/feature records,
explicit edits, immutable updates/history and search using the same center.
`npm start` / start.cmd opens scripts/platform-web.mjs. Installation remains a
separate local-only wizard. No cloud account, ai_chat change or additional live
database is introduced. Detailed API boundaries and acceptance are documented in
superpowers/specs/2026-10-10-local-platform-design.md. Opening the page no
longer uses the access code described there.

The approved workbench revision links compact project and feature lists to a
record pane within the viewport. Each pane scrolls independently. The browser
UI is React and TypeScript compiled ahead of time to web/platform.js; record subtabs update
the record pane and keep the top bar, sidebar and list panes mounted. Choosing a
project or feature updates the dependent panes without disabling or marking the
workspace shell busy. The record pane returns to the top when its document, tab
or editor changes. The local owner can rename a project's display name, stop
managing it without deleting its records, or delete those records. Stopping
removes only the enrollment hook and hides the project until the same directory
is resumed. Deletion asks whether to remove development-rule blocks and leaves
the source tree in place. These actions are unavailable to LAN clients.
Desktop statistics stay in one line. Narrow screens drill down through one
pane at a time with explicit back controls. Record edits reuse the existing
revision/draft behavior, and cross-project search loads the result's project
before showing its feature. No data schema, installation, or LAN authority
changes are made by this revision. The Node server still uses built-in modules
only and serves the compiled file from the existing allowlist. Changing web/src
requires npm run build:web; start.cmd does not run the compiler.

The 2026-10-19 feature-list extension adds status/time groups without replacing
the three panes. Default status groups prioritize developing/blocked and retain
unknown statuses; filtered counts and collapsible headers do not edit records.
Time groups sort newest first, using local today/Monday week/earlier buckets;
future and unknown times remain explicit. The summary adds optional created_at
from existing metadata, never inferred from filesystem creation/modification.
updated_at retains the existing master-document/metadata mtime semantics.
Browser-origin preferences store only view mode and time field, validate on read
and tolerate blocked storage. Memoized in-memory grouping performs no API calls.
Time mode refreshes at local midnight or visibility/focus, not by polling files.
View/filter changes reset only the feature scroll context, not the right editor
or selection. No record format, lifecycle state, snapshot or LAN policy changes.

The approved Markdown view uses a locally bundled, pinned Marked lexer in the
browser, not a Node runtime dependency or CDN. The shared renderer builds DOM
nodes from recognized tokens; record HTML remains text and never reaches HTML
insertion. Entity decoding first escapes literal angle brackets. Links allow
only absolute HTTP/HTTPS/mailto and scoped heading fragments; fragments scroll
inside their document without changing the application's credential hash.
Images remain labels/links without automatic network requests. Local/relative
file navigation is not an arbitrary file-serving API. Headings, tables, task
lists, quotes and code blocks share the reading styles across agreements,
features, updates and history. Source/preview toggles operate on the existing
in-memory draft, and saves continue to send its original Markdown and revision.

Loopback opens the management page directly. A private LAN address does too, and
it stays a restricted client: it can edit records, and it cannot install, change
network access, or use owner credentials copied from the loopback URL. The
management command listens on the private LAN unless --no-lan is set. The
installer-launched management process stays loopback-only. Turning LAN off closes
that listener. The service does not configure firewalls or port forwarding. HTTP
is unencrypted and limited to trusted private LAN use; explicit cert/key options
use native HTTPS. This is one local owner plus trusted record editors, not a
multi-user account system.

Edits have byte-based revisions and center locks, retaining unknown fields and
unchanged unknown statuses. Multi-file edits journal old/new bytes and roll back
only their own unchanged writes; incomplete recovery blocks further writes.
Feature creation is staged in a hidden directory and atomically renamed, so a
failed creation does not expose a partial feature. The UI never executes record
HTML and retains drafts during a revision conflict or revoked session. Recovery
drafts are keyed by both project and feature. Browser state is in-memory and not
a durable draft store. See [record format](../references/record-format.md) for the
additive audit format and limits.
