# Companion Service Control v1

## Local Connection Discovery v1

An actual confirmed-center platform start publishes a credential-free startup
profile at `~/.config/biz-project/connections/<id>.json`. The profile survives stop;
runtime.json remains ephemeral and private. No profile is created by status,
opening a configuration page, or selecting an unconfirmed center. Successful
initialization also registers startup metadata in config-parent/connections,
without replacing existing runtime metadata. For the standard config this is
the same user discovery directory. The launcher
uses the actual `process.execPath`, source and explicitly selected config/center.
Publishing failure warns without stopping the otherwise usable platform.

Profile fields: kind=biz-project-connection, protocol_version=1, id, capabilities,
version, installation_directory, node_executable, config_file, records_root and
runtime_file. ID is SHA-256 of canonical config + newline + canonical root (lowercase
on Windows); runtime_file is config-parent/services/SHA-256(root-key)/runtime.json.
Do not put profiles in source, records, snapshots, logs or public network APIs.
Profiles contain private local paths, but never service/owner tokens or passwords.

`GET /api/service/connection` requires the existing `x-biz-service-token`, numeric
loopback and normal Host/Origin validation. LAN clients and local browser owners
without this service credential receive 403. Response kind is
biz-project-connection-handshake, protocol_version=1, with instance_id, pid and
the complete profile. Authenticated health advertises local-connection-v1.

Consumers should discover only the fixed per-user directory with bounded reads,
show multiple centers for explicit selection, and recheck the selected file's
fingerprint before saving. Verify a running service against its private runtime
identity, with no proxy/redirect, strict loopback, timeout and response-size limits.
Strip the runtime's private owner fragment before HTTP; never forward credentials
to a renderer, SQLite or stdout. The service's metadata must match the local profile;
do not blindly execute paths received from a network response. Offline profiles
can supply the same explicitly selected service-control arguments below. Saving
does not authorize startup. Moved/deleted installations require reconnection.

No disk/port scan, enrollment or default-center fallback. When profiles are absent,
an explicitly selected local source supports the offline bootstrap below.
Preserve all lifecycle gates below.
Also verify that the chosen existing config still resolves to the profile's
records root before saving; retargeted config pointers require refreshed profiles.
Unreachable runtime descriptors require manual recovery rather than silent offline
trust. A clean stop removes runtime.json while retaining the durable profile.

## Offline Source Bootstrap v1

```text
node "<user-selected-biz-project>/scripts/service-control.mjs" describe
node "<user-selected-biz-project>/scripts/service-control.mjs" describe --config "<existing absolute config>"
```

Returns kind=biz-project-connection-description, protocol_version=1,
state=ready|center_required, connections, ignored and truncated. Each connection
contains profile, state and identity=running|startup. Without an explicit config,
read only the saved standard config and up to 128 entries/16 distinct configs
referenced by this source's published profiles. Ignore environment center overrides.
Config limit: 8 KiB; profiles: 32 KiB; registry validation: 4 MiB. Probe budget:
2.5 seconds; each request: 350 ms total; output budget: 60,000 bytes. Consumers
also bound the child process/output. No writes, start, stop, browser or enrollment.

A compatible authenticated handshake supplies the actual running profile. An
older healthy service returns state=upgrade_required and identity=startup: these
are future startup paths, not claims about its running Node/source. Explicit
confirmation may save them, with manual-restart guidance, without replacing the
process. Other states: not_running, stopped, confirmation_required, disabled and
unavailable. A live unresponsive PID is unavailable, not trusted offline data.
Missing confirmed config yields center_required, never a fabricated default.

A desktop may detect a bounded local Node >=20 only after source selection.
Execute only the selected source's fixed describe helper, without a shell,
NODE_OPTIONS or NODE_PATH. Re-describe on explicit save, compare the selected
profile SHA-256 and verify config/root, preserving the consumer startup toggle.
Default file discovery stays spawn-free; this is not a per-Agent-task scan.

