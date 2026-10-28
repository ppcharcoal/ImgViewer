'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, clipboard, nativeImage, utilityProcess, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { isImage, isNative, NATIVE, DECODED, RAW } = require('./formats');
const winreg = require('./winreg');

app.setAppUserModelId('com.ppcharcoal.imgviewer');
Menu.setApplicationMenu(null);

protocol.registerSchemesAsPrivileged([
  { scheme: 'imgv', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------- paths & storage ----------
const DATA = app.getPath('userData');
const THUMBS = path.join(DATA, 'thumbs');
const HISTORY_FILE = path.join(DATA, 'history.json');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const HISTORY_MAX = 60;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
    fs.renameSync(tmp, file);
  } catch (e) { console.error('save failed', file, e); }
}

let settings = readJson(SETTINGS_FILE, {});
let history = readJson(HISTORY_FILE, []);
const saveSettings = () => writeJson(SETTINGS_FILE, settings);
const saveHistory = () => writeJson(HISTORY_FILE, history);
const thumbName = (p) => crypto.createHash('sha1').update(p.toLowerCase()).digest('hex').slice(0, 20) + '.jpg';

// ---------- file argument ----------
function fileFromArgs(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const a of args) {
    if (!a || a.startsWith('-')) continue;
    try {
      const p = path.resolve(a);
      if (fs.statSync(p).isFile()) return p;
    } catch { /* not a file */ }
  }
  return null;
}

let pendingFile = fileFromArgs(process.argv);
let win = null;

// ---------- single instance: reuse the open window ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgs(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (f) win.webContents.send('open-file', f);
    }
  });
}

// ---------- background decoder ----------
let decoder = null;
let decodeSeq = 0;
const decodeWaiting = new Map();
function getDecoder() {
  if (decoder) return decoder;
  decoder = utilityProcess.fork(path.join(__dirname, 'decoder.js'), [], { serviceName: 'ImgViewer Decoder' });
  decoder.on('message', (m) => {
    const w = decodeWaiting.get(m.id);
    if (!w) return;
    decodeWaiting.delete(m.id);
    m.ok ? w.resolve(m.result) : w.reject(new Error(m.error));
  });
  decoder.on('exit', () => {
    decoder = null;
    for (const w of decodeWaiting.values()) w.reject(new Error('Decoder stopped'));
    decodeWaiting.clear();
  });
  return decoder;
}
function decodeFile(file) {
  return new Promise((resolve, reject) => {
    const id = ++decodeSeq;
    decodeWaiting.set(id, { resolve, reject });
    getDecoder().postMessage({ id, file });
  });
}

// ---------- window ----------
const BG = '#0e0c13';

function createWindow() {
  const s = settings.window || {};
  const work = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: s.width || Math.min(1280, Math.round(work.width * 0.8)),
    height: s.height || Math.min(840, Math.round(work.height * 0.82)),
    x: s.x, y: s.y,
    minWidth: 520,
    minHeight: 380,
    show: false,
    backgroundColor: BG,
    title: 'ImgViewer',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: BG, symbolColor: '#d9d3e6', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (s.maximized) win.maximize();

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const b = maximized || win.isFullScreen() ? (settings.window || {}) : win.getBounds();
    settings.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
    saveSettings();
  };
  win.on('close', remember);
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  win.on('focus', () => win.webContents.send('focus'));

  // links never navigate the app window
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---------- IPC ----------
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => fn(...args));
}

handle('initial-file', () => { const f = pendingFile; pendingFile = null; return f; });

handle('info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  formats: { native: NATIVE, decoded: DECODED, raw: RAW },
}));

