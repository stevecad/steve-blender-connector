#!/usr/bin/env node
// STEVE connector for a live local Blender instance via Blender Lab MCP.
//   Set up:     node setup.js                         (configuration and Blender connection check)
//   First run:  node connector.js --pair <CODE>       (code from STEVE, Settings → Connectors)
//   After that: node connector.js
// Options: --config <file> (default ./config.json), --data <folder> (default ./data). Run one connector per Blender bridge.
'use strict';
const fs = require('fs');
const path = require('path');
const { Steve } = require('./lib/steve');
const { acquireLock } = require('./lib/lock');
const { Blender } = require('./lib/blender');
const { Actions, buildCatalog } = require('./lib/actions');
const { buildPanel } = require('./lib/panel');
const { version } = require('./package.json');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const ROOT = __dirname;
const configPath = path.resolve(arg('--config') || path.join(ROOT, 'config.json'));
const DATA = path.resolve(arg('--data') || path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
try {
  acquireLock(DATA);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
// The log keeps the current file and one older one, each up to 5 MB.
const LOG = path.join(DATA, 'connector.log');
const LOG_MAX = 5 * 1024 * 1024;
let logFile = null,
  logBytes = 0;
function openLog() {
  try {
    logBytes = fs.statSync(LOG).size;
  } catch {
    logBytes = 0;
  }
  if (logBytes > LOG_MAX) {
    fs.renameSync(LOG, LOG + '.1');
    logBytes = 0;
  }
  logFile = fs.createWriteStream(LOG, { flags: 'a' });
}
openLog();
function log(...args) {
  const line = `${new Date().toISOString()} ${args.join(' ')}\n`;
  process.stdout.write(line);
  logFile.write(line);
  logBytes += Buffer.byteLength(line);
  if (logBytes > LOG_MAX) {
    logFile.end();
    openLog();
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(configPath)) {
  console.error(
    `${configPath} is missing: run "node setup.js", or copy config.example.json to config.json and fill it in.`,
  );
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const steve = new Steve({
  baseUrl: config.steve_url || 'https://stevecad.studio/connect/v1',
  dataDir: DATA,
  log,
});
const blender = new Blender(config.blender);
let catalog = null,
  actions = null,
  actionNames = [];
const active = new Map(); // run id -> AbortController

// Register even when Blender is closed; status reports the bridge offline.
async function prepare() {
  catalog = buildCatalog();
  actionNames = catalog.actions.map((a) => a.name);
  actions = new Actions({ blender, filesDir: path.join(DATA, 'files') });
}

let lastSent = null,
  lastSentAt = 0,
  pollingStatus = false;
async function onBlenderChange() {
  if (!steve.token || pollingStatus) return;
  pollingStatus = true;
  try {
    let status;
    try {
      status = await blender.call('status');
    } catch {
      status = {
        connected: false,
        state: 'OFFLINE',
        message: 'Open Blender and start its MCP bridge',
      };
    }
    const encoded = JSON.stringify(status);
    if (encoded !== lastSent || Date.now() - lastSentAt > 60000) {
      await steve.event('status', status);
      lastSent = encoded;
      lastSentAt = Date.now();
    }
  } catch (e) {
    log('status:', e.message);
  } finally {
    pollingStatus = false;
  }
}
setInterval(onBlenderChange, 5000).unref();

// ---- runs ----

async function handleRun(message) {
  const env = message.envelope;
  const runId = env.id;
  const problem = await steve.check(message, actionNames);
  if (problem) {
    log(`run ${runId} rejected: ${problem}`);
    if (problem !== 'replayed')
      await steve.report(runId, { state: 'rejected', error: problem }).catch(() => {});
    return;
  }
  steve.rememberNonce(env.nonce);
  const prior = steve.runState(runId);
  if (active.has(runId) || prior === 'done') {
    log(`run ${runId}: delivered again; already handled, ignoring the repeat`);
    return;
  }
  if (prior === 'accepted') {
    // We had started this run when the connector stopped. Never repeat it (it could be an import); say what happened.
    log(
      `run ${runId}: delivered again after a restart; reporting it failed instead of repeating it`,
    );
    steve.queueReport(runId, {
      state: 'failed',
      error: 'The connector restarted during this run. Inspect Blender; the run was not repeated.',
    });
    return;
  }
  steve.rememberRun(runId, 'accepted');
  const who = env.requested_by?.kind || 'someone';
  log(`run ${runId}: ${env.action} by ${who}`);
  const controller = new AbortController();
  active.set(runId, controller);
  const ctx = {
    signal: controller.signal,
    progress: (progress, msg) =>
      steve
        .report(runId, { state: 'running', progress, message: msg })
        .catch((e) => log('progress:', e.message)),
    input: (input) => steve.fetchInput(input),
    file: (name, buf, type) => steve.uploadFile(runId, name, buf, type),
  };
  (async () => {
    let terminal;
    try {
      await steve.report(runId, { state: 'received' });
      await steve.report(runId, { state: 'running', progress: 0 });
      const out = (await actions.handlers[env.action](env.inputs || {}, ctx)) || {};
      terminal = { state: 'succeeded', result: out.result || {}, message: out.message || 'Done' };
      onBlenderChange();
    } catch (e) {
      // A bridge error can follow a completed scene mutation. Do not claim cancellation stopped it.
      terminal = {
        state: 'failed',
        error: controller.signal.aborted
          ? 'Run interrupted. A command already sent may have taken effect; inspect Blender before retrying.'
          : e.message,
      };
    } finally {
      steve.queueReport(runId, terminal);
      active.delete(runId);
      log(`run ${runId}: ${env.action} ${terminal.state}`);
    }
  })();
}

async function handleCancel(message) {
  const problem = await steve.check(message, actionNames);
  if (problem) return log(`cancel ignored: ${problem}`);
  steve.rememberNonce(message.envelope.nonce);
  const env = message.envelope;
  const runId = env.run; // envelope.id is the cancel's own id
  const c = active.get(runId);
  if (c) {
    log(`run ${runId}: cancelling`);
    c.abort();
  } else if (!steve.hasRun(runId)) {
    // A cancel can arrive before the run: persist it so delayed delivery cannot mutate Blender.
    steve.queueReport(runId, { state: 'cancelled', message: 'Cancelled before execution' });
  }
}

// Publishes the panel in panel/ when it changed ("panel": false in the config turns this off).
async function publishPanel() {
  if (config.panel === false) return;
  try {
    const { panel, hash } = buildPanel(path.join(ROOT, 'panel'), {
      title: config.panel?.title || 'Blender',
      placement: config.panel?.placement || ['right'],
    });
    const name = config.panel?.name || 'blender';
    if (steve.state.panel_hash === `${name}:${hash}`) return;
    const r = await steve.publishPanel(name, panel);
    steve.state.panel_hash = `${name}:${hash}`;
    steve.saveState();
    log(`published the panel "${r.name || 'blender'}" (version ${r.version ?? '?'})`);
  } catch (e) {
    log(`panel not published: ${e.message}`);
  }
}

// ---- main ----

async function main() {
  const code = arg('--pair');
  if (!steve.enrolled && !code) {
    console.error(
      'Not paired yet. Get a code in STEVE (Settings → Connectors → Pair a connector), then run:\n  node connector.js --pair <CODE>',
    );
    process.exit(1);
  }
  await prepare();
  if (!steve.enrolled) {
    const name = config.name || 'steve-blender-connector';
    const r = await steve.enroll(code.trim(), name, version, catalog);
    log(`enrolled as ${r.connector}`);
  }
  console.log('\n  Connector fingerprint (confirm this exact value in STEVE):\n');
  console.log(`  ${steve.fingerprint}\n`);
  logFile.write(`${new Date().toISOString()} fingerprint ${steve.fingerprint}\n`);
  if (process.argv.includes('--pair-only')) {
    logFile.end();
    return;
  }

  // Wait until the owner confirms the fingerprint.
  for (;;) {
    try {
      await steve.ensureToken();
      break;
    } catch (e) {
      if (e.code === 'pending_confirmation') {
        log('waiting for the connector to be confirmed in STEVE…');
        await sleep(60000);
      } else if (e.status === 403) {
        log(
          `STEVE refused this connector: ${e.message}. Revoked? Delete ${path.join(DATA, 'state.json')} and ${path.join(DATA, 'key.pem')}, then pair again.`,
        );
        process.exit(1);
      } else {
        log(`token: ${e.message}; retrying`);
        await sleep(15000);
      }
    }
  }
  log('confirmed by STEVE');
  for (const [id, state] of Object.entries(steve.state.runs)) {
    if (state === 'accepted')
      steve.queueReport(id, {
        state: 'failed',
        error: 'Connector restarted during this run; inspect Blender. The run was not repeated.',
      });
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await steve.putCatalog(catalog);
      break;
    } catch (e) {
      if (e.status === 403 || attempt >= 10) throw e;
      log(`catalog not sent (${e.message}); retrying`);
      await sleep(Math.min(60000, 2000 * attempt));
    }
  }
  await publishPanel();
  await onBlenderChange();

  let backoff = 1000;
  for (;;) {
    try {
      await steve.flushReports();
      const { messages, cursor } = await steve.messages(5);
      backoff = 1000;
      for (const m of messages) {
        try {
          if (m.kind === 'run') await handleRun(m);
          else if (m.kind === 'cancel') await handleCancel(m);
        } catch (e) {
          log(`message ${m.id}: ${e.message}`);
          if (m.kind === 'run' && m.envelope?.id && !active.has(m.envelope.id)) {
            await steve
              .report(m.envelope.id, { state: 'rejected', error: `connector error: ${e.message}` })
              .catch(() => {});
          }
        }
        steve.advance(m.id);
      }
      if (cursor !== null) steve.advance(cursor);
    } catch (e) {
      if (e.status === 403 && e.code !== 'token_invalid' && e.code !== 'signature_invalid') {
        log(`STEVE refused this connector: ${e.message}`);
        process.exit(1);
      }
      log(`poll: ${e.message}`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const c of active.values()) c.abort();
    log('stopping');
    process.exit(0);
  });
main().catch((e) => {
  const message = e.stack || e.message;
  console.error(message);
  log('fatal:', message);
  logFile.end(() => process.exit(1));
});
