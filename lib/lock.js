'use strict';
const fs = require('fs');
const path = require('path');
function acquireLock(directory) {
  const file = path.join(directory, 'connector.pid');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      const release = () => {
        try {
          if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file);
        } catch {}
      };
      process.once('exit', release);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0)
        throw new Error(
          'Connector lock is incomplete; check no connector is running before removing connector.pid',
        );
      let running = true;
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') running = false;
      }
      if (running) throw new Error(`Another connector is using this data directory (PID ${pid})`);
      fs.unlinkSync(file);
    }
  }
  throw new Error('Could not acquire the connector lock');
}
module.exports = { acquireLock };
