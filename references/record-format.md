# Record Format v1

Read this reference when creating records, changing metadata or preparing an
adapter such as a future ai_chat integration. JSON field names are stable;
human-readable Markdown uses the user's preferred language.

New storage, user configuration, environment variables and invocation markers use
biz-project. Legacy project-records metadata remains readable after explicit
selection; changing the skill does not migrate or delete existing private data.

## Directories

```text
records-root/
  registry.json
  projects/
    project-uuid/
      project.json
      README.md
      features/
        feature-id/
          feature.json
          README.md
          updates/
            checkpoint-id.json
```

The user pointer ~/.config/biz-project/config.json contains
schema_version 1 and an absolute records_root. Both the pointer and registry
contain local configuration; they are private data, not distributable fixtures.
--config can scope a different pointer. BIZ_PROJECT_HOME overrides discovery
for the current environment; see initialization.md for pointer conflict handling.

The sibling `project-preferences.json` is shared local private configuration,
outside projects, the skill source and the records center. It contains kind
`biz-project-preferences`, schema_version 1 and a projects object keyed by SHA-256
of the project identity. Entries contain identity, canonical absolute paths,
decision (`yes`/`no`) and updated_at. Identity/path matches share one decision;
an explicit decision consolidates matching aliases. Unknown fields are preserved.
Refusal takes precedence over conflicting matching entries. Repeating the same
decision is byte-idempotent; writes use a local lock and atomic replacement.
Inspection adds participation.status (`unanswered`, `accepted`, `declined` or
`registered`), preferences_file, skip_recording and project_confirmation_required.
These fields do not change the central v1 registry or feature schema. A declined
inspection returns no center/rule discovery and no confirmation prompts. Center
discovery for the management UI is separate from enrolling its source project.

New registry.json contains kind `biz-project`, schema_version 1 and projects,
an object keyed by project UUID. Each registration stores name, identity, paths,
created_at and optional hosts. hosts maps tool names (codex, cursor, generic) to
objects containing rules_file and rules_selection (`default` or `explicit`). Each
tool remembers its entry point without replacing another tool's selection.
The legacy top-level rules_file/rules_selection remain the Codex fallback and
are mirrored when Codex initializes. Cursor does not change them. Older v1 records
without hosts remain readable; these are additive v1 fields, not a new project
identity or a migration of feature data. Git identity
uses the canonical shared Git directory; non-Git identity uses the project path.
Paths are machine-specific, not inferred account or repository identities.

Legacy registry kind `project-records` is accepted for reading, but does not
authorize automatic reuse. A writing command must explicitly pass its confirmed
--records-root. Keep the legacy kind and IDs unchanged unless a separate migration
is authorized. Old pointer files and PROJECT_RECORDS_HOME are only reported as
legacy candidates; no new writes use those names by default.

## Project profile

project.json contains schema_version, id, name, development_branch, release_branch,
release_criterion, verification_commands, delegation_policy, legacy_records,
migration_status and created_at. Unknown branch/criterion values are null.
migration_status starts as `not-migrated`; an agent may update it after a scoped,
verified migration. README.md holds the fuller project agreements and overview.

Agent-editable additional fields may capture feature branch naming, tracking
requirements and relevant exemptions. Preserve unknown fields on subsequent
initialization. Do not put API keys, passwords or other secrets in project notes.

## Feature metadata and master record

feature.json contains schema_version 1, id, project_id, title, owner, status and
created_at. Feature IDs are 1-64 lowercase letters, digits or hyphens with an
alphanumeric first character; generated IDs are UUIDs. Creation starts at planned.
The owner updates status based on evidence and keeps it consistent with README.md.
Platform feature summaries also expose the existing optional string created_at;
missing/invalid creation time is not synthesized from filesystem timestamps.
Summary updated_at retains master README/feature.json modification-time semantics,
not release evidence or a promise of the latest independent update. Browser view
preferences live only in browser storage and never alter this record schema.

The master Markdown record follows [feature-template.md](../assets/feature-template.md):
scope, decisions, work allocation, behavior, verification, synchronization/release
evidence and next steps. Keep references to incorporated update IDs. Existing
feature records are updated rather than cloned for each chat or worktree.

## Independent updates

Each update JSON contains schema_version 1, id, project_id, feature_id, agent,
content (original Markdown) and created_at (UTC ISO 8601). IDs follow the same
path-safe constraints as feature IDs. Labels identify participants, not credentials.

