'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { Actions, validateGlb, validateMotion, buildCatalog } = require('../lib/actions');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steve-blender-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const blender = {
    call: async (op, p) => {
      calls.push({ op, p });
      return op === 'status' ? { scene: 'Original' } : { import_id: p.import_id };
    },
  };
  const a = new Actions({ blender, filesDir: dir });
  const b = fs.readFileSync(path.join(__dirname, 'fixtures/two-parts.3mf'));
  const model = {
    kind: 'file',
    format: '3mf',
    name: 'Assembly',
    document: 'doc',
    revision: 2,
    bytes: b.length,
    sha256: crypto.createHash('sha256').update(b).digest('hex'),
  };
  return { a, b, model, calls, ctx: { input: async () => b } };
}
test('import snapshots target scene, verifies geometry and preserves part separation', async (t) => {
  const { a, model, calls, ctx } = setup(t);
  await a.handlers.import_model({ model }, ctx);
  assert.deepEqual(
    calls.map((c) => c.op),
    ['status', 'import_model'],
  );
  assert.equal(calls[1].p.target_scene, 'Original');
  const parts = JSON.parse(fs.readFileSync(calls[1].p.file));
  assert.equal(parts.length, 2);
  assert.equal(parts[1].bounds.min[0], 12);
});
test('hash mismatch and wrong animation revision cannot mutate Blender', async (t) => {
  const { a, model, calls, ctx } = setup(t);
  await assert.rejects(
    a.handlers.import_model({ model: { ...model, sha256: '0'.repeat(64) } }, ctx),
    /SHA-256/,
  );
  assert.ok(calls.every((c) => c.op === 'status'));
  await assert.rejects(
    a.handlers.import_model(
      { model, motion: { document_id: 'doc', revision: 1, kinematics: {} } },
      ctx,
    ),
    /matching/,
  );
});
test('concurrent mutations are refused', async (t) => {
  const { a } = setup(t);
  let release;
  const p = a.exclusive(() => new Promise((r) => (release = r)));
  await assert.rejects(
    a.exclusive(() => {}),
    /in progress/,
  );
  release();
  await p;
});
test('GLB local import rejects external resources', () => {
  function glb(data) {
    let json = Buffer.from(JSON.stringify(data));
    json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
    const h = Buffer.alloc(20);
    h.write('glTF');
    h.writeUInt32LE(2, 4);
    h.writeUInt32LE(20 + json.length, 8);
    h.writeUInt32LE(json.length, 12);
    h.writeUInt32LE(0x4e4f534a, 16);
    return Buffer.concat([h, json]);
  }
  assert.throws(() => validateGlb(glb({ buffers: [{ uri: '/etc/passwd' }] })), /self-contained/);
  assert.throws(
    () => validateGlb(glb({ images: [{ uri: 'https://example.com/a.png' }] })),
    /self-contained/,
  );
  assert.doesNotThrow(() =>
    validateGlb(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 10 }] })),
  );
});
test('remote catalog exposes no code execution or filesystem import', () => {
  const names = buildCatalog().actions.map((a) => a.name);
  assert.deepEqual(names, ['status', 'import_model', 'apply_motion', 'save_copy']);
  assert.throws(
    () => validateMotion({ document_id: 'wrong', revision: 1, kinematics: {} }, 'doc', 1),
    /matching/,
  );
});
