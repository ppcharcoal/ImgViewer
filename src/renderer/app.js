'use strict';
/* global iv, hydrateIcons, icon */

const $ = (s) => document.querySelector(s);
const body = document.body;

const state = {
  mode: 'home',
  info: null,
  settings: {},
  list: [],          // image paths in the current folder
  index: -1,
  current: null,     // { path, el, w, h, dispose, stat }
  token: 0,
  history: [],
};

// ---------------------------------------------------------------- helpers
const basename = (p) => p.split(/[\\/]/).pop();
const dirname = (p) => { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i > 0 ? p.slice(0, i) : p; };
const extOf = (p) => { const m = /\.[^.\\/]+$/.exec(p); return m ? m[0].toLowerCase() : ''; };
const fileUrl = (p, v) => 'imgv://f/' + encodeURIComponent(p) + (v ? `?v=${Math.round(v)}` : '');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)} h ago`;
  const d = h / 24; if (d < 2) return 'yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

function toast(msg, ms = 1800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

function setMode(mode) {
  state.mode = mode;
  body.classList.toggle('mode-home', mode === 'home');
  body.classList.toggle('mode-viewer', mode === 'viewer');
  if (mode === 'home') {
    iv.setTitle('ImgViewer');
    renderHome();
  }
}

// ---------------------------------------------------------------- home
async function renderHome() {
  state.history = await iv.historyGet();
  const has = state.history.length > 0;
  $('#empty').hidden = has;
  $('#recent').hidden = !has;
  updateHistoryText();
  if (!has) return;
  $('#recent-sub').textContent = `${state.history.length} ${state.history.length === 1 ? 'image' : 'images'} opened recently`;
  const grid = $('#grid');
  grid.textContent = '';
  state.history.forEach((h, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.tabIndex = 0;
    card.style.animationDelay = `${Math.min(i, 16) * 22}ms`;
    card.title = h.path;
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (h.thumbUrl) thumb.style.backgroundImage = `url("${h.thumbUrl}")`;
    else thumb.innerHTML = icon('image').replace('<svg', '<svg class="ic"');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = h.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${basename(h.folder) || h.folder} · ${ago(h.openedAt)}`;
    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.title = 'Remove from recent';
    rm.innerHTML = icon('close').replace('<svg', '<svg class="ic"');
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      await iv.historyRemove(h.path);
      renderHome();
    });
    card.append(thumb, name, meta, rm);
    card.addEventListener('click', () => openFile(h.path, { record: true }));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openFile(h.path, { record: true }); });
    grid.appendChild(card);
  });
}

function updateHistoryText() {
  const n = state.history.length;
  $('#history-text').textContent = n ? `${n} ${n === 1 ? 'image' : 'images'} in your history.` : 'Nothing yet.';
}

async function clearHistory() {
  await iv.historyClear();
  toast('Recent files cleared');
  if (state.mode === 'home') renderHome();
  else { state.history = []; updateHistoryText(); }
}

// ---------------------------------------------------------------- image loading
const cache = new Map(); // path -> Promise<loaded>

function loadImage(path, stat) {
  const key = path + '|' + (stat && stat.mtime);
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    if (stat && stat.native) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.draggable = false;
      img.src = fileUrl(path, stat.mtime);
      await img.decode();
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { w = 1024; h = 1024; }
      return { el: img, w, h, alpha: hasAlpha(path), dispose() {} };
    }
    const r = await iv.decode(path);
    if (r.kind === 'blob') {
      const url = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
      const img = new Image();
      img.decoding = 'async';
      img.draggable = false;
      img.src = url;
      await img.decode();
      return { el: img, w: img.naturalWidth, h: img.naturalHeight, alpha: false, dispose() { URL.revokeObjectURL(url); } };
    }
    const c = document.createElement('canvas');
    c.width = r.width;
    c.height = r.height;
    const data = new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    c.getContext('2d').putImageData(new ImageData(data, r.width, r.height), 0, 0);
    return { el: c, w: r.width, h: r.height, alpha: true, dispose() { c.width = c.height = 0; } };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  // keep the cache small
  while (cache.size > 5) {
    const [k, v] = cache.entries().next().value;
    if (state.current && k.startsWith(state.current.path + '|')) { cache.delete(k); cache.set(k, v); break; }
    cache.delete(k);
    v.then((x) => { if (!state.current || x.el !== state.current.el) x.dispose(); }).catch(() => {});
  }
  return p;
}

