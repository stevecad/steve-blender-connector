'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeZip } = require('../lib/zip');

const EXECUTABLES = new Set(['start-connector.command', 'service/macos/install.sh']);
const MESH_FIXTURES = new Set(['test/fixtures/cube.3mf', 'test/fixtures/two-parts.3mf']);

function validatePath(root, file) {
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || /[\\:]/.test(file)) {
    throw new Error('Invalid path in release allowlist');
  }
  const parts = file.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid path in release allowlist');
  }
  const privateDirectory =
    /^(data.*|artifacts|dist|node_modules|coverage|backups?|\.git|\.aws|\.codex|\.agents)$/i;
  const privateFile = /(^\.env($|\.)|^config.*\.json$|\.config\.json$|\.(pem|key|log)$)/i;
  const generatedFile = /\.(blend\d*|gcode|bgcode|3mf|stl|step|stp|glb|gltf|mp4|mov|wav|mp3)$/i;
  if (
    parts.some((part) => privateDirectory.test(part)) ||
    (file !== 'config.example.json' && privateFile.test(parts.at(-1))) ||
    (generatedFile.test(file) && !MESH_FIXTURES.has(file))
  ) {
    throw new Error(`Private or generated path in release allowlist: ${file}`);
  }
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Release path is a symlink: ${file}`);
  }
  if (!fs.statSync(current).isFile()) throw new Error(`Release path is not a file: ${file}`);
}

function packageRelease(root = path.resolve(__dirname, '..')) {
  const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^[a-z0-9-]+$/.test(name) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) {
    throw new Error('Invalid release name or version');
  }
  const files = JSON.parse(fs.readFileSync(path.join(root, 'release-files.json'), 'utf8'));
  if (
    !Array.isArray(files) ||
    new Set(files).size !== files.length ||
    !files.includes('.gitignore')
  ) {
    throw new Error('Release allowlist must include .gitignore and contain unique paths');
  }
  const out = path.join(root, 'dist', 'v' + version);
  if (fs.existsSync(out)) throw new Error('Release directory already exists; refusing overwrite');
  const entries = new Map(),
    executable = new Set(),
    manifest = [];
  for (const file of files) {
    validatePath(root, file);
    const data = fs.readFileSync(path.join(root, file));
    entries.set(`${name}/${file}`, data);
    if (EXECUTABLES.has(file)) executable.add(`${name}/${file}`);
    manifest.push({
      path: file,
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    });
  }
  const zip = writeZip(entries, { executable });
  const tree = path.join(out, name);
  fs.mkdirSync(tree, { recursive: true });
  for (const file of files) {
    const target = path.join(tree, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entries.get(`${name}/${file}`), {
      mode: EXECUTABLES.has(file) ? 0o755 : 0o644,
    });
  }
  const filename = `${name}-${version}-source.zip`;
  fs.writeFileSync(path.join(out, filename), zip);
  fs.writeFileSync(
    path.join(out, 'SHA256SUMS'),
    crypto.createHash('sha256').update(zip).digest('hex') + '  ' + filename + '\n',
  );
  fs.writeFileSync(
    path.join(out, 'manifest.json'),
    JSON.stringify({ name, version, files: manifest }, null, 2) + '\n',
  );
  return { archive: path.join(out, filename), tree, files: files.length };
}

if (require.main === module) console.log(packageRelease().archive);
module.exports = { packageRelease };
