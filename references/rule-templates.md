# Development Rule Templates v1

This feature is independent from records-center enrollment, document templates,
directory skeletons and snapshot capture. Use only after the user requests rule
authoring, import or review. Never grant delegation, release or recording consent.

## Library

The local owner explicitly chooses an absolute library root outside source,
business projects, records centers and configuration pointers. Opening the page
creates nothing. The private sibling of the selected config, rules-library.json,
contains kind=biz-project-rules-pointer, schema_version=1 and root. A broken
records-center config does not automatically disable this separate library.
Pointer/config paths cannot be linked, stored inside source or a known center,
or use the same file for both the record config and library pointer.

```text
rules-library/
  library.json
  modules/<module-id>.json
  schemes/<scheme-id>.json
  applications/<project-path-hash>.json
  applications/<project-path-hash>/backups/<uuid>.bin
```

library.json has kind=biz-project-rules-library, schema_version=1, modules and
schemes objects. Summary entries contain id, title, revision, archived, SHA-256
hash and module domain. Lists read summaries only, 50 per page. Full content is
loaded for editing or rendering; hashes must agree with the index.

Modules use kind=biz-project-rule-module, schema_version=1, id, title, domain,
body, variables, revision and archived. Domains are lifecycle, development,
verification, release and collaboration. Variable entries have name, label and
boolean required; names match [a-z][a-z0-9_]{0,63}. Body placeholders are exactly
{{name}}. No expression evaluation, execution or recursive substitution occurs.
Same-name declarations across modules must agree. Record invocation markers
are prohibited in module bodies.

Schemes use kind=biz-project-rule-scheme, schema_version=1, id, title, modules
(domain to module ID), defaults (parameter name to string), revision and archived.
The first four domains are required, collaboration optional, one module each.
Edits require the current revision; new IDs require revision=0. The service
increments revisions. Archived modules/schemes cannot create application plans.
Copy is a new ID, not a shared mutable alias. Restore is an explicit new revision.
Referenced modules resolve at preview time; no live inheritance reaches projects.

Limits: 200 modules, 100 schemes, 64 KiB module bodies, 32 parameters per module,
320 KiB rendered rules, 512 KiB target files, 1 MiB HTTP bodies. Writes use an
independent library lock and atomic replacements. An unfinished .pending.json
blocks further library changes for manual inspection; never delete it blindly.
Revisions track the current version, not an archive of all prior template bodies.

## Application Contract

Owner-only /api/rules routes are handled before records-center resolution, with
the existing loopback credential, Host and Origin checks. LAN credentials cannot
read templates, select paths or operate imports. GET state, list, modules/:id and
schemes/:id are read-only. POST library requires confirmed=true. POST starter
explicitly creates a fresh editable generic scheme; confirmation alone does not.
POST modules/schemes saves revision-checked edits. There is no unattended CLI
import shortcut in this version.

An old running server can serve an updated main script without recognizing the
new rules module/API. Missing modules are guarded in both navigation and rendering;
an unsupported state API shows a restart message instead of library creation.
The rest of navigation remains enabled. After an explicitly requested service
restart, refresh the browser to load compatible assets; do not infer library
absence or create another library from a missing endpoint.

POST preview receives project (existing absolute directory), scheme_id, hosts
(codex/cursor), params (all explicitly reviewed strings), and mode (auto or
overwrite). Overwrite additionally requires overwrite_confirmed=true. Known
existing project policies or meaningful registered agreements cause Agent merge
in auto mode, including when a selected tool's destination does not exist.
Scheme defaults populate the visible form, not hidden server-side fallbacks.

Known root rules, bounded .cursor/rules MDC files, parent AGENTS guidance and
readable tool-specific global context are included as review materials. Related
registered profile/overview files are read-only context. Cursor User Rules and
unknown paths must be supplemented by the current Agent; discovery is not a
claim of complete policy comprehension. Only root AGENTS.md/AGENTS.override.md
are supported Codex destinations. Default Cursor output is a separate
.cursor/rules/biz-project-development.mdc with alwaysApply=true. Existing
inactive/ambiguous MDC metadata is rejected, not silently activated.

Plans are private server-held snapshots, at most 12 and valid for 30 minutes.
They freeze template/module revisions, rendered text, confirmed parameters,
project-directory identity, discovered guidance and target fingerprints. New or
changed applicable guidance also invalidates approval. Browser copies cannot
mutate the server plan. POST cancel discards a plan; apply consumes it once.
Service restart loses unapplied plans. Re-preview rather than restoring approval.

## Current-Agent Merge

The owner copies/downloads the exported task and gives it to the current Agent.
The platform never calls an Agent, model, API or delegation tool. The Agent reads
the task and actual active context, identifies conflicting lifecycle/release,
development, verification and collaboration requirements, and returns:

```json
{
  "summary": "Actual analysis and conflict decisions",
  "unresolved": [],
  "files": [
    {
      "path": "AGENTS.md",
      "base_hash": "original fingerprint from the plan, or null for absent file",
      "content": "Complete reviewed file text with the required managed block",
      "reason": "Actual preservation and replacement rationale for this file"
    }
  ]
}
```

POST merge receives plan_id and draft. Targets/hashes must exactly match the
plan; summary and each reason must be real explanations, not example text.
Unresolved conflicts block application. Preserve original records invocation
blocks byte-for-byte, BOM and CRLF. The managed development section uses
<!-- biz-project:rules:start --> and <!-- biz-project:rules:end -->, distinct
from the protected enrollment hook. Do not write files while composing a draft.
Semantic validity is the Agent/user's responsibility; structural checks alone
cannot prove that a draft preserves all intended business requirements.

POST apply receives only plan_id and approved=true after the owner's review.
It rechecks frozen inputs, takes the library lock, saves original bytes privately
and writes only approved targets. Application receipts record path hash, scheme,
module_revisions, params, mode, summary, applied_at and recovery_file. Project
participation preferences and records profiles are never changed. No Git,
deployment, verification-command execution or snapshot hook runs.

Results report applied, unchanged or failed per file. Partial success remains;
retry uses a fresh preview, not automatic rollback over later manual edits. If a
file was written but its receipt could not be saved, status remains applied with
a warning and any recovery path, and overall ok=false. Keep recovery evidence,
inspect the library and file before proceeding. Existing unchanged content is
not rewritten; the prior receipt may therefore describe its earlier application.

Batch upgrades, custom Codex destinations, historical template rollback,
automatic semantic merge and independent Agent compliance tests are out of scope.
