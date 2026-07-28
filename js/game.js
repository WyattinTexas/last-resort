// LAST RESORT — the boot file. Fixed-step loop, input, HUD, debug API.
//
// The shape of the loop is the whole point (spec §7):
//   accumulate real elapsed time -> spend it in whole 20Hz ticks -> render the
//   remainder as an interpolation. The sim is never handed a delta. If the tab
//   stalls for a second, the sim gets exactly 20 ticks, not "one big tick".

import * as THREE from 'three';
import { TXT, tf, localizeDom, i18nAudit } from './i18n.js';
import { makeSeed } from './rng.js';
import { createSim, COVE, TUNE, PHASE, SIM_HZ, TICK_S, creepHp, tideQuota, clearGold } from './sim.js';
import { createScene, PAL } from './scene.js';

export const VERSION = '0.1.0';
const BUILD = (typeof window !== 'undefined' && window.__RESORT_BUILD) || 'dev';

const TICK_MS = 1000 / SIM_HZ;
const MAX_CATCHUP = 6;    // never spend more than this many ticks in one frame

const canvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');

const el = id => document.getElementById(id);
const HUD = {
  tide: el('hud-tide'), quotaBar: el('hud-quota-bar'), quotaText: el('hud-quota-text'),
  gold: el('hud-gold'), pearls: el('hud-pearls'), kills: el('hud-kills'),
  hpBar: el('hud-hp-bar'), hpText: el('hud-hp-text'),
  breakPanel: el('break-panel'), breakTimer: el('break-timer'), breakSkip: el('break-skip'),
  breakTide: el('break-next'),
  ann: el('ann'), seedLabel: el('seed-label'), build: el('build-label'),
  downPanel: el('down-panel'), downText: el('down-text'),
};

let sim = null;
let scene = null;
let paused = false;
let acc = 0;
let lastMs = 0;
let tSec = 0;
let framesDrawn = 0;
const floats = [];
let annUntil = 0;

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------
function boot() {
  localizeDom(document);

  const qSeed = (location.search.match(/[?&]seed=([A-Za-z0-9_-]+)/) || [])[1];
  sim = createSim(makeSeed(qSeed || undefined));
  scene = createScene(canvas, COVE);

  HUD.build.textContent = 'v' + VERSION + ' · ' + BUILD;
  HUD.seedLabel.textContent = sim.S.seed.label;

  resize();
  addEventListener('resize', resize);
  wireInput();
  installDebugApi();

  announce(TXT('YOU WASHED ASHORE. THE SEA IS NOT DONE WITH YOU.'), PAL.gold, 5);

  lastMs = performance.now();
  requestAnimationFrame(frame);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  scene.resize(w, h);
  overlay.width = Math.round(w * dpr);
  overlay.height = Math.round(h * dpr);
  overlay.style.width = w + 'px';
  overlay.style.height = h + 'px';
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------------------------------------------------------------------------
// THE LOOP
// ---------------------------------------------------------------------------
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(250, nowMs - lastMs);
  lastMs = nowMs;
  const dt = dtMs / 1000;
  tSec += dt;

  if (!paused) {
    acc += dtMs;
    let spent = 0;
    while (acc >= TICK_MS && spent < MAX_CATCHUP) { sim.tick(); acc -= TICK_MS; spent++; }
    if (acc > TICK_MS * MAX_CATCHUP) acc = 0;   // the tab was asleep; drop the debt, don't fast-forward
  }

  consumeEvents();
  const alpha = paused ? 1 : Math.min(1, acc / TICK_MS);
  scene.draw(sim.S, alpha, tSec, dt);
  drawOverlay(alpha, dt);
  drawHud();
  framesDrawn++;
}

// ---------------------------------------------------------------------------
// EVENTS — the sim's one-way channel to the presentation layer.
// ---------------------------------------------------------------------------
function consumeEvents() {
  const S = sim.S;
  for (const e of sim.drainEvents()) {
    switch (e.type) {
      case 'surf_set':
        scene.popFoamRing(0, COVE.waterline + 1);
        announce(tf(TXT('A SURF-SET IS BREAKING — %1 INCOMING'), e.count), '#8CF0E4', 2.2);
        break;
      case 'spawn':
        scene.popFoamRing(e.x, e.z + 1.5);
        break;
      case 'hit':
        pushFloat(e.x, e.z, '-' + e.amount, e.fatal ? '#FFF2C4' : '#FFFFFF', e.fatal ? 20 : 15);
        break;
      case 'kill':
        pushFloat(e.x, e.z, '+' + e.gold, '#F5C542', 17);
        break;
      case 'hero_hit':
        scene.kick(0.06);
        pushFloat(S.hero.x, S.hero.z, '-' + e.amount, '#FF6B6B', 17);
        break;
      case 'tide_start':
        announce(tf(TXT('TIDE %1 — %2 ASHORE'), e.tide, e.quota), '#FFFFFF', 3);
        scene.kick(0.12);
        break;
      case 'tide_clear':
        announce(tf(TXT('TIDE %1 CLEARED  ·  +%2 GOLD  ·  +%3 PEARL'), e.tide, e.gold, e.pearls), '#9CFF7A', 4);
        break;
      case 'hero_down':
        announce(TXT('WASHED OUT — THE SEA TAKES THIS TIDE BACK'), '#FF6B6B', 4);
        scene.kick(0.4);
        break;
      case 'wash_up':
        announce(TXT('YOU WASH BACK UP THE BEACH. AGAIN.'), '#F5C542', 3);
        break;
    }
  }
}

