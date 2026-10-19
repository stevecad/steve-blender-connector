#!/usr/bin/env node
'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { Blender } = require('./lib/blender');
const { Actions } = require('./lib/actions');
const file = process.argv[2];
if (!file || !/\.glb$/i.test(file)) {
  console.error('Usage: node import-glb.js /path/to/animation.glb [--new-scene]');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
// Separate local cache; the daemon owns data/. The bridge serializes commands inside Blender.
new Actions({
  blender: new Blender(config.blender),
  filesDir: path.join(__dirname, 'data-local', 'files'),
})
  .importLocal(path.resolve(file), {
    destination: process.argv.includes('--new-scene') ? 'new' : 'current',
  })
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
