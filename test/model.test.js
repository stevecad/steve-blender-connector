'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('fs'),
  path = require('path');
const { inspect } = require('../lib/model');
const { readZip, writeZip } = require('../lib/zip');
const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n));
test('release ZIP preserves the manual launcher executable permission', () => {
  const entries = new Map([['start-connector.command', Buffer.from('#!/bin/sh\n')]]);
  const buffer = writeZip(entries, { executable: new Set(entries.keys()) });
  const central = buffer.readUInt32LE(buffer.length - 6);
  assert.equal(buffer.readUInt16LE(central + 4) >> 8, 3);
  assert.equal(buffer.readUInt32LE(central + 38) >>> 16, 0o100755);
  assert.equal(readZip(buffer).get('start-connector.command').toString(), '#!/bin/sh\n');
});
test('instances retain separate geometry and placed transforms', () => {
  const parts = inspect(fixture('two-parts.3mf'));
  assert.equal(parts.length, 2);
  assert.equal(parts[1].bounds.min[0], 12);
  assert.equal(parts[1].bounds.max[0], 22);
  assert.notEqual(parts[0].id, parts[1].id);
});
test('embedded slicer settings cannot affect imported geometry', () => {
  const source = fixture('cube.3mf');
  const zip = readZip(source);
  zip.set('Metadata/Slic3r_PE.config', Buffer.from('post_process = malicious'));
  assert.deepEqual(inspect(writeZip(zip)), inspect(source));
});
test('3MF entities, invalid mesh indices and path traversal are refused', () => {
  const zip = readZip(fixture('cube.3mf'));
  zip.set('3D/3dmodel.model', Buffer.from('<!DOCTYPE model [<!ENTITY x "bad">]><model/>'));
  assert.throws(() => inspect(writeZip(zip)), /DTDs/);
  const bad = readZip(fixture('cube.3mf'));
  bad.set(
    '3D/3dmodel.model',
    Buffer.from(bad.get('3D/3dmodel.model').toString().replace('v1="0"', 'v1="999999"')),
  );
  assert.throws(() => inspect(writeZip(bad)), /triangle/);
  assert.throws(() => readZip(writeZip(new Map([['../bad', Buffer.from('x')]]))), /path/);
});
