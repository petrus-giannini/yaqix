/*
 * yaqix — yet another qix
 * Copyright (C) 2026 Pietro
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

(() => {
'use strict';

/* =====================================================================
   Costanti e riferimenti
   ===================================================================== */
const GW = 80, GH = 100, N = GW * GH;          // campo in celle logiche
const EMPTY = 0, CLAIMED = 1, TRAIL = 2;      // stati di una cella
const TARGET = 75;                            // percentuale da conquistare
const BORDER = 2 * GW + 2 * (GH - 2), INTERIOR = N - BORDER;
const I18N_URL = 'i18n.json';

const grid = new Uint8Array(N);   // stato della cella
const fc = new Uint8Array(N);     // colore di riempimento: 1 linea, 2 veloce, 3 lento
const edge = new Uint8Array(N);   // 1 se cella conquistata adiacente al vuoto (percorribile)
const mark = new Uint8Array(N);   // appoggio per flood fill e BFS

const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage'), overlay = $('overlay');
const pad = $('pad'), knob = $('knob'), slowBtn = $('slow');
const field = document.createElement('canvas'); field.width = GW; field.height = GH;
const fctx = field.getContext('2d'), fimg = fctx.createImageData(GW, GH);
let S = 4; // pixel per cella sul canvas visibile

/* =====================================================================
   Memoria locale (con lettura delle chiavi della versione precedente)
   ===================================================================== */
const store = {
  get(k, d) {
    try {
      let v = localStorage.getItem('yaqix.' + k);
      if (v == null) v = localStorage.getItem('recinto75.' + k);
      return v == null ? d : v;
    } catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem('yaqix.' + k, v); } catch (e) {} }
};

/* =====================================================================
   Traduzioni
   ===================================================================== */
const i18n = { data: null, lang: 'it' };

function pickLanguage(data) {
  const langs = Object.keys(data.languages);
  const saved = store.get('lang', null);
  if (saved && langs.includes(saved)) return saved;
  const nav = (navigator.languages || [navigator.language || '']).map(l => String(l).slice(0, 2).toLowerCase());
  for (const l of nav) if (langs.includes(l)) return l;
  return data.default || langs[0];
}
/** Restituisce il lemma tradotto, con sostituzione dei segnaposto {nome}. */
function t(key, vars) {
  const entry = i18n.data && i18n.data.strings[key];
  let s = entry ? (entry[i18n.lang] ?? entry[i18n.data.default] ?? key) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
const locale = () => (i18n.data && i18n.data.languages[i18n.lang].locale) || 'it-IT';
const fmt = n => Number(n).toLocaleString(locale());
const fmtPct = n => n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Aggiorna i testi statici dell'HTML marcati con data-i18n e data-i18n-aria. */
function applyStatic() {
  document.documentElement.lang = i18n.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  $('lang').textContent = i18n.data.languages[i18n.lang].short;
  for (const k in hudCache) delete hudCache[k]; // forza il ridisegno dei numeri con il nuovo formato
}
function setLang(l) {
  if (!i18n.data || !i18n.data.languages[l] || l === i18n.lang) return;
  i18n.lang = l; store.set('lang', l);
  applyStatic();
  if (!overlay.hidden && overlayKind) showOverlay(overlayKind);
}
function nextLang() {
  const langs = Object.keys(i18n.data.languages);
  setLang(langs[(langs.indexOf(i18n.lang) + 1) % langs.length]);
  toast(t('toast.language'));
}

/* =====================================================================
   Stato di gioco
   ===================================================================== */
let hi = +store.get('hi', 0) || 0;
let muted = store.get('mute', '0') === '1';
const settings = {
  hand: store.get('hand', 'right') === 'left' ? 'left' : 'right',
  ctrl: store.get('ctrl', 'arrows') === 'stick' ? 'stick' : 'arrows'
};

let state = 'boot', level = 1, score = 0, lives = 3, mult = 1, splitDone = false;
let player, qixes = [], sparxs = [], popups = [];
let timer = 0, invuln = 0, time = 0, claimed = 0, newRecord = false;

/* =====================================================================
   Campo
   ===================================================================== */
const inb = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;
const cellAt = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  return inb(ix, iy) ? grid[iy * GW + ix] : CLAIMED;
};
const pct = () => (claimed - BORDER) / INTERIOR * 100;

