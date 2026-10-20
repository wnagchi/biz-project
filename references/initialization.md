# First-Use Initialization

Read this reference when a project has no registration, its profile/overview is missing,
or the active guidance file lacks a valid biz-project invocation hook.

## Project participation

Run read-only inspect first. `skip_recording=true` means the user declined:
do not ask again, initialize, add hooks, create feature records or submit updates.
Continue the actual development task without this recording workflow. The helper
checks refusal before center/guidance discovery, including generic host selection.
On Windows, refusal path comparisons resolve existing 8.3/long aliases before
case folding, so creating Git metadata does not bypass a saved decision. Stored
identities and paths are not rewritten merely to compare aliases.
It cannot stop a host from initially loading the skill; it prevents further
recording actions. Never disable the skill globally to exclude one project.

For an unregistered project with `project_confirmation_required=true`, ask:
"Should this project join Biz Project's centralized records?" Wait for explicit
yes/no. Calling the skill, generic task approval, or selecting a center is not
enrollment consent. Before the answer, make no setup or record writes.

No: persist only the local decision, without creating anything in the project or
records center:

```text
node "<skill-directory>/scripts/biz-project.mjs" set-participation --project "<project-directory>" --decision no
```

Yes: after center confirmation, use `init --join-confirmed`. Alternatively,
`set-participation --decision yes` stores the explicit answer without initializing.
The flag cannot override a prior refusal. Only an explicit user request to join a
declined project allows `set-participation --decision yes`, followed by inspect/init.
Already registered projects, including partial registrations, need no repeat
enrollment question when repairing files or adding another host. Existing records
are never deleted by a decision change.

Decisions live in `project-preferences.json` beside the user config pointer,
normally ~/.config/biz-project/. `--config` scopes both pointer and preferences;
pass it consistently on later calls. Codex/Cursor/generic on the same profile
share the decision. Git worktrees share Git identity; canonical paths also match
a non-Git directory later becoming Git. Moving/cloning projects or switching
machines/config profiles does not automatically carry decisions across them.
Malformed preferences fail closed and remain untouched. See record-format.md.

In batch installers, actively selecting new projects and approving the final
preview supplies enrollment consent; browsing, checking status, canceling or
launching a wizard does not. Declined projects are blocked, not silently restored;
explicitly restore only on the user's request. Preference changes after preview
invalidate the plan before installation writes.

## Terminal installer

The default install.cmd / npm run setup entry now opens the local web wizard
described below. The original terminal flow remains available through
install-terminal.cmd / npm run setup:terminal / scripts/setup.mjs.

When the user requests installation and batch project onboarding, run the
interactive `install-terminal.cmd` on Windows, or `node "<skill-directory>/scripts/setup.mjs"`.
It requires Node.js 20+ with no third-party dependencies. `--help` is read-only;
`--config PATH` scopes a separate pointer, and `--records-root PATH` supplies a
candidate, not automatic write authorization. There is no unattended yes flag.

The user selects Codex, Cursor or both, enters project directories one per line,
and selects the center. An established, recognized center is displayed and may
be explicitly reused with Enter. Missing or legacy centers require entering a
path; there is no fallback. Do not type a guessed center or INSTALL for the user.
The terminal previews the shared skill link, registry, config pointer and each
selected project/tool rule file. Only the final INSTALL approval applies changes.
Cancel, EOF or Ctrl+C before that approval creates no files.

The shared link at ~/.agents/skills/biz-project points to the source directory
(an NTFS junction on Windows). Do not move the source afterward. Another existing
installation is never replaced. The center must also stay outside the pointer
and installation locations. The installer does not install or detect the tools.
It reuses inspect/init and the existing record schema; project IDs and records
are shared, while host invocation guidance remains separate.

Completed entries are skipped; missing entries are repaired. Unknown profiles
still require the agreement review below. Inactive/complex Cursor metadata and
other per-entry failures are reported without rewriting that guidance. A partial
failure preserves completed entries and returns exit code 1. Retry after fixing
the reported issue. There is no destructive rollback, lock removal, automatic
legacy migration or publication. Changed relevant files after preview require a
new preview. This is not a lock over all project files during installation.