function hasAlpha(path) {
  return ['.png', '.apng', '.gif', '.webp', '.avif', '.svg', '.ico', '.cur'].includes(extOf(path));
}

// ---------------------------------------------------------------- open / navigate
async function openFile(path, { record = true } = {}) {
  closeMenus();
  const stat = await iv.stat(path);
  if (!stat.exists) {
    toast("That file isn't there anymore");
    await iv.historyRemove(path);
    if (state.mode === 'home') renderHome();
    return;
  }
  setMode('viewer');
  state.list = [path];
  state.index = 0;
  updateNav();
  await show(path, { record, stat });
  // the folder listing can be slow on huge folders, so it comes after the first paint
  refreshFolder(path);
}

async function refreshFolder(keepPath) {
  const p = keepPath || (state.current && state.current.path);
  if (!p) return;
  const list = await iv.listFolder(p);
  if (state.current && state.current.path !== p && !keepPath) return;
  let i = list.findIndex((x) => x.toLowerCase() === p.toLowerCase());
  if (i < 0) {
    // the current file vanished (deleted/renamed outside): stay put, show nearest
    if (!list.length) { state.list = [p]; state.index = 0; updateNav(); return; }
    state.list = list;
    state.index = Math.min(state.index, list.length - 1);
    updateNav();
    show(list[state.index], { record: false });
    return;
  }
  state.list = list;
  state.index = i;
  updateNav();
  preloadNeighbours();
}

function go(delta) {
  if (state.mode !== 'viewer' || state.list.length < 2) return;
  let i = state.index + delta;
  if (i < 0) i = state.list.length - 1;          // wrap around
  if (i >= state.list.length) i = 0;
  goTo(i);
}

function goTo(i) {
  if (i === state.index || i < 0 || i >= state.list.length) return;
  state.index = i;
  updateNav();
  show(state.list[i], { record: false });
}

function updateNav() {
  const n = state.list.length;
  const many = n > 1;
  $('#btn-prev').disabled = !many;
  $('#btn-next').disabled = !many;
  $('#tb-prev').disabled = !many;
  $('#tb-next').disabled = !many;
  $('#tb-count').textContent = n > 1 ? `${state.index + 1} / ${n}` : '';
}

async function preloadNeighbours() {
  const n = state.list.length;
  if (n < 2) return;
  for (const d of [1, -1]) {
    const p = state.list[(state.index + d + n) % n];
    const st = await iv.stat(p);
    if (st.exists && st.native) loadImage(p, st).catch(() => {});
  }
}

async function show(path, { record = false, stat = null } = {}) {
  const token = ++state.token;
  stat = stat || await iv.stat(path);
  if (token !== state.token) return;

  $('#tb-name').textContent = basename(path);
  $('#tb-meta').textContent = stat.exists ? fmtBytes(stat.size) : '';
  iv.setTitle(`${basename(path)} — ImgViewer`);
  $('#error').hidden = true;

  const spinTimer = setTimeout(() => { if (token === state.token) $('#spinner').hidden = false; }, 180);
  let loaded;
  try {
    if (!stat.exists) throw new Error('The file could not be found.');
    if (!stat.supported) throw new Error('This file type is not supported.');
    loaded = await loadImage(path, stat);
  } catch (err) {
    clearTimeout(spinTimer);
    if (token !== state.token) return;
    $('#spinner').hidden = true;
    removeCurrent();
    state.current = { path, el: null, w: 0, h: 0, stat };
    $('#error-text').textContent = `${basename(path)} — ${friendlyError(err)}`;
    $('#error').hidden = false;
    $('#tb-zoom').textContent = '—';
    return;
  }
  clearTimeout(spinTimer);
  if (token !== state.token) return;
  $('#spinner').hidden = true;

  const prev = state.current;
  const el = loaded.el;
  el.className = 'pic';
  el.classList.toggle('alpha', !!loaded.alpha);
  $('#stage').appendChild(el);
  state.current = { path, el, w: loaded.w, h: loaded.h, stat, dispose: loaded.dispose };
  $('#tb-meta').textContent = `${loaded.w} × ${loaded.h}  ·  ${fmtBytes(stat.size)}`;

  view.reset();
  requestAnimationFrame(() => el.classList.add('in'));
  if (prev && prev.el && prev.el !== el) {
    const old = prev.el;
    old.classList.remove('in');
    setTimeout(() => { if (!state.current || state.current.el !== old) old.remove(); }, 170);
  }

  if (record) {
    // a little later, so it never competes with showing the picture
    setTimeout(() => recordHistory(path, el, loaded.w, loaded.h), 250);
  }
  preloadNeighbours();
}