function computeEdges() {
  edge.fill(0);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x;
    if (grid[i] !== CLAIMED) continue;
    outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inb(nx, ny) && grid[ny * GW + nx] === EMPTY) { edge[i] = 1; break outer; }
    }
  }
}

const C = {
  empty: [6, 7, 13], dot: [20, 24, 44], edge: [242, 244, 255], line: [96, 108, 170],
  f1: [34, 66, 170], f2: [40, 76, 190], s1: [176, 106, 20], s2: [196, 122, 30]
};
function redrawField() {
  const d = fimg.data;
  for (let i = 0; i < N; i++) {
    const x = i % GW, y = (i / GW) | 0, k = i * 4;
    let c;
    if (grid[i] !== CLAIMED) c = (x % 5 === 2 && y % 5 === 2) ? C.dot : C.empty;
    else if (edge[i]) c = C.edge;
    else if (fc[i] === 1) c = C.line;
    else if (fc[i] === 2) c = (x + y) & 1 ? C.f1 : C.f2;
    else c = (x + y) & 1 ? C.s1 : C.s2;
    d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
  }
  fctx.putImageData(fimg, 0, 0);
}

function neighbours(i) {
  const x = i % GW;
  return [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, i - GW, i + GW];
}
/** Marca in `mark` tutte le celle vuote raggiungibili da `seed`. */
function flood(seed) {
  if (grid[seed] !== EMPTY || mark[seed]) return;
  const st = [seed]; mark[seed] = 1;
  while (st.length) {
    const i = st.pop();
    for (const j of neighbours(i)) if (j >= 0 && j < N && grid[j] === EMPTY && !mark[j]) { mark[j] = 1; st.push(j); }
  }
}
/** Cella di bordo percorribile più vicina a `start` (BFS). */
function nearestEdge(start) {
  mark.fill(0);
  const q = new Int32Array(N);
  let h = 0, tl = 0;
  q[tl++] = start; mark[start] = 1;
  while (h < tl) {
    const i = q[h++];
    if (grid[i] === CLAIMED && edge[i]) return i;
    for (const j of neighbours(i)) if (j >= 0 && j < N && !mark[j]) { mark[j] = 1; q[tl++] = j; }
  }
  return start;
}

/* =====================================================================
   Livello
   ===================================================================== */
function setupLevel() {
  grid.fill(EMPTY); fc.fill(0);
  const claim = (x, y) => { const i = y * GW + x; grid[i] = CLAIMED; fc[i] = 1; };
  for (let x = 0; x < GW; x++) { claim(x, 0); claim(x, GH - 1); }
  for (let y = 1; y < GH - 1; y++) { claim(0, y); claim(GW - 1, y); }
  claimed = BORDER;
  computeEdges(); redrawField();
  player = { x: GW >> 1, y: GH - 1, drawing: false, trail: [], tslow: [], start: 0, allSlow: true, acc: 0, still: 0, fuse: -1 };
  const nq = level >= 3 ? 2 : 1;
  qixes = [];
  for (let k = 0; k < nq; k++) qixes.push(makeQix(GW * (k + 1) / (nq + 1) + 0.5, GH * 0.38 + 0.5));
  spawnSparx();
  mult = 1; splitDone = false; invuln = 1; popups = [];
}
function makeQix(x, y) {
  return { x, y, vx: 0, vy: 0, sp: Math.min(9 + level * 1.3, 22), ang: Math.random() * 6.28, angV: 2,
           len: 8, lenT: 8, t: 0, hist: [], ht: 0 };
}
function spawnSparx() {
  const n = Math.min(2 + Math.floor((level - 1) / 2), 4);
  let best = -1, bi = 0;
  for (let i = 0; i < N; i++) if (edge[i]) {
    const dd = Math.abs(i % GW - player.x) + Math.abs(((i / GW) | 0) - player.y);
    if (dd > best) { best = dd; bi = i; }
  }
  sparxs = [];
  for (let k = 0; k < n; k++) sparxs.push({
    x: bi % GW, y: (bi / GW) | 0, d: k % 2 ? 0 : 2, h: k % 2 ? 1 : -1,
    acc: 0, sp: Math.min(11 + level * 1.2, 21), recent: [], wait: 0.6 + k * 0.9
  });
}

