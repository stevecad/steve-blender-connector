'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'panel', 'panel.js'), 'utf8');
async function panel() {
  const nodes = new Map(),
    sent = [];
  let receive;
  const get = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: id === 'destination' ? 'current' : id === 'frame' ? '1' : '',
        disabled: false,
        addEventListener(type, fn) {
          this[type] = fn;
        },
      });
    return nodes.get(id);
  };
  const parent = { postMessage: (m) => sent.push(m) };
  const context = vm.createContext({
    document: { getElementById: get, body: { dataset: {} } },
    window: { parent, addEventListener: (type, fn) => (receive = fn) },
  });
  vm.runInContext(source, context);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const deliver = (m) => receive({ source: parent, data: { steve: 1, ...m } });
  deliver({
    id: sent.at(-1).id,
    result: { document: { id: 'doc', kind: 'design', revision: 1 }, theme: 'dark' },
  });
  await tick();
  deliver({
    id: sent.at(-1).id,
    result: [
      {
        name: 'status',
        data: { connected: true, scene: 'Scene', objects: 1, fps: 24, version: 'test' },
      },
    ],
  });
  await tick();
  deliver({
    id: sent.at(-1).id,
    result: ['status', 'import_model', 'save_copy'].map((name) => ({ name, allowed: true })),
  });
  await tick();
  return { get, sent, deliver, tick };
}
test('a late previous run cannot unlock or capture a pending import', async () => {
  const p = await panel();
  p.get('insert').click();
  const rpc = p.sent.at(-1);
  assert.equal(rpc.method, 'run');
  assert.equal(p.get('insert').disabled, true);
  p.deliver({
    event: 'run',
    run: { id: 'previous-status', state: 'succeeded', result: { connected: true } },
  });
  assert.equal(p.get('insert').disabled, true);
  p.deliver({ id: rpc.id, result: { id: 'our-import', state: 'queued' } });
  await p.tick();
  p.deliver({
    event: 'run',
    run: { id: 'our-import', state: 'succeeded', result: { meshes: 14 } },
  });
  assert.equal(p.get('insert').disabled, false);
  assert.match(p.get('result').textContent, /14/);
});
test('terminal update received before the RPC reply is retained for the correct run', async () => {
  const p = await panel();
  p.get('insert').click();
  const rpc = p.sent.at(-1);
  p.deliver({ event: 'run', run: { id: 'our-import', state: 'succeeded', result: { meshes: 2 } } });
  assert.equal(p.get('insert').disabled, true);
  p.deliver({ id: rpc.id, result: { id: 'our-import', state: 'queued' } });
  await p.tick();
  assert.equal(p.get('insert').disabled, false);
  assert.match(p.get('result').textContent, /2/);
});
