# Agent Collaboration and Feature Synchronization

Read this reference when several agents work on one feature, work transfers
between chats, or code is integrated into another branch or release.

## Start and ownership

Use one project ID and one feature ID for the same work. Inspect the registry and
read the current feature before claiming an assignment. An existing chat is not
shared memory: each agent reads the current records at startup and before a
handoff, integration or state change. Codex and Cursor use the same records center
and project/feature IDs. Each uses its own --host selection on every helper command;
the --agent option is an update author's label, not a host selector. A new tool
may need first-use hook initialization even when the project already has records.

Designate one owner for each feature's feature.json and README.md. Record each
agent's assigned scope, paths, interfaces, dependencies and branch/worktree.
Changing assignment boundaries requires updating the record before the affected
agents proceed. Do not spawn agents or message other chats without authorization
under the project's current rules.

Before starting a new feature, look for an existing record of the same scope.
Create only when it is new:

```text
node "<skill-directory>/scripts/biz-project.mjs" create-feature --project "<project-directory>" --host "<codex-or-cursor>" --title "<feature-title>" --owner "<owner-label>"
```

The owner label documents responsibility; it is not authentication. Filesystem
permissions and agent cooperation still determine who can edit records.

## Submit and consolidate updates

Execution agents publish independent update files. Fill the
[update template](../assets/update-template.md) and submit its Markdown content:

```text
node "<skill-directory>/scripts/biz-project.mjs" add-update --project "<project-directory>" --host "<codex-or-cursor>" --feature "<feature-id>" --agent "<agent-label>" --body-file "<update-file>" --update-id "<stable-checkpoint-id>"
```

Reuse the checkpoint ID only when retrying the same content. A changed result
gets a new ID and explains which earlier observation it supersedes. The helper
publishes completed JSON files without overwriting others; simultaneous updates
have separate paths. It never advances the feature's overall status.

The owner reads new updates, checks the actual changes and validation results,
and consolidates accepted results into the master record. Preserve source update
IDs so the summary can be traced back. Name conflicts, missing evidence or stale
assumptions explicitly. A contributor's statement that tests passed is not a
substitute for the owner's required verification.

Only the owner edits the master record, using its latest content. The helper's
lock protects registry and creation operations; it does not lock arbitrary
manual edits to Markdown. When ownership is contested, resolve ownership before
editing. Independent updates remain available during that resolution.

## Code synchronization

Records describe synchronization; the skill does not grant permission to execute
it. Follow the project's allowed branches and current authorization for merges,
cherry-picks, commits and pushes.

Before an authorized integration, inspect source-vs-target committed changes and
uncommitted work. Follow project requirements for confirming what to include.
Do not silently incorporate, discard or move unrelated uncommitted edits.

Record the source branch and commit, target branch, operation, resulting target
commit, verification result and observation time. For cherry-picks, retain both
original and resulting commit IDs. Verify the relevant change actually landed;
different commit IDs alone do not imply missing functionality. Record pending
conflicts or incomplete verification rather than marking synchronization done.

## Status and release

The baseline status vocabulary is planned, developing, implemented, verified,
integrated and released. Blockers and deployment failures are described alongside
the last evidenced state. Status can move backward after a revert or regression;
record the reason and evidence rather than hiding prior releases.

Use the registered project's release criterion. Some projects consider merging
into their release branch a publication; others require deployment or packaging
evidence. Do not generalize one project's criterion to all projects.

Use fresh local Git checks and the authorized remote or deployment checks.
Remote-tracking refs only describe their last observed state. Record whether and
when they were refreshed; if that evidence is unavailable, distinguish local
presence from unknown remote/release presence. Do not perform fetch or deployment
just because another agent asserted a release.

Update the master record and project overview in the same task as the integration
or publication. A single worker completing its assignment cannot mark the whole
feature released.