The content follows [update-template.md](../assets/update-template.md). Record
observed results separately from plans and unverified statements. Include an
observation timestamp for Git/deployment facts. Repeated delivery of the same
explicit update ID and content returns the existing file; different content with
that ID is rejected. Distinct updates are never appended to a shared file.

Only complete .json update files are consumable. Dot-prefixed temporary files and
.write.lock are operational artifacts. Atomic publishing requires a local
filesystem supporting hard links, such as NTFS; unsupported filesystems report
an error rather than silently using an unsafe overwrite.

## Browser edits and audit history

The local platform keeps these same v1 files. It preserves unknown metadata and
existing unknown status values when unchanged; choosing a supported status is an
explicit owner edit, not release verification. Web updates use the independent
update format above with an optional source label (`browser-local`/`browser-lan`).

Project overview and feature edits add a `history/` directory below that project
or feature. Complete `<uuid>.json` audit records contain id, created_at, actor,
kind, before, after and files. Each files entry has a center-relative path and
base64 original/new bytes, including BOM/newlines. This audit format is additive;
the existing CLI does not require or rewrite it. The first platform UI shows
feature audit history; project overview audits are retained on disk.

Feature saves hash metadata/document bytes for a revision, obtain the existing
center lock, check the revision and write a hidden `.uuid.pending` journal before
changing files. Successful completion renames it into a complete audit entry.
Failure restores only writes owned by this operation, and only while the current
bytes still match its written bytes. If recovery cannot finish, keep the journal
and block further writes to that record. Never discard it or another owner's
lock automatically. A local owner must inspect current, before and after values
and reconcile them before removing the pending evidence. No automatic crash
recovery or guarantee against writers that ignore the shared lock is claimed.

## Native Document Snapshots

Snapshot storage is separate from web edit audits. Only the running management
service captures it; registration, CLI writes and browser saves have no snapshot
hook and no Git dependency. The service scans its confirmed center on actual
startup, then handles stable per-document events. Markdown beneath registered
project directories, project.json, feature.json and updates/*.json are included.
registry.json triggers discovery but is not a document snapshot. Audit directories,
hidden/temporary paths, SKILL.md/AGENTS.md, symlinks, credentials, config and all source repositories
are excluded. Extra Markdown under a project's record directory is supported.

`.biz-project-history/objects/<sha256>` retains original bytes. Immutable
`documents/<sha256-relative-path>/<16-digit-sequence>-<uuid>.json` receipts have
schema_version=2, id, file, hash, deleted, size, created_at, source and observation.
Objects are published before receipts; equal consecutive content is deduplicated.
Deletion uses hash=null and deleted=true without deleting earlier objects. Returning
to old content creates another receipt but reuses its content object. No automatic
retention deletion, diff, restoration, branch, push or historical backfill exists.

Per-document limit is 2 MiB, center enumeration 10,000 documents/50,000 entries,
two incremental workers and 10,000 queued paths. History reads return at most 100
receipts/200 documents per page; reaching 10,000 versions pauses new versions for
that document with a visible warning, rather than pruning older ones. Initial
scans read current bytes asynchronously; 15-minute metadata reconciliation normally
rereads only changed files, with 60-second fallback if native watching fails.
Failed snapshots leave originals intact, expose a warning, and retry with bounded
backoff. Retry captures current stable content, not lost intermediate edits.
watcher.json stores schema_version=2 and explicit paused. Pauses survive restart;
resume reconciles current documents. Snapshot storage never monitors itself.

## Private service stop receipts

The 2026-10-19 companion-stop extension keeps private policy.json at schema_version
1 with optional stop_id (UUID) and companion_resume (boolean). Missing fields mean
there is no right to resume a companion stop. They contain no credentials and are
outside the records center, snapshots and consumer database. Existing v1 policies
are read without migration; writers preserve unknown fields.

Every explicit stop creates a new stop_id and clears companion_resume. A confirmed
companion shutdown sets companion_resume=true only while the same stop_id is still
current. An authorized linked startup consumes it only with center auto_start=true;
ordinary Agent startup honors stopped. Manual Biz startup clears the receipt. An
interrupted stop remains stopped without automatic recovery: inspect and explicitly
start Biz rather than deleting policy/runtime files. Old v1 readers ignore these
additive fields, and old normal ensure continues to honor stopped.

## Future product integration

ai_chat may later import or consume these project/feature/update identities and
Markdown bodies. This release has no ai_chat adapter, database coupling or
automatic bidirectional synchronization. Treat schema changes as versioned data
changes and document migration before introducing them.