Platform and wizard use one managed launcher, including late center confirmation.
Registration precedes watcher startup; lease conflicts cannot start a second
watcher. Closing a reused handle never stops its owner's process. Unchanged
durable profiles are not rewritten.

## Service Operations

External desktop applications can use scripts/service-control.mjs independently
of project enrollment. Never pass the consumer as a registered project or change
its participation preferences. The caller supplies an explicitly chosen existing
configuration file. No guessed center, initialization or migration occurs.

```text
node "<biz-project>/scripts/service-control.mjs" status --config "<existing absolute config>"
node "<biz-project>/scripts/service-control.mjs" ensure --config "<existing absolute config>"
node "<biz-project>/scripts/service-control.mjs" ensure-companion --config "<existing absolute config>"
node "<biz-project>/scripts/service-control.mjs" stop --config "<existing absolute config>"
node "<biz-project>/scripts/service-control.mjs" open --config "<existing absolute config>"
```

Each operation emits one JSON object with kind=biz-project-service-control,
protocol_version=1, state and started. Running responses include the public
loopback URL without credentials; optional message/warning describes failures.
States: running, not_running, not_configured, confirmation_required, disabled,
stopped, incompatible, cooldown or unavailable. Nonzero exit indicates a malformed
request/configuration or operational failure. Never execute the output as code.

status is read-only. ensure validates the existing center and reuses the shared
identity check, process/startup leases, five-second startup deadline and 30-second
failure cooldown. Center auto-start approval and explicit stop remain gates.
Consumer-side opt-in is an additional gate, not permission to rewrite this policy.
New companion launches use --no-lan and never open a browser; an existing process's
network state is not changed. Watcher pause is not resumed, and scans are not an
Agent/desktop startup prerequisite. No OS service or MCP server is installed.

Authenticated health now advertises service-control-v1. Old healthy processes
without this capability report incompatible rather than being reused or replaced.
Unknown identities/live PIDs are never killed. The user saves drafts and explicitly
restarts the platform when upgrading. This checks the service-control capability,
not every future application feature or schema version.

open never starts a missing service. It revalidates identity/compatibility and opens
the actual private owner URL internally, only on the local user's explicit action.
That credential is not included in stdout, the consumer's UI/storage or logs.
Closing the consumer or disabling its linkage does not stop the shared process.

The approved 2026-10-19 extension adds explicit companion stop and linked resume.
`stop` is only for a user's manual stop action: authenticate and recheck identity,
send the existing loopback stop request, and wait up to five seconds for the same
runtime to be removed. Acknowledgement or failed health alone is insufficient.
Unknown/incompatible identities are not stopped; an incomplete shutdown returns
unavailable and does not authorize another launch. There is no PID kill fallback.

Private policy v1 has optional stop_id and companion_resume (see record-format).
A completed companion stop leaves stopped=true and a one-use linked-resume right.
Only `ensure-companion`, invoked with the consumer's explicit persisted linkage
consent or manual start action, may consume that right. It still requires the
center's auto_start=true, preserves failure cooldown and watcher pause, and reuses
the normal startup leases. Ordinary ensure/status/open never consume it. Another
explicit Biz/Agent stop invalidates the right, including during shutdown; it must
be manually resumed from Biz. Closing/disabling a consumer still does not stop it.

The authenticated stop request carries x-biz-stop-request, a private non-secret
UUID receipt used to avoid overriding a competing explicit stop. It never goes to
stdout/the renderer. Existing service-control-v1 processes can stop through the
same endpoint; a legacy writer preserves the caller's additive policy receipt.
The selected source needs the extended CLI; no running process is replaced just
to add the CLI. Never call stop/ensure-companion as a per-Agent-task preparation.

The 日周记 adapter is outside this repository. Its local SQLite preference defaults
off, desktop IPC is application-lock protected, and startup invokes ensure in an
asynchronous native task rather than a build script or browser page. No data/schema
coupling to its work-log database is required by this protocol.