function removeCurrent() {
  if (state.current && state.current.el) state.current.el.remove();
}

function friendlyError(err) {
  const m = String((err && err.message) || err || '');
  if (/EncodingError|decode|source image cannot be decoded/i.test(m)) return 'the file seems to be damaged or in a format that can\'t be read.';
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'unknown error.';
}

function makeThumb(el, w, h, max = 360) {
  try {
    const tw = max, th = Math.round(max * 3 / 4);
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#17141f';
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingQuality = 'high';
    const s = Math.max(tw / w, th / h);
    const dw = w * s, dh = h * s;
    ctx.drawImage(el, (tw - dw) / 2, (th - dh) / 2, dw, dh);
    return c.toDataURL('image/jpeg', 0.82);
  } catch { return null; }
}

async function recordHistory(path, el, w, h) {
  await iv.historyAdd({ path, width: w, height: h, thumb: makeThumb(el, w, h) });
  state.history = await iv.historyGet();
  updateHistoryText();
}

// ---------------------------------------------------------------- smooth zoom & pan
// The picture is positioned by its centre (cx, cy) and scale s. Zooming moves a
// target state; every frame the shown state eases toward it. Because s and the
// centre are interpolated linearly together, the point under the cursor stays put.
const view = (() => {
  const stage = $('#stage');
  const cur = { s: 1, cx: 0, cy: 0, r: 0 };
  const tgt = { s: 1, cx: 0, cy: 0, r: 0 };
  let rot = 0;          // target rotation in quarter turns (can go past 3)
  let fitMode = true;
  let raf = 0, last = 0;
  const MAX = 40;

  const vw = () => stage.clientWidth;
  const vh = () => stage.clientHeight;
  const img = () => state.current && state.current.el ? state.current : null;
  const dims = () => { const c = img(); if (!c) return [1, 1]; return rot % 2 ? [c.h, c.w] : [c.w, c.h]; };
  const fitScale = () => { const [w, h] = dims(); return Math.min(vw() / w, vh() / h, 1); };
  const minScale = () => Math.min(fitScale(), 1) * 0.5;

  function constrain(t) {
    const [w, h] = dims();
    const W = w * t.s, H = h * t.s;
    t.cx = W <= vw() ? vw() / 2 : clamp(t.cx, vw() - W / 2, W / 2);
    t.cy = H <= vh() ? vh() / 2 : clamp(t.cy, vh() - H / 2, H / 2);
  }

  function apply() {
    const c = img();
    if (!c) return;
    c.el.style.transform = `translate(${cur.cx}px, ${cur.cy}px) scale(${cur.s}) rotate(${cur.r}deg) translate(${-c.w / 2}px, ${-c.h / 2}px)`;
    c.el.classList.toggle('pixel', cur.s >= 3);
    const [w, h] = dims();
    stage.classList.toggle('can-pan', w * tgt.s > vw() + 1 || h * tgt.s > vh() + 1);
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const k = 1 - Math.exp(-dt / 0.075);
    cur.s += (tgt.s - cur.s) * k;
    cur.cx += (tgt.cx - cur.cx) * k;
    cur.cy += (tgt.cy - cur.cy) * k;
    cur.r += (tgt.r - cur.r) * k;
    const done = Math.abs(tgt.s - cur.s) < tgt.s * 1e-4 && Math.abs(tgt.cx - cur.cx) < 0.1 && Math.abs(tgt.cy - cur.cy) < 0.1 && Math.abs(tgt.r - cur.r) < 0.05;
    if (done) Object.assign(cur, tgt);
    apply();
    if (done) {
      raf = 0;
      const c = img();
      if (c) c.el.classList.remove('moving'); // lets Chromium re-render crisply at rest
    } else raf = requestAnimationFrame(tick);
  }

  function animate() {
    const c = img();
    if (c) c.el.classList.add('moving');
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    updateLabel();
  }

  function jump() { Object.assign(cur, tgt); apply(); updateLabel(); }

  function updateLabel() {
    $('#tb-zoom').textContent = img() ? `${Math.round(tgt.s * 100)}%` : '—';
  }

  let popTimer = 0;
  function flashZoom() {
    let pop = $('#zoom-pop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'zoom-pop';
      pop.className = 'zoom-pop';
      $('#viewer').appendChild(pop);
    }
    pop.textContent = `${Math.round(tgt.s * 100)}%`;
    pop.classList.add('on');
    clearTimeout(popTimer);
    popTimer = setTimeout(() => pop.classList.remove('on'), 700);
  }

  function setScale(ns, px = vw() / 2, py = vh() / 2, { animated = true } = {}) {
    if (!img()) return;
    ns = clamp(ns, minScale(), MAX);
    const f = ns / tgt.s;
    tgt.cx = px - (px - tgt.cx) * f;
    tgt.cy = py - (py - tgt.cy) * f;
    tgt.s = ns;
    constrain(tgt);
    fitMode = Math.abs(ns - fitScale()) < 1e-3;
    animated ? animate() : jump();
    flashZoom();
  }

  return {
    reset() {
      rot = 0;
      tgt.r = cur.r = 0;
      fitMode = true;
      tgt.s = fitScale();
      tgt.cx = vw() / 2; tgt.cy = vh() / 2;
      jump();
    },
    fit(animated = true) {
      fitMode = true;
      tgt.s = fitScale();
      tgt.cx = vw() / 2; tgt.cy = vh() / 2;
      animated ? animate() : jump();
    },
    resize() {
      if (!img()) return;
      if (fitMode) { this.fit(false); return; }
      constrain(tgt); jump();
    },
    zoomBy(f, px, py, animated = true) { setScale(tgt.s * f, px, py, { animated }); },
    zoomTo(s, px, py) { setScale(s, px, py); },
    toggleActual(px, py) {
      if (!img()) return;
      const fs = fitScale();
      if (!fitMode || Math.abs(fs - 1) < 1e-3) {
        if (Math.abs(tgt.s - fs) < 1e-3) setScale(Math.max(1, fs * 2.5), px, py); // tiny image: zoom in
        else this.fit();
      } else setScale(1, px, py);
    },
    toggleFit() { fitMode && img() ? setScale(1) : this.fit(); },
    rotate(dir = 1) {
      if (!img()) return;
      rot += dir;
      tgt.r = rot * 90;
      if (fitMode) { tgt.s = fitScale(); tgt.cx = vw() / 2; tgt.cy = vh() / 2; } else constrain(tgt);
      animate();
    },
    panBy(dx, dy) {
      tgt.cx += dx; tgt.cy += dy;
      constrain(tgt);
      cur.cx = tgt.cx; cur.cy = tgt.cy; cur.s = tgt.s;
      apply();
    },
    pinch(f, px, py) { setScale(tgt.s * f, px, py, { animated: false }); },
    canPan() { const [w, h] = dims(); return w * tgt.s > vw() + 1 || h * tgt.s > vh() + 1; },
    get scale() { return tgt.s; },
    get rotation() { return rot; },
  };
})();

