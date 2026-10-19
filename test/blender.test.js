'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  net = require('node:net');
const { Blender } = require('../lib/blender');
async function server(t, handler) {
  const s = net.createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => s.close(r)));
  return new Blender({ port: s.address().port, timeout_ms: 200 });
}
test('loopback only and fixed public operations', () => {
  assert.throws(() => new Blender({ host: '192.168.1.2' }), /loopback/);
  assert.throws(() => new Blender().call('execute_python'), /Unknown/);
});
test('fragmented null-delimited response is decoded once', async (t) => {
  const b = await server(t, (s) =>
    s.on('data', (chunk) => {
      assert.equal(JSON.parse(chunk.toString().slice(0, -1)).type, 'execute');
      s.write('{"status":"ok","result":');
      setTimeout(() => s.end('{"answer":42}}\0'), 5);
    }),
  );
  assert.deepEqual(await b.execute('result = {}'), { answer: 42 });
});
test('uncertain timeout never retries an execution', async (t) => {
  let sent = 0;
  const b = await server(t, (s) => s.on('data', () => sent++));
  await assert.rejects(b.execute('pass'), /outcome is unknown/);
  assert.equal(sent, 1);
});
test('requests are serialized and abort before dispatch prevents effects', async (t) => {
  const order = [];
  const b = await server(t, (s) =>
    s.on('data', (chunk) => {
      order.push(JSON.parse(chunk.toString().slice(0, -1)).code);
      setTimeout(() => s.end('{"status":"ok","result":{}}\0'), 30);
    }),
  );
  const controller = new AbortController();
  const first = b.execute('first');
  const second = b.execute('second', controller.signal);
  controller.abort();
  await first;
  await assert.rejects(second);
  assert.deepEqual(order, ['first']);
});