/* =====================================================================
   Giocatore
   ===================================================================== */
function tryStep(dx, dy) {
  const p = player, nx = p.x + dx, ny = p.y + dy;
  if (!inb(nx, ny)) return false;
  const n = ny * GW + nx, c = grid[n];
  if (!p.drawing) {
    if (c === CLAIMED) { if (!edge[n]) return false; p.x = nx; p.y = ny; return true; }
    if (c === EMPTY) {
      p.drawing = true; p.start = p.y * GW + p.x; p.trail = []; p.tslow = []; p.allSlow = true;
      return addTrail(n, nx, ny);
    }
    return false;
  }
  if (c === EMPTY) return addTrail(n, nx, ny);
  if (c === CLAIMED) { p.x = nx; p.y = ny; closeTrail(); return false; }
  return false; // la propria linea blocca il passo
}
function addTrail(n, nx, ny) {
  const p = player;
  grid[n] = TRAIL; p.trail.push(n); p.tslow.push(input.slow);
  if (!input.slow) p.allSlow = false;
  p.x = nx; p.y = ny;
  for (const q of qixes) if (Math.floor(q.x) === nx && Math.floor(q.y) === ny) { die(); return false; }
  return true;
}
function closeTrail() {
  const p = player;
  for (const c of p.trail) { grid[c] = CLAIMED; fc[c] = 1; }
  let added = p.trail.length;
  // le regioni che contengono un Qix restano libere, le altre vengono conquistate
  mark.fill(0);
  const cellOf = q => Math.floor(q.y) * GW + Math.floor(q.x);
  flood(cellOf(qixes[0]));
  let split = false;
  for (let k = 1; k < qixes.length; k++) {
    const c = cellOf(qixes[k]);
    if (!mark[c]) { split = true; flood(c); }
  }
  const col = p.allSlow ? 3 : 2;
  for (let i = 0; i < N; i++) if (grid[i] === EMPTY && !mark[i]) { grid[i] = CLAIMED; fc[i] = col; added++; }
  claimed += added;
  if (split && !splitDone) { splitDone = true; mult = 2; toast(t('toast.split')); }
  const pts = Math.round(added * (p.allSlow ? 20 : 10) * mult);
  score += pts;
  popups.push({ x: p.x, y: p.y, text: '+' + fmt(pts), t: 1.2, slow: p.allSlow });
  p.drawing = false; p.trail = []; p.tslow = []; p.fuse = -1; p.still = 0;
  computeEdges(); redrawField();
  // riporta giocatore e scintille su un bordo valido
  const pi = p.y * GW + p.x;
  if (!edge[pi]) { const e = nearestEdge(pi); p.x = e % GW; p.y = (e / GW) | 0; }
  for (const s of sparxs) {
    const si = s.y * GW + s.x;
    if (!edge[si]) { const e = nearestEdge(si); s.x = e % GW; s.y = (e / GW) | 0; s.recent = []; }
  }
  tone(p.allSlow ? 330 : 440, 0.09, 'square', null, 0);
  tone(p.allSlow ? 495 : 660, 0.12, 'square', null, 0.07);
  if (pct() >= TARGET) levelClear();
}
function updatePlayer(dt) {
  const p = player, d = input.dir;
  if (d) {
    p.still = 0; p.fuse = -1;
    p.acc += (p.drawing ? (input.slow ? 10 : 20) : 24) * dt;
    while (p.acc >= 1 && state === 'play') {
      p.acc -= 1;
      if (!tryStep(d[0], d[1])) { p.acc = 0; break; }
    }
  } else {
    p.acc = 0;
    if (p.drawing) { // fermo a metà linea: parte la miccia
      p.still += dt;
      if (p.still > 0.45) {
        if (p.fuse < 0) p.fuse = 0;
        p.fuse += 16 * dt;
        if (p.fuse >= p.trail.length - 1) die();
      }
    }
  }
}

/* =====================================================================
   Nemici
   ===================================================================== */
