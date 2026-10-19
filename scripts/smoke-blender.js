#!/usr/bin/env node
'use strict';
// Opt-in integration test: creates and removes only its own uniquely named scenes.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { Blender } = require('../lib/blender'),
  { Actions } = require('../lib/actions');
(async () => {
  const blender = new Blender();
  const before = await blender.call('status');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steve-blender-smoke-'));
  const actions = new Actions({ blender, filesDir: path.join(dir, 'files') });
  const buf = fs.readFileSync(path.join(__dirname, '../test/fixtures/two-parts.3mf'));
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const model = {
    kind: 'file',
    format: '3mf',
    document: 'smoke',
    revision: 1,
    name: 'Connector smoke',
    bytes: buf.length,
    sha256,
  };
  let scene;
  try {
    const imported = await actions.handlers.import_model(
      { model, destination: 'new' },
      { input: async () => buf },
    );
    scene = imported.result.scene;
    assert.equal(imported.result.meshes, 2);
    assert.ok(Math.abs(imported.result.bounds.size_mm[0] - 22) < 0.001);
    const parts = imported.result.parts;
    const motion = {
      document_id: 'smoke',
      revision: 1,
      part_map: { [parts[0].id]: 'base', [parts[1].id]: 'jaw' },
      kinematics: {
        version: 1,
        units: { angle: 'deg', length: 'mm' },
        joints: [
          {
            name: 'slide',
            parent: 'base',
            child: 'jaw',
            axis: [1, 0, 0],
            origin: [0, 0, 0],
            type: 'slider',
            value: 0,
          },
        ],
        couplings: [],
        animations: [
          {
            name: 'open',
            easing: 'linear',
            keys: [
              { time: 0, values: { slide: 0 } },
              { time: 1, values: { slide: 20 } },
            ],
          },
        ],
      },
    };
    const animated = await actions.handlers.apply_motion(
      { import_id: imported.result.import_id, motion },
      {},
    );
    assert.equal(animated.result.end_frame, 25);
    const id = JSON.stringify(imported.result.import_id);
    const probe = await blender.execute(
      `import bpy\nc=next(c for c in bpy.data.collections if c.get('steve_import_id')==${id})\ns=bpy.data.scenes[${JSON.stringify(scene)}]\ns.frame_set(25)\nresult={'x':next(o for o in c.objects if o.get('steve_part_id')=='${parts[1].id}').location.x,'original_objects':len(bpy.data.scenes[${JSON.stringify(before.scene)}].objects)}`,
    );
    assert.ok(Math.abs(probe.x - 0.02) < 1e-6);
    assert.equal(probe.original_objects, before.objects);
    await assert.rejects(
      actions.handlers.apply_motion({ import_id: imported.result.import_id, motion }, {}),
      /already has motion/,
    );
    await blender.execute(
      `import bpy\nbpy.context.scene.unit_settings.scale_length=.001\nresult={'units':'mm'}`,
    );
    const millimetres = await actions.handlers.import_model(
      { model, destination: 'current' },
      { input: async () => buf },
    );
    assert.ok(Math.abs(millimetres.result.bounds.size_mm[0] - 22) < 0.001);
    const copy = await actions.handlers.save_copy({ name: 'smoke' }, {});
    assert.equal(copy.result.saved, true);
    console.log(
      JSON.stringify(
        {
          passed: true,
          geometry_mm: imported.result.bounds.size_mm,
          motion: animated.result,
          original_scene_preserved: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (scene)
      await blender.execute(
        `import bpy\ns=bpy.data.scenes.get(${JSON.stringify(scene)})\nif s:\n    for o in list(s.objects): bpy.data.objects.remove(o,do_unlink=True)\n    for c in list(s.collection.children): bpy.data.collections.remove(c)\n    bpy.context.window.scene=bpy.data.scenes[${JSON.stringify(before.scene)}]\n    bpy.data.scenes.remove(s)\nresult={'cleaned':True}`,
      );
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