handle('open-dialog', async () => {
  const exts = [...NATIVE, ...DECODED, ...RAW].map((e) => e.slice(1));
  const r = await dialog.showOpenDialog(win, {
    title: 'Open image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: exts }, { name: 'All files', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

handle('stat', async (file) => {
  try {
    const st = await fsp.stat(file);
    return { exists: st.isFile(), size: st.size, mtime: st.mtimeMs, native: isNative(file), supported: isImage(file) };
  } catch { return { exists: false }; }
});

handle('list-folder', async (file) => {
  const dir = path.dirname(file);
  try {
    const names = await fsp.readdir(dir, { withFileTypes: true });
    const files = names.filter((d) => d.isFile() && isImage(d.name)).map((d) => d.name).sort(collator.compare).map((n) => path.join(dir, n));
    return files;
  } catch { return [file]; }
});

handle('decode', (file) => decodeFile(file));

handle('history-get', async () => {
  // drop entries whose files are gone
  const kept = [];
  for (const h of history) {
    try { if (fs.statSync(h.path).isFile()) kept.push(h); } catch { /* gone */ }
  }
  if (kept.length !== history.length) { history = kept; saveHistory(); }
  return history.map((h) => ({ ...h, thumbUrl: h.thumb ? `imgv://t/${h.thumb}?v=${h.openedAt}` : null }));
});

handle('history-add', async (entry) => {
  const p = entry.path;
  const old = history.find((h) => h.path.toLowerCase() === p.toLowerCase());
  const item = { ...(old || {}), path: p, name: path.basename(p), folder: path.dirname(p), openedAt: Date.now(), width: entry.width, height: entry.height };
  if (entry.thumb && entry.thumb.startsWith('data:image/jpeg;base64,')) {
    try {
      await fsp.mkdir(THUMBS, { recursive: true });
      item.thumb = thumbName(p);
      await fsp.writeFile(path.join(THUMBS, item.thumb), Buffer.from(entry.thumb.split(',')[1], 'base64'));
    } catch { /* thumbnail is optional */ }
  }
  history = [item, ...history.filter((h) => h !== old)];
  for (const dropped of history.slice(HISTORY_MAX)) {
    if (dropped.thumb) fsp.unlink(path.join(THUMBS, dropped.thumb)).catch(() => {});
  }
  history = history.slice(0, HISTORY_MAX);
  saveHistory();
  return true;
});

handle('history-remove', async (p) => {
  const h = history.find((x) => x.path === p);
  if (h && h.thumb) fsp.unlink(path.join(THUMBS, h.thumb)).catch(() => {});
  history = history.filter((x) => x.path !== p);
  saveHistory();
  return true;
});

handle('history-clear', async () => {
  history = [];
  saveHistory();
  fsp.rm(THUMBS, { recursive: true, force: true }).catch(() => {});
  return true;
});

handle('settings-get', () => settings);
handle('settings-set', (patch) => { settings = { ...settings, ...patch }; saveSettings(); return settings; });

handle('default-status', async () => ({ windows: process.platform === 'win32', isDefault: await winreg.isDefault() }));
handle('make-default', async () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
  const r = await winreg.register(process.execPath);
  if (r.ok) {
    settings.registeredExe = process.execPath;
    saveSettings();
    await winreg.openDefaultsPage();
  }
  return r;
});

handle('show-in-folder', (file) => { shell.showItemInFolder(file); return true; });
handle('open-with', (file) => shell.openPath(file));
handle('trash', async (file) => {
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Move to Recycle Bin', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Delete image',
    message: `Move "${path.basename(file)}" to the Recycle Bin?`,
    noLink: true,
  });
  if (r.response !== 0) return false;
  await shell.trashItem(file);
  return true;
});
handle('copy-image', (dataUrl) => { clipboard.writeImage(nativeImage.createFromDataURL(dataUrl)); return true; });
handle('copy-text', (t) => { clipboard.writeText(String(t)); return true; });
handle('fullscreen', (on) => { if (win) win.setFullScreen(on === undefined ? !win.isFullScreen() : !!on); return win && win.isFullScreen(); });
handle('set-title', (t) => { if (win) win.setTitle(t || 'ImgViewer'); return true; });
handle('titlebar-color', (c) => {
  if (win && process.platform !== 'darwin' && win.setTitleBarOverlay) {
    try { win.setTitleBarOverlay({ color: c, symbolColor: '#d9d3e6', height: 40 }); } catch { /* older OS */ }
  }
  return true;
});

// ---------- app lifecycle ----------
app.whenReady().then(() => {
  // imgv://f/<encoded path>  -> image files     imgv://t/<name> -> history thumbnails
  protocol.handle('imgv', async (req) => {
    const u = new URL(req.url);
    let file;
    if (u.host === 'f') file = decodeURIComponent(u.pathname.slice(1));
    else if (u.host === 't') file = path.join(THUMBS, path.basename(decodeURIComponent(u.pathname)));
    else return new Response('Not found', { status: 404 });
    if (u.host === 'f' && !isImage(file)) return new Response('Forbidden', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(res.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'no-cache');
      if (file.toLowerCase().endsWith('.svg')) headers.set('Content-Type', 'image/svg+xml');
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();

  // Register with Windows (shows up in "Open with" and Default apps) and keep that
  // registration pointing at this exe, e.g. after an update moved it.
  if (process.platform === 'win32' && app.isPackaged && settings.registeredExe !== process.execPath) {
    winreg.register(process.execPath).then((r) => { if (r.ok) { settings.registeredExe = process.execPath; saveSettings(); } });
  }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (decoder) decoder.kill(); });