function qixUpdate(q, dt) {
  q.t -= dt;
  if (q.t <= 0) {
    q.t = 0.4 + Math.random() * 1.2;
    const a = Math.random() * Math.PI * 2;
    q.vx = Math.cos(a) * q.sp; q.vy = Math.sin(a) * q.sp;
    q.angV = (Math.random() - 0.5) * 9; q.lenT = 5 + Math.random() * 14;
  }
  q.len += (q.lenT - q.len) * Math.min(1, dt * 3);
  q.ang += q.angV * dt;
  const steps = Math.max(1, Math.ceil(q.sp * dt / 0.4)), h = dt / steps;
  for (let k = 0; k < steps; k++) {
    let c = cellAt(q.x + q.vx * h, q.y);
    if (c !== EMPTY) { if (c === TRAIL) die(); q.vx = -q.vx; } else q.x += q.vx * h;
    c = cellAt(q.x, q.y + q.vy * h);
    if (c !== EMPTY) { if (c === TRAIL) die(); q.vy = -q.vy; } else q.y += q.vy * h;
  }
  const a = reach(q, -1), b = reach(q, 1);
  q.ht -= dt;
  if (q.ht <= 0) {
    q.ht = 1 / 40;
    q.hist.unshift([a[0], a[1], b[0], b[1]]);
    if (q.hist.length > 12) q.hist.pop();
  }
}
/** Estremo del segmento del Qix in una direzione, accorciato contro i muri. */
function reach(q, dir) {
  const cx = Math.cos(q.ang) * dir, cy = Math.sin(q.ang) * dir, L = q.len / 2;
  let r = 0;
  while (r < L) {
    const r2 = Math.min(L, r + 0.5), v = cellAt(q.x + cx * r2, q.y + cy * r2);
    if (v === TRAIL) { die(); break; }
    if (v !== EMPTY) break;
    r = r2;
  }
  return [q.x + cx * r, q.y + cy * r];
}
const okEdge = (x, y) => inb(x, y) && grid[y * GW + x] === CLAIMED && edge[y * GW + x] === 1;
function sparxStep(s) {
  let pick = -1;
  for (const d of [(s.d + s.h + 4) % 4, s.d, (s.d - s.h + 4) % 4]) {
    const nx = s.x + D[d][0], ny = s.y + D[d][1];
    if (okEdge(nx, ny) && !s.recent.includes(ny * GW + nx)) { pick = d; break; }
  }
  if (pick < 0) {
    let back = -1;
    for (let d = 0; d < 4; d++) {
      if (!okEdge(s.x + D[d][0], s.y + D[d][1])) continue;
      if (d === (s.d + 2) % 4) back = d; else { pick = d; break; }
    }
    if (pick < 0) pick = back;
  }
  if (pick < 0) return;
  s.recent.push(s.y * GW + s.x);
  if (s.recent.length > 6) s.recent.shift();
  s.d = pick; s.x += D[pick][0]; s.y += D[pick][1];
}
function updateSparx(dt) {
  for (const s of sparxs) {
    if (s.wait > 0) { s.wait -= dt; continue; }
    s.acc += s.sp * dt;
    while (s.acc >= 1) { s.acc -= 1; sparxStep(s); }
    if (!player.drawing && Math.abs(s.x - player.x) <= 1 && Math.abs(s.y - player.y) <= 1) die();
  }
}

/* =====================================================================
   Eventi di partita
   ===================================================================== */
function die() {
  if (state !== 'play' || invuln > 0) return;
  state = 'dying'; timer = 1.1;
  tone(520, 0.6, 'sawtooth', 60, 0, 0.07);
  try { navigator.vibrate && navigator.vibrate(120); } catch (e) {}
}
function afterDeath() {
  lives--;
  if (lives < 0) { gameOver(); return; }
  const p = player;
  if (p.drawing) {
    for (const c of p.trail) grid[c] = EMPTY;
    p.x = p.start % GW; p.y = (p.start / GW) | 0;
    p.drawing = false; p.trail = []; p.tslow = [];
  }
  p.fuse = -1; p.still = 0; p.acc = 0;
  spawnSparx(); invuln = 2; state = 'play';
}
function levelClear() {
  const bonus = Math.max(0, Math.floor(pct()) - TARGET) * 1000;
  score += bonus; state = 'clear'; timer = 2.4;
  toast(t('toast.cleared', { level }) + (bonus ? t('toast.bonus', { bonus: fmt(bonus) }) : ''));
  [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.16, 'square', null, k * 0.11));
}
function gameOver() {
  state = 'over'; newRecord = false;
  if (score > hi) { hi = score; newRecord = true; store.set('hi', String(hi)); }
  showOverlay('over');
}
function startGame() {
  audioInit();
  level = 1; score = 0; lives = 3;
  setupLevel(); state = 'play'; hideOverlay(); last = performance.now();
  requestWake();
}
function togglePause() {
  if (state === 'play') { state = 'paused'; showOverlay('pause'); }
  else if (state === 'paused') { state = 'play'; hideOverlay(); last = performance.now(); }
}