// ---------------------------------------------------------------- stage input
(() => {
  const stage = $('#stage');
  const pointers = new Map();
  let drag = null;
  let pinchLast = null;

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!state.current || !state.current.el) return;
    const r = stage.getBoundingClientRect();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 33;
    else if (e.deltaMode === 2) dy *= r.height;
    // trackpad pinch arrives as ctrl+wheel with small deltas
    const k = e.ctrlKey ? 0.012 : 0.0022;
    const f = Math.exp(clamp(-dy * k, -0.9, 0.9));
    view.zoomBy(f, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  stage.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect();
    view.toggleActual(e.clientX - r.left, e.clientY - r.top);
  });

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    closeMenus();
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, pan: view.canPan(), moved: false };
      if (drag.pan) stage.classList.add('panning');
    } else {
      drag = null;
      pinchLast = null;
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = stage.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      if (pinchLast) {
        view.panBy(mx - pinchLast.mx, my - pinchLast.my);
        view.pinch(d / pinchLast.d, mx, my);
      }
      pinchLast = { d, mx, my };
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (Math.abs(e.clientX - drag.sx) > 3) drag.moved = true;
    if (drag.pan) view.panBy(dx, dy);
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchLast = null;
    if (drag && pointers.size === 0) {
      // swipe to change picture when it fits the window
      const dx = e.clientX - drag.sx;
      if (!drag.pan && Math.abs(dx) > 70 && e.pointerType !== 'mouse') go(dx < 0 ? 1 : -1);
      drag = null;
    }
    stage.classList.remove('panning');
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // mouse back/forward buttons browse the folder
  window.addEventListener('mouseup', (e) => {
    if (state.mode !== 'viewer') return;
    if (e.button === 3) { e.preventDefault(); go(-1); }
    if (e.button === 4) { e.preventDefault(); go(1); }
  });

  // side arrows appear when the mouse is near an edge
  const viewer = $('#viewer');
  viewer.addEventListener('mousemove', (e) => {
    const r = viewer.getBoundingClientRect();
    const x = e.clientX - r.left;
    viewer.classList.toggle('show-prev', x < Math.max(120, r.width * 0.14));
    viewer.classList.toggle('show-next', x > r.width - Math.max(120, r.width * 0.14));
  });
  viewer.addEventListener('mouseleave', () => viewer.classList.remove('show-prev', 'show-next'));

  new ResizeObserver(() => view.resize()).observe(stage);
})();

