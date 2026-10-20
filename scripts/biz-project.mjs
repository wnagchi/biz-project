#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { inspectProject, initializeProject, setParticipation } from './lib/projects.mjs';
import { addUpdate, createFeature } from './lib/features.mjs';
import { requireProject } from './lib/projects.mjs';
import { historyStatus } from './lib/records-history.mjs';
import { ensureService, serviceStatus, stopService, setServicePolicy } from './lib/service-runtime.mjs';

const help = `biz-project (Node.js 20+)

Commands:
  inspect         Read-only discovery of records and project guidance.
  init            Register the project and install a bounded invocation hook.
  set-participation  Remember the user's explicit yes/no without creating records.
  create-feature  Create a feature record with a named owner.
  add-update      Publish one independent agent update; never advances status.
  history-status  Read local history state without writes.
  ensure-service  Inspect once; reuse or start the confirmed shared service.
  service-status  Read the shared service state without writes.
  stop-service    Stop explicitly and suppress automatic restart.
  set-service-policy  --decision yes|no after explicit auto-start consent.

Common options:
  --project PATH       Required project directory (Git subdirectories supported).
  --records-root PATH  User-confirmed central directory; required before creation.
  --config PATH        User pointer file (default ~/.config/biz-project/config.json).
  --host NAME          codex (default), cursor, or generic; not an agent identity.
  --rules-file PATH    Project-relative guidance file; remembered separately per host.
  --name NAME          Project display name for initial registration.
  --join-confirmed     Only after an explicit yes for an unregistered project.
  --decision yes|no    For set-participation; yes explicitly restores a refusal.

Feature options:
  --title TEXT --owner TEXT [--feature-id ID]

Update options:
  --feature ID --agent TEXT --body-file PATH [--update-id ID]

BIZ_PROJECT_HOME overrides the saved records root. Missing centers require user
confirmation and an explicit --records-root; there is no automatic default.
Legacy project-records centers are reported, never implicitly selected.
All successful commands
print JSON to stdout; failures print JSON to stderr and exit with status 1.
Initialization does not migrate old records, install the skill, or commit code.
`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true,
    options: Object.fromEntries(['project', 'records-root', 'config', 'rules-file', 'host',
      'name', 'title', 'owner', 'feature-id', 'feature', 'agent', 'body-file', 'update-id', 'decision']
      .map((name) => [name, { type: 'string' }]).concat([['help', { type: 'boolean', short: 'h' }], ['join-confirmed', { type: 'boolean' }]])) });
  if (values.help) {
    process.stdout.write(help);
  } else {
    if (positionals.length !== 1) throw new Error('Provide one command. Run --help for usage.');
    const commands = { inspect: inspectProject, init: initializeProject,
      'set-participation': setParticipation,
      'create-feature': createFeature, 'add-update': addUpdate,
      'history-status': options => historyStatus(requireProject(options).records_root),
      'ensure-service': async options => {
        const state = inspectProject(options);
        try { return { ...state, service: await ensureService(state) }; }
        catch (error) { return { ...state, service: { state: 'unavailable', started: false, warning: error.message } }; }
      },
      'service-status': async options => { const state = inspectProject(options); return { ...state, service: await serviceStatus(state) }; },
      'stop-service': options => stopService(requireProject(options)),
      'set-service-policy': options => ({ service_policy: setServicePolicy(requireProject(options), options.decision) }) };
    if (!Object.hasOwn(commands, positionals[0])) throw new Error(`Unknown command: ${positionals[0]}`);
    const command = commands[positionals[0]];
    const result = await command(values);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
}