Generated hooks and file-level integration are tested; real tool UI discovery
and agent compliance are separate verification. For other hosts or custom rule
selection, use the explicit manual flow below, not the batch tool selector.

## Local web wizard

install.cmd and npm run setup start scripts/setup-web.mjs and open a browser.
Node 20+, built-ins only; local static Lucide assets include their license.
--no-open suppresses browser opening; --port 0 selects an available port;
--config PATH explicitly scopes a separate pointer. There is no automatic
records root argument or unattended confirmation flag in the web launcher.

The user actively chooses a discovered center or browses to another directory.
When the current configuration already points at a confirmed biz-project center,
that center starts selected; legacy centers and centers that still require
confirmation do not. A new directory name may be entered under a selected parent,
without creating it yet. Explicit center confirmation precedes project selection. Parent directory
browsing lists immediate child directories only, with no default project selection
or recursive disk scan. Select multiple projects, search/select all, add individual
directories, and choose Codex/Cursor globally or per project. Status checks use
read-only previews. Back navigation preserves selections and cancels old previews.

The final table previews shared installation, config, registry and rule paths.
The user checks confirmation and clicks install. Never perform those clicks on
their behalf merely because they asked to launch the installer. The server holds
the complete plan, uses fresh preflight, consumes the plan on apply/cancel, and
expires it after 30 minutes. A stale preview requires a new preview. Successes
survive partial failure; failed-only retry selects just those project/tool entries
and requires another preview/approval. Web results report failures without exiting
the running server. No schema changes, migrations, profile-policy guesses or
business-code changes are added.

The service binds only 127.0.0.1 and validates Host, Origin and a random session
credential. No CORS is enabled. Credentials arrive in the launcher URL fragment,
are retained in the tab session, then removed from the visible URL. Do not share
the launcher URL. This is not isolation from malicious programs already running
with the user's local privileges. The exit button shuts down the server; closing
the browser tab alone does not. Terminal Ctrl+C also stops it.

The header always offers returning to project management (or opening it for a
standalone wizard). A platform-launched wizard remembers a trusted local parent
URL in server options. An exact-origin/source postMessage handshake focuses the
original management tab and closes the wizard without reloading the original,
preserving drafts and selections. Missing/closed/navigated opener falls back to
the authenticated parent URL. Standalone launch starts a local-only management
listener only on this explicit action; no installation or default center creation.
Return is separate from stop: stopping the wizard does not stop management.

Browser acceptance uses temporary records/projects only and desktop/mobile
screenshots. This does not verify Cursor skill discovery or independent agents'
compliance. New project profiles still require review in section 4.

## 1. Inspect before writing

Run `inspect --project PATH --host codex` or `--host cursor`, matching the actual
active tool. It creates no files. Do not guess the host from .cursor/ or AGENTS
files: both tools may be used in the same project. Read the applicable project
guidance, including existing AGENTS files, CLAUDE.md, GEMINI.md, .cursorrules,
Copilot instructions and relevant .cursor/rules or .claude/rules files. Inspection
lists common locations; also follow custom rule paths already supplied by the
host or user. Nested directory rules still apply to work under those directories.

Read applicable global guidance before selecting the center. Inspection lists
Codex global AGENTS files under CODEX_HOME or ~/.codex only for `--host codex`.
Cursor User Rules are settings-based; read those supplied by the active host or
the user. The helper does not scrape settings or substitute Codex global rules.
Other hosts' global guidance must be read from their actual configured locations.
If trusted existing guidance
names a custom center, inspect it with --records-root rather than inventing a new
directory. If guidance disagrees with the configured center, resolve the conflict
using current user instructions; do not silently split the project's history.

## 2. Resolve the global records directory

The helper uses this order:

1. Explicit --records-root PATH.
2. BIZ_PROJECT_HOME.
3. records_root in --config PATH, or ~/.config/biz-project/config.json.
4. An existing recognized center at ~/.biz-project or ~/biz-project.