// hide the toolbar when the mouse rests
(() => {
  let t = 0;
  const wake = () => {
    body.classList.remove('idle');
    clearTimeout(t);
    t = setTimeout(() => {
      if (state.mode === 'viewer' && !document.querySelector('.toolbar:hover, .menu:not([hidden]), .nav:hover')) body.classList.add('idle');
    }, 2400);
  };
  window.addEventListener('mousemove', wake);
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  wake();
})();

// ---------------------------------------------------------------- actions
async function copyImage() {
  const c = state.current;
  if (!c || !c.el) return;
  try {
    let canvas = c.el;
    if (!(canvas instanceof HTMLCanvasElement)) {
      canvas = document.createElement('canvas');
      canvas.width = c.w; canvas.height = c.h;
      canvas.getContext('2d').drawImage(c.el, 0, 0, c.w, c.h);
    }
    await iv.copyImage(canvas.toDataURL('image/png'));
    toast('Image copied');
  } catch {
    toast("Couldn't copy this image");
  }
}

async function deleteCurrent() {
  const c = state.current;
  if (!c) return;
  const ok = await iv.trash(c.path);
  if (!ok) return;
  toast('Moved to Recycle Bin');
  const list = state.list.filter((p) => p !== c.path);
  await iv.historyRemove(c.path);
  if (!list.length) {
    removeCurrent();
    state.current = null;
    setMode('home');
    return;
  }
  state.list = list;
  state.index = Math.min(state.index, list.length - 1);
  updateNav();
  show(list[state.index], { record: false });
}

async function openDialog() {
  const f = await iv.openDialog();
  if (f) openFile(f, { record: true });
}

function goHome() {
  closeMenus();
  if (body.classList.contains('fullscreen')) iv.fullscreen(false);
  setMode('home');
  removeCurrent();
  state.current = null;
  state.token++;
}

function closeMenus() {
  $('#more-menu').hidden = true;
}

function toggleMore() {
  const m = $('#more-menu');
  if (!m.hidden) { m.hidden = true; return; }
  const b = $('#tb-more').getBoundingClientRect();
  const v = $('#viewer').getBoundingClientRect();
  m.hidden = false;
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = `${clamp(b.left + b.width / 2 - mw / 2 - v.left, 8, v.width - mw - 8)}px`;
  m.style.top = `${b.top - v.top - mh - 10}px`;
}