/* =====================================================================
   Interfaccia: avvisi e pannelli
   ===================================================================== */
let toastT = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2200);
}

let overlayKind = null, settingsFrom = 'title';
function hideOverlay() { overlay.hidden = true; overlayKind = null; }

/** Interruttore a due o più posizioni; `value` è il valore corrente. */
function segHtml(key, label, options, value, extraClass = '') {
  return `<div class="seg"><span class="lab">${esc(label)}</span><div class="opts ${extraClass}">` +
    options.map(([v, text]) => `<button data-k="${key}" data-v="${v}" aria-pressed="${v === value}">${esc(text)}</button>`).join('') +
    '</div></div>';
}
function langOptions() {
  return Object.entries(i18n.data.languages).map(([k, v]) => [k, v.name]);
}

function showOverlay(kind) {
  overlay.hidden = false; overlayKind = kind;
  if (kind === 'title') {
    const langMini = Object.entries(i18n.data.languages)
      .map(([k, v]) => `<button data-k="lang" data-v="${k}" aria-pressed="${k === i18n.lang}" aria-label="${esc(v.name)}">${esc(v.short)}</button>`).join('');
    overlay.innerHTML = `<div class="card">
      <div class="head"><h1>YAQ<span>IX</span></h1><div class="opts mini">${langMini}</div></div>
      <div class="tag">${esc(t('title.tagline'))}</div>
      <p>${esc(t('title.intro', { target: TARGET }))}</p>
      <ul>
        <li>${esc(t('title.rule.move'))}</li>
        <li class="s">${esc(t('title.rule.slow'))}</li>
        <li class="d">${esc(t('title.rule.danger'))}</li>
        <li class="g">${esc(t('title.rule.bonus'))}</li>
      </ul>
      <div class="row"><button class="cta" id="go">${esc(t('title.play'))}</button><button class="cta alt" id="set">${esc(t('title.settings'))}</button></div>
      <p class="fine">${esc(t('title.keys', { best: fmt(hi) }))}<br>${esc(t('title.license'))}</p>
    </div>`;
    $('go').onclick = startGame;
    $('set').onclick = openSettings;
  } else if (kind === 'pause') {
    overlay.innerHTML = `<div class="card"><h2>${esc(t('pause.title'))}</h2>
      <p>${esc(t('pause.status', { level, score: fmt(score) }))}</p>
      <div class="row"><button class="cta" id="res">${esc(t('pause.resume'))}</button><button class="cta alt" id="rst">${esc(t('pause.restart'))}</button></div></div>`;
    $('res').onclick = togglePause;
    $('rst').onclick = startGame;
  } else if (kind === 'over') {
    overlay.innerHTML = `<div class="card"><h2>${esc(t('over.title'))}</h2>
      <div class="big">${esc(fmt(score))}</div>
      <p>${esc(newRecord ? t('over.newBest') : t('over.best', { best: fmt(hi) }))} ${esc(t('over.level', { level }))}</p>
      <div class="row"><button class="cta" id="again">${esc(t('over.again'))}</button></div></div>`;
    $('again').onclick = startGame;
  } else if (kind === 'settings') {
    overlay.innerHTML = `<div class="card"><h2>${esc(t('settings.title'))}</h2>
      ${segHtml('lang', t('settings.language'), langOptions(), i18n.lang)}
      ${segHtml('hand', t('settings.layout'), [['right', t('settings.padLeft')], ['left', t('settings.padRight')]], settings.hand)}
      ${segHtml('ctrl', t('settings.control'), [['arrows', t('settings.arrows')], ['stick', t('settings.stick')]], settings.ctrl)}
      <p class="fine">${esc(t('settings.controlHelp'))}</p>
      ${segHtml('sound', t('settings.sound'), [['on', t('settings.on')], ['off', t('settings.off')]], muted ? 'off' : 'on')}
      <div class="row"><button class="cta" id="done">${esc(t('settings.done'))}</button></div></div>`;
    $('done').onclick = closeSettings;
  } else if (kind === 'error') {
    // unico testo non tradotto: serve proprio quando il file delle traduzioni manca
    overlay.innerHTML = `<div class="card"><h2>i18n.json</h2>
      <p>Impossibile caricare il file delle traduzioni. Apri la pagina da un server web (per esempio GitHub Pages o <code>python3 -m http.server</code>), non con doppio clic sul file.</p>
      <p>Could not load the translation file. Open the page from a web server (for example GitHub Pages or <code>python3 -m http.server</code>), not by double-clicking the file.</p></div>`;
  }
  // gli interruttori di impostazione condividono un solo gestore
  overlay.querySelectorAll('.opts button').forEach(b => { b.onclick = () => applyOption(b); });
  const first = overlay.querySelector('.cta');
  if (first) try { first.focus({ preventScroll: true }); } catch (e) {}
}

