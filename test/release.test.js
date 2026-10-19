'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packageRelease } = require('../scripts/package-release');
const { readZip } = require('../lib/zip');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blender-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'steve-blender-connector', version: '0.1.2' }),
  );
  fs.writeFileSync(path.join(root, '.gitignore'), 'data*/\nconfig*.json\n');
  fs.writeFileSync(path.join(root, 'start-connector.command'), '#!/bin/sh\n');
  const files = ['.gitignore', 'package.json', 'start-connector.command'];
  const allow = (more) =>
    fs.writeFileSync(path.join(root, 'release-files.json'), JSON.stringify([...files, ...more]));
  allow([]);
  return { root, allow };
}

test('release exports only allowed files into a clean tree and archive', (t) => {
  const { root } = fixture(t);
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data/key.pem'), 'PRIVATE TEST PLACEHOLDER');
  fs.writeFileSync(path.join(root, 'config.json'), '{"private":true}');
  const out = packageRelease(root);
  assert.equal(out.files, 3);
  const entries = readZip(fs.readFileSync(out.archive));
  assert.ok(entries.has('steve-blender-connector/.gitignore'));
  assert.equal(entries.size, 3);
  assert.equal(fs.existsSync(path.join(out.tree, 'config.json')), false);
  assert.ok(fs.readFileSync(path.join(out.tree, 'start-connector.command')).length);
  assert.throws(() => packageRelease(root), /refusing overwrite/);
});

test('private files are refused even when accidentally added to the allowlist', (t) => {
  const { root, allow } = fixture(t);
  for (const file of [
    'config.json',
    'config.local.json',
    '.env',
    'data/key.pem',
    'artifacts/scene.blend',
  ]) {
    allow([file]);
    assert.throws(() => packageRelease(root), /Private or generated/);
  }
});

test('release refuses parent-directory symlinks', (t) => {
  const { root, allow } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'blender-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'sample.txt'), 'test');
  fs.symlinkSync(
    outside,
    path.join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  allow(['linked/sample.txt']);
  assert.throws(() => packageRelease(root), /symlink/);
});
