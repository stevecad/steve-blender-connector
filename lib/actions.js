'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspect } = require('./model');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const text = { type: 'string', maxLength: 100 };
const motion = {
  type: 'object',
  title: 'STEVE motion metadata',
  description:
    'Optional {document_id, revision, kinematics, clip, part_map}. Get kinematics with STEVE read_design(detail="kinematics"). 3MF alone has no animation.',
};
const destination = { type: 'string', enum: ['current', 'new'], default: 'current' };
function buildCatalog() {
  return {
    actions: [
      {
        name: 'status',
        title: 'Blender scene status',
        description: 'Read live Blender status, scene names and imported collections.',
        inputs: obj(),
      },
      {
        name: 'import_model',
        title: 'Insert into Blender',
        description:
          'Import this STEVE part or design as separate meshes in a new collection, in the current or a new scene. Existing objects remain. 3MF is static unless matching motion metadata is supplied.',
        inputs: obj(
          {
            model: { 'x-steve': 'file', format: '3mf', title: 'STEVE model' },
            destination,
            target_scene: { ...text, title: 'Existing scene name (optional)' },
            scene_name: { ...text, title: 'New scene name' },
            motion,
            start_frame: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
          },
          ['model'],
        ),
      },
      {
        name: 'apply_motion',
        title: 'Add STEVE animation',
        description:
          'Bake a matching STEVE revolute/slider/rigid joint animation and its couplings onto a previously imported collection. Requires metadata for the same document revision. Existing animation is never overwritten.',
        inputs: obj(
          {
            import_id: text,
            motion,
            start_frame: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
          },
          ['import_id', 'motion'],
        ),
      },
      {
        name: 'save_copy',
        title: 'Save Blender copy',
        description:
          'Save all current Blender scenes into a uniquely named .blend copy in this connector’s local data/exports folder. Does not overwrite or change the current file.',
        inputs: obj({ name: text }),
      },
    ],
    events: [
      { name: 'status', description: 'Blender bridge status, active scene and object count' },
    ],
  };
}
function validateGlb(buffer) {
  if (
    buffer.length < 20 ||
    buffer.length > 128 * 1024 * 1024 ||
    buffer.toString('ascii', 0, 4) !== 'glTF' ||
    buffer.readUInt32LE(4) !== 2 ||
    buffer.readUInt32LE(8) !== buffer.length
  )
    throw new Error('Invalid or oversized GLB 2 file');
  const length = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + length > buffer.length)
    throw new Error('Invalid GLB JSON chunk');
  const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + length).trim());
  const scan = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, v] of Object.entries(value)) {
      if (key === 'uri' && (typeof v !== 'string' || !v.startsWith('data:')))
        throw new Error('GLB must be self-contained; external resource URIs are refused');
      scan(v);
    }
  };
  scan(gltf);
  return gltf;
}
function validateMotion(value, document, revision) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !value.kinematics ||
    value.document_id !== document ||
    value.revision !== revision
  )
    throw new Error('Motion must contain kinematics and the matching document_id and revision');
  if (Buffer.byteLength(JSON.stringify(value)) > 60000)
    throw new Error(
      'Motion metadata exceeds 60 kB; use local Animated GLB import for larger animations',
    );
  if (
    value.part_map &&
    (typeof value.part_map !== 'object' ||
      Array.isArray(value.part_map) ||
      Object.values(value.part_map).some((v) => typeof v !== 'string'))
  )
    throw new Error('part_map must map part IDs to instance names');
}
class Actions {
  constructor({ blender, filesDir }) {
    this.blender = blender;
    this.filesDir = filesDir;
    fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
    this.busy = false;
    this.handlers = {
      status: async () => ({ result: await blender.call('status') }),
      import_model: (i, c) => this.exclusive(() => this.importModel(i, c)),
      apply_motion: (i, c) => this.exclusive(() => this.applyMotion(i, c)),
      save_copy: (i, c) => this.exclusive(() => this.saveCopy(i, c)),
    };
  }
  async exclusive(fn) {
    if (this.busy) throw new Error('Another Blender operation is in progress; wait for its result');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  options(i) {
    if (!['current', 'new'].includes(i.destination || 'current'))
      throw new Error('Invalid destination');
    for (const key of ['target_scene', 'scene_name'])
      if (i[key] !== undefined && (typeof i[key] !== 'string' || i[key].length > 100))
        throw new Error('Invalid scene name');
    if (
      i.start_frame !== undefined &&
      (!Number.isInteger(i.start_frame) || i.start_frame < 1 || i.start_frame > 100000)
    )
      throw new Error('Invalid start frame');
    return {
      destination: i.destination || 'current',
      target_scene: i.target_scene || undefined,
      scene_name: i.scene_name || undefined,
      start_frame: i.start_frame || 1,
    };
  }
  async importModel(i, ctx) {
    const options = this.options(i);
    const model = i.model;
    if (
      !model ||
      model.kind !== 'file' ||
      model.format !== '3mf' ||
      !model.document ||
      !Number.isInteger(model.revision)
    )
      throw new Error('A signed STEVE 3MF input is required');
    if (
      !Number.isInteger(model.bytes) ||
      model.bytes <= 0 ||
      model.bytes > 128 * 1024 * 1024 ||
      !/^[a-f\d]{64}$/i.test(model.sha256 || '')
    )
      throw new Error('Missing or invalid model size/SHA-256');
    if (i.motion) validateMotion(i.motion, model.document, model.revision);
    // Capture the scene before the potentially slow download.
    const state = await this.blender.call('status', {}, ctx.signal);
    options.target_scene ||= state.scene;
    const buffer = await ctx.input(model);
    ctx.signal?.throwIfAborted();
    if (buffer.length !== model.bytes || sha(buffer) !== model.sha256.toLowerCase())
      throw new Error('Model size or SHA-256 mismatch');
    const parts = inspect(buffer);
    const id = crypto.randomUUID();
    const file = path.join(this.filesDir, id + '.json');
    fs.writeFileSync(file, JSON.stringify(parts), { mode: 0o600 });
    await ctx.progress?.(0.5, 'Geometry verified; inserting into Blender');
    const payload = {
      ...options,
      import_id: id,
      file,
      format: '3mf',
      sha256: sha(buffer),
      name: String(model.name || 'STEVE model').slice(0, 100),
      document: model.document,
      revision: model.revision,
      motion: i.motion,
      motion_module: path.join(__dirname, '..', 'blender', 'motion.py'),
    };
    const result = await this.blender.call('import_model', payload, ctx.signal);
    fs.writeFileSync(
      path.join(this.filesDir, id + '.record.json'),
      JSON.stringify({ id, document: model.document, revision: model.revision, result }),
      { mode: 0o600 },
    );
    return {
      result,
      message: i.motion
        ? 'Imported geometry and baked STEVE animation'
        : 'Imported geometry into Blender. 3MF does not contain animation.',
    };
  }
  async applyMotion(i, ctx) {
    this.options(i);
    if (!/^[a-f\d-]{36}$/i.test(i.import_id || '')) throw new Error('Invalid import ID');
    const record = JSON.parse(
      fs.readFileSync(path.join(this.filesDir, i.import_id + '.record.json'), 'utf8'),
    );
    validateMotion(i.motion, record.document, record.revision);
    const result = await this.blender.call(
      'apply_motion',
      {
        import_id: i.import_id,
        motion: i.motion,
        start_frame: i.start_frame || 1,
        motion_module: path.join(__dirname, '..', 'blender', 'motion.py'),
      },
      ctx.signal,
    );
    return { result, message: 'STEVE animation baked into Blender keyframes' };
  }
  async importLocal(file, options = {}) {
    // This path is CLI-only and is deliberately absent from the remote catalog.
    const buffer = fs.readFileSync(file);
    validateGlb(buffer);
    const id = crypto.randomUUID();
    const target = path.join(this.filesDir, id + '.glb');
    fs.writeFileSync(target, buffer, { mode: 0o600 });
    const result = await this.blender.call('import_model', {
      ...this.options(options),
      import_id: id,
      format: 'glb',
      file: target,
      name: path.basename(file, '.glb'),
      sha256: sha(buffer),
    });
    return result;
  }
  async saveCopy(i, ctx) {
    const name = String(i.name || 'steve-scene')
      .replace(/[^a-z0-9_-]/gi, '-')
      .slice(0, 60);
    const dir = path.resolve(this.filesDir, '..', 'exports');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${name}-${crypto.randomUUID()}.blend`);
    return {
      result: await this.blender.call('save_copy', { file }, ctx.signal),
      message: 'Saved a unique local .blend copy in data/exports',
    };
  }
}
module.exports = { Actions, buildCatalog, validateGlb, validateMotion };
