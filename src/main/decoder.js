// Runs in an Electron utility process so heavy decodes never freeze the window.
// Handles the formats Chromium can't show by itself:
//   TIFF, HEIC/HEIF, JPEG XL, and camera RAW files (via their embedded JPEG preview).
'use strict';

const fs = require('fs/promises');
const path = require('path');

let utif, heic, jxl;

async function decodeTiff(buf) {
  utif = utif || require('utif2');
  const ifds = utif.decode(buf);
  // pick the largest page (some TIFFs start with a thumbnail)
  let best = null;
  for (const ifd of ifds) {
    const w = ifd.t256 ? ifd.t256[0] : 0;
    const h = ifd.t257 ? ifd.t257[0] : 0;
    if (!best || w * h > best.w * best.h) best = { ifd, w, h };
  }
  if (!best) throw new Error('No image found in TIFF');
  utif.decodeImage(buf, best.ifd, ifds);
  const rgba = utif.toRGBA8(best.ifd);
  return { kind: 'rgba', width: best.ifd.width, height: best.ifd.height, data: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) };
}

async function decodeHeic(buf) {
  heic = heic || require('heic-decode');
  const { width, height, data } = await heic({ buffer: buf });
  return { kind: 'rgba', width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
}

async function decodeJxl(buf) {
  if (!jxl) {
    const dir = path.dirname(require.resolve('@jsquash/jxl/package.json'));
    const mod = await import(require('url').pathToFileURL(path.join(dir, 'decode.js')).href);
    const wasm = await fs.readFile(path.join(dir, 'codec', 'dec', 'jxl_dec.wasm'));
    await mod.init(await WebAssembly.compile(wasm));
    jxl = mod.default;
  }
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const img = await jxl(ab);
  const d = img.data;
  return { kind: 'rgba', width: img.width, height: img.height, data: Buffer.from(d.buffer, d.byteOffset, d.byteLength) };
}

// Camera RAW: almost every RAW format embeds a full-size JPEG preview.
// Find every JPEG stream in the file and return the biggest one.
function findJpegs(buf) {
  const out = [];
  const n = buf.length;
  for (let i = 0; i < n - 3; i++) {
    if (buf[i] !== 0xff || buf[i + 1] !== 0xd8 || buf[i + 2] !== 0xff) continue;
    const end = jpegEnd(buf, i);
    if (end > 0) {
      out.push([i, end]);
      i = end - 1;
    }
  }
  return out;
}

function jpegEnd(buf, start) {
  let p = start + 2;
  const n = buf.length;
  // walk marker segments until start-of-scan
  while (p + 4 <= n) {
    if (buf[p] !== 0xff) return -1;
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9) return p + 2;
    if (m >= 0xd0 && m <= 0xd7) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (len < 2) return -1;
    if (m === 0xda) { p += 2 + len; break; }
    p += 2 + len;
  }
  // scan entropy-coded data for the end-of-image marker
  while (p + 1 < n) {
    if (buf[p] === 0xff) {
      const m = buf[p + 1];
      if (m === 0xd9) return p + 2;
      if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
      if (m === 0xff) { p++; continue; }
      // another segment (progressive JPEGs have several scans)
      if (p + 4 > n) return -1;
      const len = buf.readUInt16BE(p + 2);
      p += 2 + len;
      continue;
    }
    p++;
  }
  return -1;
}

async function decodeRaw(buf) {
  const found = findJpegs(buf);
  if (!found.length) throw new Error('This RAW file has no preview image');
  found.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const [s, e] = found[0];
  return { kind: 'blob', mime: 'image/jpeg', data: Buffer.from(buf.subarray(s, e)) };
}

const RAW = new Set(['.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.orf', '.rw2', '.raf', '.pef', '.srw', '.x3f', '.3fr', '.erf', '.kdc', '.mrw', '.raw', '.rwl', '.iiq']);

async function decode(file) {
  const ext = path.extname(file).toLowerCase();
  const buf = await fs.readFile(file);
  if (ext === '.tif' || ext === '.tiff') return decodeTiff(buf);
  if (ext === '.heic' || ext === '.heif' || ext === '.hif') return decodeHeic(buf);
  if (ext === '.jxl') return decodeJxl(buf);
  if (RAW.has(ext)) {
    // DNGs are TIFFs; try the real image first, fall back to the preview
    if (ext === '.dng') {
      try { return await decodeRaw(buf); } catch { return decodeTiff(buf); }
    }
    return decodeRaw(buf);
  }
  throw new Error('Unsupported format');
}

process.parentPort.on('message', async (e) => {
  const { id, file } = e.data;
  try {
    const r = await decode(file);
    process.parentPort.postMessage({ id, ok: true, result: r });
  } catch (err) {
    process.parentPort.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
});