function applyOption(b) {
  const k = b.dataset.k, v = b.dataset.v;
  if (k === 'lang') { setLang(v); return; } // setLang ridisegna il pannello
  if (k === 'sound') {
    muted = v === 'off'; store.set('mute', muted ? '1' : '0');
    audioInit(); tone(660, 0.08);
  } else {
    settings[k] = v; store.set(k, v); applySettings();
  }
  b.parentNode.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
}
function applySettings() {
  $('app').classList.toggle('lefty', settings.hand === 'left');
  pad.dataset.mode = settings.ctrl;
  padDir = null; pad.dataset.dir = ''; knob.removeAttribute('transform');
}
function openSettings() {
  if (state === 'dying' || state === 'clear' || state === 'boot') return;
  settingsFrom = state;
  if (state === 'play') state = 'paused';
  showOverlay('settings');
}
function closeSettings() {
  if (settingsFrom === 'play') { state = 'play'; hideOverlay(); last = performance.now(); }
  else showOverlay(settingsFrom === 'paused' ? 'pause' : settingsFrom);
}

/* HUD: aggiorna il DOM solo quando un valore cambia */
const hudEls = { score: $('score'), hi: $('hi'), pct: $('pct'), bar: $('bar'), lvl: $('lvl'), lives: $('lives') };
const hudCache = {};
function setHud(k, v, isWidth) {
  if (hudCache[k] === v) return;
  hudCache[k] = v;
  if (isWidth) hudEls[k].style.width = v; else hudEls[k].textContent = v;
}
function hud() {
  const pc = Math.max(0, pct());
  setHud('score', fmt(score));
  setHud('hi', fmt(Math.max(hi, score)));
  setHud('pct', fmtPct(pc));
  setHud('bar', Math.min(100, pc).toFixed(1) + '%', true);
  setHud('lvl', String(level));
  setHud('lives', '◆'.repeat(Math.max(0, lives)) || '–');
}

/* =====================================================================
   Disegno
   ===================================================================== */