$('#more-menu').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !state.current) return;
  closeMenus();
  const act = b.dataset.act;
  if (act === 'folder') iv.showInFolder(state.current.path);
  if (act === 'copy') copyImage();
  if (act === 'copy-path') { iv.copyText(state.current.path); toast('Path copied'); }
  if (act === 'delete') deleteCurrent();
});

document.querySelectorAll('.js-open').forEach((b) => b.addEventListener('click', openDialog));
$('#btn-clear').addEventListener('click', clearHistory);
$('#btn-clear-2').addEventListener('click', clearHistory);
$('#btn-home').addEventListener('click', goHome);
$('#btn-prev').addEventListener('click', () => go(-1));
$('#btn-next').addEventListener('click', () => go(1));
$('#tb-prev').addEventListener('click', () => go(-1));
$('#tb-next').addEventListener('click', () => go(1));
$('#tb-zoom-in').addEventListener('click', () => view.zoomBy(1.35));
$('#tb-zoom-out').addEventListener('click', () => view.zoomBy(1 / 1.35));
$('#tb-zoom').addEventListener('click', () => view.toggleFit());
$('#tb-fit').addEventListener('click', () => view.fit());
$('#tb-rotate').addEventListener('click', () => view.rotate(1));
$('#tb-full').addEventListener('click', () => iv.fullscreen());
$('#tb-more').addEventListener('click', (e) => { e.stopPropagation(); toggleMore(); });
document.addEventListener('click', (e) => { if (!e.target.closest('#more-menu, #tb-more')) closeMenus(); });

iv.onFullscreen((on) => {
  body.classList.toggle('fullscreen', on);
  const b = $('#tb-full');
  b.dataset.icon = on ? 'shrink' : 'expand';
  b.title = on ? 'Exit full screen (F11)' : 'Full screen (F11)';
  hydrateIcons(b.parentElement);
});
iv.onOpenFile((f) => openFile(f, { record: true }));
iv.onFocus(() => { if (state.mode === 'viewer') refreshFolder(); else renderHome(); });

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', (e) => {
  if (!$('#setup').hidden) return;
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;

  if (!$('#settings').hidden) { if (k === 'Escape') closeSettings(); return; }
  if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); openDialog(); return; }
  if (k === 'F11') { e.preventDefault(); iv.fullscreen(); return; }
  if (state.mode !== 'viewer') return;

  if (ctrl && k.toLowerCase() === 'c') { e.preventDefault(); copyImage(); return; }
  if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); view.zoomBy(1.35); return; }
  if (ctrl && k === '-') { e.preventDefault(); view.zoomBy(1 / 1.35); return; }
  if (ctrl && k === '0') { e.preventDefault(); view.fit(); return; }
  if (ctrl) return;

  switch (k) {
    case 'ArrowRight': case 'PageDown': case ' ': e.preventDefault(); go(1); break;
    case 'ArrowLeft': case 'PageUp': case 'Backspace': e.preventDefault(); go(-1); break;
    case 'ArrowUp': e.preventDefault(); view.canPan() ? view.panBy(0, 80) : null; break;
    case 'ArrowDown': e.preventDefault(); view.canPan() ? view.panBy(0, -80) : null; break;
    case 'Home': goTo(0); break;
    case 'End': goTo(state.list.length - 1); break;
    case '+': case '=': view.zoomBy(1.35); break;
    case '-': case '_': view.zoomBy(1 / 1.35); break;
    case '0': view.fit(); break;
    case '1': view.zoomTo(1); break;
    case 'r': view.rotate(1); break;
    case 'R': view.rotate(-1); break;
    case 'f': case 'F': iv.fullscreen(); break;
    case 'Delete': deleteCurrent(); break;
    case 'Escape':
      if (!$('#more-menu').hidden) closeMenus();
      else if (body.classList.contains('fullscreen')) iv.fullscreen(false);
      else goHome();
      break;
    default:
  }
});

