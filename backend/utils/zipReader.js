/**
 * utils/zipReader.js — dependency-free, in-memory ZIP reader (Node zlib only).
 *
 * Safety (uploads are untrusted):
 *  • Nothing is ever written to disk → no path-traversal ("zip slip") risk.
 *  • Zip-bomb guards: max entries, max size per entry (zlib maxOutputLength),
 *    and a total decompressed-bytes budget across the archive.
 *  • Encrypted entries and unsupported compression methods are skipped, not crashed on.
 *  • Entry names are normalised (no leading "/", no ".." segments) — they're only labels.
 *
 * readZip(buffer, opts) → { entries: [{ name, size, compressedSize, isDir, encrypted, method }],
 *                          truncated, read(entry) → Buffer | null }
 */
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function safeName(raw) {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/') + (raw.endsWith('/') ? '/' : '');
}

function readZip(buf, { maxEntries = 5000, maxEntryBytes = 10 * 1024 * 1024, maxTotalBytes = 100 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw Object.assign(new Error('Not a valid ZIP file'), { status: 400 });

  // End Of Central Directory record (search backwards past an optional comment)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw Object.assign(new Error('Not a valid ZIP file'), { status: 400 });

  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || off === 0xffffffff) throw Object.assign(new Error('ZIP64 archives are not supported — please re-zip with standard settings'), { status: 400 });

  const entries = [];
  for (let n = 0; n < total && n < maxEntries; n += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== SIG_CEN) break;
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = safeName(buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'));
    if (name) {
      entries.push({ name, size, compressedSize, method, localOffset, isDir: name.endsWith('/'), encrypted: Boolean(flags & 1) });
    }
    off += 46 + nameLen + extraLen + commentLen;
  }

  let used = 0;
  /** Decompresses one entry. Returns null if it's unsafe, encrypted or unsupported. */
  function read(entry) {
    if (entry.isDir || entry.encrypted) return null;
    if (entry.size > maxEntryBytes || used + entry.size > maxTotalBytes) return null;
    const lo = entry.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LOC) return null;
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const data = buf.subarray(start, start + entry.compressedSize);
    let out;
    try {
      if (entry.method === 0) out = Buffer.from(data);
      else if (entry.method === 8) out = zlib.inflateRawSync(data, { maxOutputLength: Math.min(maxEntryBytes, maxTotalBytes - used) + 1 });
      else return null; // other methods (bzip2, lzma…) unsupported
    } catch {
      return null; // corrupt, or bigger than declared (zip bomb)
    }
    if (out.length > maxEntryBytes) return null;
    used += out.length;
    return out;
  }

  return { entries, truncated: total > maxEntries, read };
}

module.exports = { readZip, safeName };