function draw() {
  const W = cv.width, H = cv.height, p = player;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(field, 0, 0, W, H);
  const cs = Math.ceil(S);
  // linea in costruzione: azzurra se veloce, ambra se lenta
  for (let k = 0; k < p.trail.length; k++) {
    const c = p.trail[k];
    ctx.fillStyle = p.tslow[k] ? '#ffc455' : '#80dcff';
    ctx.fillRect(Math.floor((c % GW) * S), Math.floor(((c / GW) | 0) * S), cs, cs);
  }
  // miccia
  if (p.fuse >= 0 && p.trail.length) {
    const c = p.trail[Math.min(p.trail.length - 1, Math.floor(p.fuse))];
    const fx = (c % GW + 0.5) * S, fy = (((c / GW) | 0) + 0.5) * S;
    ctx.fillStyle = Math.random() < 0.5 ? '#fff' : '#ff8a3d';
    ctx.beginPath(); ctx.arc(fx, fy, S * (1 + Math.random()), 0, 7); ctx.fill();
  }
  // Qix: segmento rotante con scia iridescente
  ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, S * 0.5);
  qixes.forEach((q, qi) => {
    for (let k = q.hist.length - 1; k >= 0; k--) {
      const h = q.hist[k];
      ctx.strokeStyle = `hsla(${(time * 90 + k * 22 + qi * 150) % 360},95%,62%,${(1 - k / q.hist.length).toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(h[0] * S, h[1] * S); ctx.lineTo(h[2] * S, h[3] * S); ctx.stroke();
    }
  });
  // scintille
  ctx.lineWidth = Math.max(1.2, S * 0.35);
  for (const s of sparxs) {
    const cx = (s.x + 0.5) * S, cy = (s.y + 0.5) * S, r = S * 1.5, a0 = time * 9;
    ctx.strokeStyle = s.wait > 0 ? 'rgba(255,228,92,.35)' : '#ffe45c';
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = a0 + k * Math.PI / 4;
      ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.stroke();
  }
  // cursore (lampeggia durante l'invulnerabilità)
  if (!(invuln > 0 && state === 'play' && Math.floor(time * 12) % 2)) {
    const cx = (p.x + 0.5) * S, cy = (p.y + 0.5) * S, r = S * 1.6;
    ctx.fillStyle = p.drawing && input.slow ? '#ffc455' : '#ff4d8a';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, S * 0.3);
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  // punti guadagnati
  ctx.textAlign = 'center';
  ctx.font = `${Math.max(11, Math.round(S * 3))}px Silkscreen, monospace`;
  for (const u of popups) {
    ctx.fillStyle = u.slow ? `rgba(255,196,85,${Math.min(1, u.t)})` : `rgba(255,255,255,${Math.min(1, u.t)})`;
    ctx.fillText(u.text, (u.x + 0.5) * S, (u.y - 2 - (1.2 - u.t) * 6) * S);
  }
  // lampo di morte
  if (state === 'dying') {
    const k = timer / 1.1;
    ctx.fillStyle = `rgba(255,60,110,${(0.3 * k).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(255,255,255,${k.toFixed(3)})`; ctx.lineWidth = Math.max(1, S * 0.4);
    ctx.beginPath(); ctx.arc((p.x + 0.5) * S, (p.y + 0.5) * S, (1 - k) * S * 14 + S, 0, 7); ctx.stroke();
  }
}
/** Adatta il canvas allo spazio disponibile mantenendo le proporzioni del campo. */
function fit() {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  let w = r.width, h = r.height;
  const ar = GW / GH;
  if (w / h > ar) w = h * ar; else h = w / ar;
  w = Math.floor(w); h = Math.floor(h);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  S = cv.width / GW;
}

/* =====================================================================
   Comandi: pad, pulsante LENTO, tastiera
   ===================================================================== */
const input = { dir: null, slow: false };
let padId = null, padDir = null, slowId = null, slowTouch = false, keySlow = false, keys = [];

function padSet(e) {
  const r = pad.getBoundingClientRect();
  // coordinate del dito nel sistema del viewBox 0..100
  const u = (e.clientX - r.left) / r.width * 100, v = (e.clientY - r.top) / r.height * 100;
  let d = null;
  if (settings.ctrl === 'arrows') {
    // frecce: conta solo il braccio della croce sotto il dito
    if (u >= 30 && u <= 70 && v < 40) d = 'up';
    else if (u >= 30 && u <= 70 && v > 60) d = 'down';
    else if (v >= 30 && v <= 70 && u < 40) d = 'left';
    else if (v >= 30 && v <= 70 && u > 60) d = 'right';
  } else {
    // pad sensibile: direzione dall'angolo rispetto al centro, con zona morta
    const dx = u - 50, dy = v - 50, len = Math.hypot(dx, dy);
    if (len > 9) d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    const k = len > 32 ? 32 / len : 1;
    knob.setAttribute('transform', `translate(${(dx * k).toFixed(1)} ${(dy * k).toFixed(1)})`);
  }
  if (d !== padDir) {
    padDir = d; pad.dataset.dir = d || '';
    if (d) try { navigator.vibrate && navigator.vibrate(6); } catch (_) {}
  }
}
pad.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (padId !== null) return;
  padId = e.pointerId;
  try { pad.setPointerCapture(e.pointerId); } catch (_) {}
  padSet(e);
});
pad.addEventListener('pointermove', e => { if (e.pointerId === padId) padSet(e); });
const padEnd = e => {
  if (e.pointerId !== padId) return;
  padId = null; padDir = null; pad.dataset.dir = ''; knob.removeAttribute('transform');
};
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => pad.addEventListener(ev, padEnd));

slowBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (slowId !== null) return;
  slowId = e.pointerId;
  try { slowBtn.setPointerCapture(e.pointerId); } catch (_) {}
  slowTouch = true;
});
const slowEnd = e => { if (e.pointerId !== slowId) return; slowId = null; slowTouch = false; };
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => slowBtn.addEventListener(ev, slowEnd));

document.addEventListener('contextmenu', e => e.preventDefault());
// blocca lo scorrimento della pagina, tranne dentro i pannelli
document.addEventListener('touchmove', e => { if (!overlay.contains(e.target)) e.preventDefault(); }, { passive: false });

const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const isSlowKey = c => c === 'Space' || c === 'ShiftLeft' || c === 'ShiftRight';
addEventListener('keydown', e => {
  const d = KEYMAP[e.code];
  if (d) { e.preventDefault(); keys = keys.filter(k => k !== d); keys.push(d); return; }
  if (isSlowKey(e.code)) { e.preventDefault(); keySlow = true; return; }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (overlayKind === 'settings') closeSettings(); else togglePause();
  }
});
addEventListener('keyup', e => {
  const d = KEYMAP[e.code];
  if (d) keys = keys.filter(k => k !== d);
  if (isSlowKey(e.code)) keySlow = false;
});
addEventListener('blur', () => { keys = []; keySlow = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') togglePause();
  else if (!document.hidden) requestWake();
});

$('pause').onclick = () => {
  if (overlayKind === 'settings') closeSettings();
  else if (state === 'play' || state === 'paused') togglePause();
};
$('gear').onclick = () => { if (overlayKind === 'settings') closeSettings(); else openSettings(); };
$('lang').onclick = () => { if (i18n.data) nextLang(); };

/* =====================================================================
   Audio e schermo acceso
   ===================================================================== */
let ac = null, wl = null;
function audioInit() {
  if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
}
function tone(f, dur, type = 'square', f2 = null, delay = 0, vol = 0.05) {
  if (!ac || muted) return;
  try {
    const t0 = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (e) {}
}
function requestWake() {
  try {
    if (navigator.wakeLock && !wl) navigator.wakeLock.request('screen')
      .then(l => { wl = l; l.addEventListener('release', () => { wl = null; }); })
      .catch(() => {});
  } catch (e) {}
}

/* =====================================================================
   Ciclo principale
   ===================================================================== */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  input.dir = padDir ? DIRS[padDir] : (keys.length ? DIRS[keys[keys.length - 1]] : null);
  input.slow = slowTouch || keySlow;
  slowBtn.classList.toggle('on', input.slow);
  if (state !== 'paused') time += dt;

  if (state === 'play') {
    if (invuln > 0) invuln -= dt;
    updatePlayer(dt);
    if (state === 'play') for (const q of qixes) qixUpdate(q, dt);
    if (state === 'play') updateSparx(dt);
  } else if (state === 'dying') {
    timer -= dt;
    if (timer <= 0) afterDeath();
  } else if (state === 'clear') {
    for (const q of qixes) qixUpdate(q, dt);
    timer -= dt;
    if (timer <= 0) { level++; setupLevel(); state = 'play'; }
  } else if (state === 'title' || state === 'over' || state === 'boot') {
    for (const q of qixes) qixUpdate(q, dt); // il Qix si muove anche dietro ai pannelli
  }
  if (state !== 'paused') popups = popups.filter(u => (u.t -= dt) > 0);
  draw(); hud();
  requestAnimationFrame(frame);
}

/* =====================================================================
   Avvio: prima il campo, poi le traduzioni
   ===================================================================== */
try { new ResizeObserver(fit).observe(stage); } catch (e) { addEventListener('resize', fit); }
applySettings();
setupLevel(); fit();
requestAnimationFrame(frame);

fetch(I18N_URL)
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(data => {
    i18n.data = data;
    i18n.lang = pickLanguage(data);
    applyStatic();
    state = 'title';
    showOverlay('title');
  })
  .catch(() => { showOverlay('error'); });
})();