// ---------------------------------------------------------------- drag & drop
(() => {
  let depth = 0;
  const drop = $('#drop');
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer.types || [])].includes('Files')) return;
    depth++;
    drop.hidden = false;
  });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const p = iv.pathForFile(f);
    if (p) openFile(p, { record: true });
  });
})();

// ---------------------------------------------------------------- settings
async function openSettings() {
  $('#settings').hidden = false;
  const st = await iv.defaultStatus();
  const row = $('#row-default');
  row.hidden = !st.windows;
  const btn = $('#btn-make-default');
  if (st.isDefault) {
    $('#default-text').textContent = 'ImgViewer opens your photos. Nice.';
    btn.textContent = 'Default ✓';
    btn.classList.add('done');
  } else {
    $('#default-text').textContent = 'Open photos with ImgViewer when you double-click them.';
    btn.textContent = 'Make default';
    btn.classList.remove('done');
  }
  updateHistoryText();
}
function closeSettings() { $('#settings').hidden = true; }

$('#btn-settings').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });
$('#btn-make-default').addEventListener('click', async () => {
  const r = await iv.makeDefault();
  if (!r.ok) toast("Couldn't register with Windows");
  else toast('Choose "Set default" in the window that opened', 3500);
});
$('#btn-setup-again').addEventListener('click', () => { closeSettings(); runSetup(); });

// ---------------------------------------------------------------- first-run setup
function runSetup() {
  const wrap = $('#setup');
  const windows = state.info.platform === 'win32';
  const steps = ['welcome', ...(windows ? ['default'] : []), 'tips'];
  let at = 0;
  let poll = 0;
  const dots = $('#setup-dots');
  dots.innerHTML = steps.map(() => '<i></i>').join('');

  const showStep = () => {
    wrap.querySelectorAll('.setup-step').forEach((s) => { s.hidden = s.dataset.step !== steps[at]; });
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === at));
  };
  const next = () => { clearInterval(poll); if (at < steps.length - 1) { at++; showStep(); } };
  const finish = async () => {
    clearInterval(poll);
    wrap.hidden = true;
    state.settings = await iv.settingsSet({ setupDone: true });
  };

  wrap.querySelectorAll('[data-next]').forEach((b) => { b.onclick = next; });
  wrap.querySelectorAll('[data-finish]').forEach((b) => { b.onclick = finish; });

  const status = $('#setup-status');
  const setStatus = (cls, html) => { status.hidden = false; status.className = 'setup-status ' + cls; status.innerHTML = html; };
  status.hidden = true;
  const makeBtn = $('#setup-make-default');
  makeBtn.textContent = 'Make ImgViewer default';
  makeBtn.onclick = async () => {
    makeBtn.disabled = true;
    const r = await iv.makeDefault();
    makeBtn.disabled = false;
    if (!r.ok) { setStatus('err', "Windows didn't accept the registration. You can try again from Settings later."); return; }
    setStatus('', '<span class="mini-spin"></span>Waiting for you to click <b>&nbsp;Set default&nbsp;</b> in Windows…');
    makeBtn.textContent = 'Open Default apps again';
    let tries = 0;
    clearInterval(poll);
    poll = setInterval(async () => {
      tries++;
      const st = await iv.defaultStatus();
      if (st.isDefault) {
        clearInterval(poll);
        setStatus('ok', `${icon('check').replace('<svg', '<svg class="ic"')} ImgViewer is now your default viewer`);
        setTimeout(next, 1100);
      } else if (tries > 120) clearInterval(poll);
    }, 1500);
  };

  wrap.hidden = false;
  showStep();
}

// ---------------------------------------------------------------- boot
(async () => {
  hydrateIcons();
  state.info = await iv.info();
  state.settings = await iv.settingsGet();
  $('#about').textContent = `ImgViewer ${state.info.version}`;
  $('#formats').textContent = 'JPG · PNG · WebP · AVIF · GIF · HEIC · TIFF · JPEG XL · SVG · BMP · ICO · RAW';

  const first = await iv.initialFile();
  if (first) await openFile(first, { record: true });
  else setMode('home');

  if (!state.settings.setupDone) runSetup();
})();
