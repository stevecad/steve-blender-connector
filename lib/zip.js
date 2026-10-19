// Just enough ZIP to read and rewrite 3MF packages (stored and deflated entries, no ZIP64).
'use strict';
const zlib = require('zlib');

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Returns Map(name -> Buffer).
function readZip(buf, maxBytes = 128 * 1024 * 1024) {
  if (buf.length > maxBytes) throw new Error('ZIP/3MF exceeds the input size limit');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP/3MF file');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > 10000) throw new Error('Too many ZIP entries');
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd) throw new Error('Truncated ZIP directory');
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    total += size;
    if (total > maxBytes) throw new Error('Expanded ZIP exceeds the size limit');
    const nameLen = buf.readUInt16LE(p + 28),
      extraLen = buf.readUInt16LE(p + 30),
      commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (
      p + 46 + nameLen + extraLen + commentLen > eocd ||
      local + 30 > buf.length ||
      buf.readUInt32LE(local) !== 0x04034b50
    )
      throw new Error('Invalid ZIP offsets');
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (
      entries.has(name) ||
      name.startsWith('/') ||
      name.split('/').includes('..') ||
      name.includes('\\')
    )
      throw new Error('Invalid or duplicate ZIP path');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (dataStart + compSize > buf.length) throw new Error('Truncated ZIP entry');
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8)
      entries.set(name, zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, size) }));
    else throw new Error(`unsupported ZIP method ${method} for ${name}`);
    const unpacked = entries.get(name);
    if (unpacked.length !== size || crc32(unpacked) !== buf.readUInt32LE(p + 16))
      throw new Error('ZIP entry size or checksum mismatch');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function writeZip(entries, { executable = new Set() } = {}) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(comp.length, 18);
    head.writeUInt16LE(33, 12); // Fixed valid DOS date: 1980-01-01, for reproducible archives.
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE((3 << 8) | 20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt32LE(((executable.has(name) ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt16LE(33, 14);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, comp);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

module.exports = { readZip, writeZip };
