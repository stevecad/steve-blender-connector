#!/usr/bin/env node
'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { Blender } = require('./lib/blender');
const file = path.join(__dirname, 'config.json');
if (!fs.existsSync(file))
  fs.copyFileSync(path.join(__dirname, 'config.example.json'), file, fs.constants.COPYFILE_EXCL);
fs.chmodSync(file, 0o600);
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
new Blender(config.blender)
  .call('status')
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
