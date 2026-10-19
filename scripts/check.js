'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function check(p) {
  if (fs.statSync(p).isDirectory()) for (const n of fs.readdirSync(p)) check(path.join(p, n));
  else if (p.endsWith('.js')) execFileSync(process.execPath, ['--check', p], { stdio: 'inherit' });
}
for (const name of ['connector.js', 'setup.js', 'import-glb.js', 'lib', 'panel', 'scripts', 'test'])
  check(path.join(root, name));
for (const name of ['package.json', 'config.example.json', 'release-files.json'])
  JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
console.log('JavaScript syntax and configuration checks passed');
