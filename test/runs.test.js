'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
// Execute the production run handlers without starting the daemon or accessing its private state.
const source = fs.readFileSync(path.join(__dirname, '..', 'connector.js'), 'utf8');
const handlers = source.slice(
  source.indexOf('async function handleRun('),
  source.indexOf('// Publishes the panel'),
);
function harness(report) {
  const runs = {},
    pending = {},
    reports = [];
  let executed = 0,
    finish;
  const terminal = new Promise((resolve) => (finish = resolve));
  const steve = {
    check: async () => null,
    rememberNonce: () => {},
    runState: (id) => runs[id],
    rememberRun: (id, state) => (runs[id] = state),
    report: async (id, payload) => {
      reports.push(payload.state);
      await report?.(payload);
    },
    queueReport: (id, payload) => {
      runs[id] = 'done';
      pending[id] = payload;
      finish(payload);
    },
  };
  const context = vm.createContext({
    steve,
    actionNames: ['import_model'],
    active: new Map(),
    AbortController,
    log: () => {},
    onBlenderChange: () => {},
    actions: {
      handlers: {
        import_model: async () => {
          executed++;
          return {};
        },
      },
    },
  });
  vm.runInContext(handlers, context);
  return { context, runs, pending, reports, terminal, executed: () => executed };
}
const message = {
  kind: 'run',
  envelope: { id: 'run-test', nonce: 'nonce', action: 'import_model', inputs: {} },
};
test('a lost initial receipt queues failure without executing or stranding the run', async () => {
  const h = harness(async () => {
    throw new Error('temporary reporting outage');
  });
  await h.context.handleRun(message);
  const result = await h.terminal;
  assert.equal(result.state, 'failed');
  assert.match(result.error, /reporting outage/);
  assert.equal(h.runs['run-test'], 'done');
  assert.equal(h.executed(), 0);
  await h.context.handleRun(message);
  assert.deepEqual(h.reports, ['received']);
});
test('normal delivery reports receipt before running and ignores repeats', async () => {
  const h = harness();
  await h.context.handleRun(message);
  await h.terminal;
  await h.context.handleRun(message);
  assert.deepEqual(h.reports, ['received', 'running']);
  assert.equal(h.executed(), 1);
});
