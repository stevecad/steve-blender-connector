'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

class Blender {
  constructor({ host = '127.0.0.1', port = 9876, timeout_ms = 120000 } = {}) {
    if (!['127.0.0.1', '::1', 'localhost'].includes(host))
      throw new Error('Blender MCP must use loopback');
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Invalid Blender port');
    if (!Number.isFinite(timeout_ms) || timeout_ms < 100 || timeout_ms > 300000)
      throw new Error('Invalid Blender timeout');
    Object.assign(this, { host, port, timeout_ms });
    this.tail = Promise.resolve();
  }
  execute(code, signal) {
    const run = () => this.request(code, signal);
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    return result;
  }
  request(code, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      let size = 0,
        chunks = [],
        settled = false;
      const socket = net.createConnection({ host: this.host, port: this.port });
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        socket.destroy();
        error ? reject(error) : resolve(result);
      };
      const abort = () =>
        finish(
          new Error(
            'Blender request interrupted; its effect may already have occurred. Inspect Blender before submitting a new run.',
          ),
        );
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              'Blender response timed out; outcome is unknown. This run will not be repeated.',
            ),
          ),
        this.timeout_ms,
      );
      signal?.addEventListener('abort', abort, { once: true });
      socket.on('connect', () =>
        socket.write(JSON.stringify({ type: 'execute', code, strict_json: true }) + '\0'),
      );
      socket.on('error', () =>
        finish(
          new Error(
            'Blender bridge unavailable. Open Blender and enable/start the Blender Lab MCP extension on loopback.',
          ),
        ),
      );
      socket.on('end', () =>
        finish(
          new Error(
            'Blender closed the connection before a complete response; outcome is unknown.',
          ),
        ),
      );
      socket.on('data', (chunk) => {
        const end = chunk.indexOf(0);
        const part = end >= 0 ? chunk.subarray(0, end) : chunk;
        size += part.length;
        if (size > 8 * 1024 * 1024)
          return finish(new Error('Blender response exceeds 8 MiB; inspect Blender for outcome'));
        chunks.push(part);
        if (end < 0) return;
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (value.status !== 'ok')
            return finish(new Error(value.message || 'Blender adapter failed'));
          finish(null, value.result);
        } catch {
          finish(new Error('Invalid Blender response; outcome is unknown'));
        }
      });
    });
  }
  call(operation, payload = {}, signal) {
    if (!['status', 'import_model', 'apply_motion', 'save_copy'].includes(operation))
      throw new Error('Unknown Blender operation');
    const source = fs.readFileSync(path.join(__dirname, '..', 'blender', 'adapter.py'), 'utf8');
    const encoded = Buffer.from(JSON.stringify({ operation, ...payload })).toString('base64');
    return this.execute(
      `${source}\nimport base64\nresult = dispatch(json.loads(base64.b64decode('${encoded}')))\n`,
      signal,
    );
  }
}
module.exports = { Blender };