A new center has a valid registry.json with kind `biz-project` and
schema_version 1. Invalid metadata is an error, not permission to create another
center. Multiple discovered centers require the user's selection. Legacy
project-records directories, ~/.config/project-records/config.json and
PROJECT_RECORDS_HOME are listed in legacy_records_centers, not selected. Explicit
read-only inspection may view a legacy center before asking what to do with it.
Without a configured selection, a new-named center alongside a different legacy
center also requires the user's choice; the new name is not permission to decide.

When records_root_confirmation_required is true, ask the user which center to
use and wait for their explicit path confirmation. ~/.biz-project appears only
as suggested_records_root, not a selected path. Invoking the skill, saying
"continue", an example path or a preferred default does not confirm a location.
Before the answer, create no records directory, pointer, registration, profile or
project rule hook. Do not put a guessed path in --records-root to bypass the gate.

After the user confirms, run init with --records-root and that exact path. The
CLI refuses unselected centers and refuses creation from a missing configured
or environment-selected center without this explicit argument. A legacy registry
also requires explicit --records-root for each writing command; existing kind,
records and IDs are preserved. Do not migrate or remove legacy data merely to
rename it. The source repository is not a data center. Neither the center nor
the skill source may contain the other; records must also stay outside the managed
code project. Do not move the chosen center on subsequent runs.

An existing pointer is preserved. When an explicit root or environment setting
disagrees with it, initialization rejects the mismatch: use a separately scoped
--config or deliberately update the pointer within the authorized task.

## 3. Register and install invocation guidance

First creation, only after explicit enrollment and confirmation of the center path:

```text
node "<skill-directory>/scripts/biz-project.mjs" init --project "<project-directory>" --host "<codex-or-cursor>" --join-confirmed --records-root "<user-confirmed-directory>"
```

Later project registration or entry repair with an existing biz-project center:

New unregistered projects still require an explicit yes: add `--join-confirmed`
only after that answer, or first persist `set-participation --decision yes`.
The command below is for an already registered/accepted project.

```text
node "<skill-directory>/scripts/biz-project.mjs" init --project "<project-directory>" --host "<codex-or-cursor>"
```

The project is identified by the shared Git directory, so linked worktrees use
one registration. A non-Git project is identified by its resolved directory.
The registry associates a UUID with project paths and separate host entry points.
The project's records/profile are shared. Switching tools registers a new hook,
not a second project. Inspection reports records_initialized separately from
initialized, which also requires the selected host's usable hook.

For Codex, update AGENTS.override.md if it exists; otherwise use AGENTS.md, creating
it only when needed. An unrelated host's rule file is not an effective Codex hook.
Other existing guidance remains in place and must be read; do not duplicate it.

For a new Cursor entry, create `.cursor/rules/biz-project.mdc` with `alwaysApply: true`.
Do not modify other Cursor rules or treat AGENTS.override.md as a Cursor entry.
An explicit root AGENTS.md is supported when the user prefers a shared entry:

```text
node "<skill-directory>/scripts/biz-project.mjs" init --project "<project-directory>" --host cursor --rules-file "AGENTS.md"
```

The managed block contains both Codex and Cursor invocation names so sharing
AGENTS.md does not invalidate either hook. Cursor uses `/biz-project`;
Codex uses `$biz-project`. This assumes the skill is installed and discoverable.
Initialization installs guidance, not the skill itself.

Existing Cursor MDC frontmatter is preserved. The helper supports flat scalar
description/globs/alwaysApply fields; alwaysApply must be the literal boolean true.
Complex YAML, inactive metadata, missing frontmatter in a nonempty MDC, and
duplicate fields require review or another dedicated rule file. Initialization
does not rewrite a user's chosen activation mode. A .md file in .cursor/rules
is not a supported Cursor entry.

For another host, select the rule file it actually loads using the generic mode:

```text
node "<skill-directory>/scripts/biz-project.mjs" init --project "<project-directory>" --host generic --rules-file "CLAUDE.md"
```

This mode does not promise native tool loading or verified tool-specific syntax.
An explicit rule-file selection is remembered separately per host. Omitted --host
defaults to codex for compatibility. Old rules_file/rules_selection registrations
remain the Codex fallback until a Codex host entry is saved. Cursor and generic
initialization do not replace that fallback. A file must remain inside the
project, including through symlinks. The helper adds or refreshes one managed
block bounded by `<!-- biz-project:start -->` and
`<!-- biz-project:end -->`. It preserves content outside that block, UTF-8
BOM and existing line endings. Malformed, duplicate or mixed old/new blocks stop
the operation before writing.
Non-UTF-8 files require a deliberate conversion or another active rule file.