function pushFloat(x, z, txt, col, size) {
  if (floats.length > 26) floats.shift();
  floats.push({ x, z, txt, col, size, t: 0 });
}

function announce(text, col, secs) {
  HUD.ann.textContent = text;
  HUD.ann.style.color = typeof col === 'number' ? '#' + col.toString(16).padStart(6, '0') : col;
  HUD.ann.classList.add('show');
  annUntil = tSec + (secs || 3);
}

// ---------------------------------------------------------------------------
// OVERLAY — creep HP bars and damage floats, projected from the world. Cheaper
// and crisper than 40 sprites, and it can never fight the depth buffer.
// ---------------------------------------------------------------------------
function drawOverlay(alpha, dt) {
  const w = innerWidth, h = innerHeight;
  octx.clearRect(0, 0, w, h);
  const S = sim.S;
  const lerp = (a, b) => a + (b - a) * alpha;

  for (const c of S.creeps) {
    if (c.receding) continue;
    const cx = lerp(c.px, c.x), cz = lerp(c.pz, c.z);
    const p = scene.worldToScreen(cx, 1.95, cz, w, h);
    if (p.behind) continue;
    const bw = 25, bh = 4;
    const frac = Math.max(0, c.hp / c.maxHp);
    octx.fillStyle = 'rgba(6,22,28,0.72)';
    octx.fillRect(p.x - bw / 2 - 1, p.y - 1, bw + 2, bh + 2);
    octx.fillStyle = frac > 0.5 ? '#5FD96B' : (frac > 0.22 ? '#F5C542' : '#FF5B5B');
    octx.fillRect(p.x - bw / 2, p.y, bw * frac, bh);
  }

  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.t += dt;
    if (f.t > 1.1) { floats.splice(i, 1); continue; }
    const p = scene.worldToScreen(f.x, 1.5 + f.t * 2.4, f.z, w, h);
    if (p.behind) continue;
    const a = Math.max(0, 1 - f.t / 1.1);
    octx.globalAlpha = a;
    octx.font = '900 ' + f.size + 'px "Trebuchet MS", system-ui, sans-serif';
    octx.lineWidth = 4; octx.strokeStyle = 'rgba(5,26,34,0.85)';
    octx.strokeText(f.txt, p.x, p.y);
    octx.fillStyle = f.col;
    octx.fillText(f.txt, p.x, p.y);
    octx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let lastHud = '';
function drawHud() {
  const S = sim.S;
  const nextTide = S.phase === PHASE.TIDE ? S.tide : S.tide + 1;
  const key = [S.phase, S.tide, S.killed, S.quota, S.gold, S.pearls, S.kills,
    Math.round(S.hero.hp), Math.ceil(S.phaseTicks / SIM_HZ), S.creeps.length, S.queue].join('|');

  if (key !== lastHud) {
    lastHud = key;
    HUD.tide.textContent = S.phase === PHASE.TIDE ? String(S.tide) : String(nextTide);
    const q = S.phase === PHASE.TIDE ? S.quota : tideQuota(nextTide);
    const done = S.phase === PHASE.TIDE ? Math.min(S.killed, q) : 0;
    HUD.quotaBar.style.width = (q ? (done / q) * 100 : 0) + '%';
    HUD.quotaText.textContent = done + ' / ' + q;
    HUD.gold.textContent = S.gold;
    HUD.pearls.textContent = S.pearls;
    HUD.kills.textContent = S.kills;
    const frac = S.hero.maxHp ? S.hero.hp / S.hero.maxHp : 0;
    HUD.hpBar.style.width = (frac * 100) + '%';
    HUD.hpBar.style.background = frac > 0.5 ? 'linear-gradient(180deg,#7BE88A,#2E9E4A)'
      : frac > 0.25 ? 'linear-gradient(180deg,#FFD86B,#D69A16)'
        : 'linear-gradient(180deg,#FF8080,#B32626)';
    HUD.hpText.textContent = Math.ceil(S.hero.hp) + ' / ' + S.hero.maxHp;

    const onBreak = S.phase === PHASE.BREAK;
    HUD.breakPanel.classList.toggle('show', onBreak);
    if (onBreak) {
      HUD.breakTimer.textContent = String(Math.ceil(S.phaseTicks / SIM_HZ));
      HUD.breakTide.textContent = tf(TXT('TIDE %1  ·  %2 WASH ASHORE  ·  %3 HP EACH'),
        nextTide, tideQuota(nextTide), creepHp(nextTide));
    }
    HUD.downPanel.classList.toggle('show', S.phase === PHASE.WASHOUT);
  }

  if (annUntil && tSec > annUntil) { HUD.ann.classList.remove('show'); annUntil = 0; }
}

// ---------------------------------------------------------------------------
// INPUT — click-to-move with instant repath. Hold the button to keep repathing;
// that drag-follow is most of what "RTS feel" actually is.
// ---------------------------------------------------------------------------
function wireInput() {
  let held = false;

  const orderAt = (clientX, clientY) => {
    const ndcX = (clientX / innerWidth) * 2 - 1;
    const ndcY = -(clientY / innerHeight) * 2 + 1;
    const g = scene.pickGround(ndcX, ndcY);
    if (!g) return;
    if (sim.order(g.x, g.z)) scene.markClick(sim.S.hero.tx, sim.S.hero.tz);
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 2) return;
    held = true;
    canvas.setPointerCapture(e.pointerId);
    orderAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', e => { if (held) orderAt(e.clientX, e.clientY); });
  addEventListener('pointerup', () => { held = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  HUD.breakSkip.addEventListener('click', () => { sim.skipTide(); });

  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') { if (sim.skipTide()) e.preventDefault(); }
    // QWER is the smart-cast bar (D3). The slots exist today; link 2 fills them.
    if ('qwer'.includes(k)) {
      const slot = el('slot-' + k);
      if (slot) { slot.classList.add('poke'); setTimeout(() => slot.classList.remove('poke'), 180); }
      announce(TXT('THE BOARDWALK RACKS ARE STILL BOARDED UP.'), '#8CF0E4', 1.6);
    }
  });
}

// ---------------------------------------------------------------------------
// window.RESORT — the debug API and the surface every CDP test drives.
// Rule (§11, cross-cutting): tests assert on SIM TICKS, never on wall clock.
// ---------------------------------------------------------------------------
function installDebugApi() {
  const api = {
    version: VERSION,
    build: BUILD,
    get state() { return sim.S; },
    get sim() { return sim; },
    get ready() { return framesDrawn > 0; },
    get frames() { return framesDrawn; },
    get seed() { return sim.S.seed; },
    get paused() { return paused; },

    // Freeze the wall-clock loop so a test owns the tick budget outright.
    pause(v) { paused = (v === undefined) ? true : !!v; acc = 0; return paused; },
    resume() { paused = false; acc = 0; return paused; },

    runTicks(n) { const c = n | 0; for (let i = 0; i < c; i++) sim.tick(); return sim.S.tick; },

    // Run until a predicate holds, bounded by TICKS — not by seconds.
    runUntil(pred, maxTicks) {
      const cap = maxTicks || SIM_HZ * 60 * 10;
      let i = 0;
      while (i < cap && !pred(sim.S)) { sim.tick(); i++; }
      return { ticks: i, ok: pred(sim.S) };
    },

    // Advance through whole tides. This is what "run 2 tides" means here: a
    // count of cleared tides, measured in ticks. Shop breaks are lived through
    // rather than skipped, because the regen inside them is part of the run.
    // Pass skipBreaks to cut them out when a test wants the harsher path.
    runTides(n, maxTicks, skipBreaks) {
      const target = sim.S.cleared + (n | 0);
      const started = sim.S.tick;
      const cap = maxTicks || SIM_HZ * 60 * 10;
      let i = 0;
      while (i < cap && sim.S.cleared < target) {
        if (skipBreaks && sim.S.phase === PHASE.BREAK) sim.skipTide();
        sim.tick(); i++;
      }
      return {
        cleared: sim.S.cleared, tide: sim.S.tide, deaths: sim.S.deaths,
        ticks: sim.S.tick - started, ok: sim.S.cleared >= target,
      };
    },

    spawn(n, skin) { return sim.spawn(n || 1, skin); },
    skipTide() { return sim.skipTide(); },
    giveGold(n) { sim.giveGold(n === undefined ? 500 : n); return sim.S.gold; },
    givePearls(n) { sim.givePearls(n === undefined ? 3 : n); return sim.S.pearls; },
    order(x, z) { return sim.order(x, z); },
    hurtHero(n) { sim.S.hero.hp = Math.max(0, sim.S.hero.hp - (n | 0)); return sim.S.hero.hp; },

    // Rebuild the run from a seed. Returns the seed OBJECT, v-field and all.
    setSeed(s) {
      sim = createSim(makeSeed(s));
      floats.length = 0;
      lastHud = '';
      HUD.seedLabel.textContent = sim.S.seed.label;
      return sim.S.seed;
    },

    snapshot() { return sim.snapshot(); },
    // Re-resolve every static string through TXT(). A language switch will
    // need exactly this; today it is also how ?l10n=audit proves coverage.
    relocalize() { localizeDom(document); lastHud = ''; return true; },
    tuning: TUNE,
    curves: { creepHp, tideQuota, clearGold },
    i18nAudit,
    THREE,
  };
  window.RESORT = api;
  window.dispatchEvent(new Event('resort-ready'));
}

boot();
