'use strict';
const path = require('path');

// Shown directly by Chromium (animated GIF/WebP/APNG/AVIF included).
const NATIVE = ['.jpg', '.jpeg', '.jpe', '.jfif', '.pjpeg', '.pjp', '.png', '.apng', '.gif', '.webp', '.avif', '.bmp', '.dib', '.ico', '.cur', '.svg'];
// Decoded in the background decoder process.
const DECODED = ['.tif', '.tiff', '.heic', '.heif', '.hif', '.jxl'];
const RAW = ['.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.orf', '.rw2', '.raf', '.pef', '.srw', '.x3f', '.3fr', '.erf', '.kdc', '.mrw', '.raw', '.rwl', '.iiq'];

const ALL = new Set([...NATIVE, ...DECODED, ...RAW]);
const NATIVE_SET = new Set(NATIVE);

// Extensions offered for the "default app" registration on Windows.
const ASSOCIATE = [...NATIVE, ...DECODED, ...RAW];

const ext = (f) => path.extname(f).toLowerCase();
const isImage = (f) => ALL.has(ext(f));
const isNative = (f) => NATIVE_SET.has(ext(f));

module.exports = { NATIVE, DECODED, RAW, ASSOCIATE, isImage, isNative, ext };