An old project-records marker or invocation makes the selected hook incomplete;
authorized init replaces that single block with biz-project markers and calls,
keeping IDs and records. Existing registry kind is not automatically converted.
A registered legacy Cursor default .cursor/rules/project-records.mdc is refreshed
in place while it exists, rather than adding a second active rule. Explicit
rule-file selections are still honored. New entries use biz-project.mdc.

If the project already has equivalent unmanaged invocation instructions, inspect
their meaning first. Consolidate them into the managed block only within the
authorized initialization work; preserve surrounding project agreements.

## 4. Complete the project profile

Read the project's existing agreements and fill the central project.json and
README.md with observed values:

- Development branch and allowed feature branch naming.
- Release branch or deployment method and exact release criterion.
- Applicable validation commands and limitations.
- Delegation permissions, required model constraints and ownership conventions.
- Business requirements such as popup tracking and its failure isolation.
- Existing record locations, publishing exclusions and migration status.

Unknown values remain null or are explicitly described as unknown. Never infer
production policy from the current branch alone. The CLI returns
profile_review_required because these agreements need the agent's review, even
when registration and hook installation already succeeded.

Initialization does not move, delete or import previous notes. If existing rules
still require local records, honor them until an authorized migration updates
that requirement. For migration, inventory and read existing documents, preserve
history and links, consolidate under stable feature IDs, update relevant rule
references, verify the copied records, then record migration status. Do not
delete originals or rewrite release states without authorization and evidence.

## 5. Verify and resume

Run `inspect` again with the same --host and confirm the registration, profile and active hook are
present. Re-running initialization must reuse the ID and keep reviewed profile
data. It may repair missing guidance. If a .write.lock exists, inspect its owner
and retry after that operation finishes; do not automatically remove it.

If interrupted, inspect the partial registration and retry with the same center
and config. Report remaining work accurately; do not claim old records migrated
because init returned initialized=true. Project moves or separately cloned
repositories require reviewed identity rebinding; this version does not infer
cross-machine identity from repository URLs.

## Shared Service Lifecycle

For normal recording work, ensure-service combines inspect output with service
state in one bounded invocation. For read-only work keep inspect. Unregistered,
declined, incomplete or unconfirmed projects do not start processes. Once setup
is complete, ensure-service uses the same --host/--config/confirmed root.

Auto-start is a separate explicit preference, never implied by joining a project.
The local owner can choose it in platform settings or after answering yes/no:

```text
node "<skill-directory>/scripts/biz-project.mjs" set-service-policy --project "<project-directory>" --host "<codex-or-cursor>" --decision yes
node "<skill-directory>/scripts/biz-project.mjs" ensure-service --project "<project-directory>" --host "<codex-or-cursor>"
```

Use decision no for refusal. Policies and private runtime identity/credentials
live under services/<center-path-hash>/ beside the chosen config pointer, not in
the project, source or document snapshots. Different config profiles are separate
startup-policy scopes; the center watcher still refuses a second live owner.
Do not publish these files. A descriptor is verified by a 350-ms authenticated
loopback probe, including instance ID, center and process identity. Startup is
bounded at five seconds, with a 30-second failure cooldown; full scan is not a
readiness requirement. A stale live PID is not terminated or assumed owned.

```text
node "<skill-directory>/scripts/biz-project.mjs" service-status --project "<project-directory>"
node "<skill-directory>/scripts/biz-project.mjs" stop-service --project "<project-directory>"
```

Explicit stop records suppression. Manual start.cmd / platform-web.mjs reuses an
existing healthy service or clears stop suppression and starts it; it does not
change the auto-start preference. Automatic startup is hidden/detached and never
opens the browser. It is not Windows service installation or boot-time startup.
Verified dead service/watcher leases can be recovered; live/unknown owners and
document .write.lock or unfinished recovery journals are never removed.
