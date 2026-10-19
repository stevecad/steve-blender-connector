'use strict';
const fs = require('fs');
const path = require('path');
module.exports.fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
