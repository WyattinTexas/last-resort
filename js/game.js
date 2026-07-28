// LAST RESORT — the boot file. Fixed-step loop, input, HUD, debug API.
//
// The shape of the loop is the whole point (spec §7):
//   accumulate real elapsed time -> spend it in whole 20Hz ticks -> render the
//   remainder as an interpolation. The sim is never handed a delta. If the tab
//   stalls for a second, the sim gets exactly 20 ticks, not "one big tick".
//
// Link 2 wires the GAME onto the chassis: QWER smart-cast at the hover point
// (no click-confirm — D3), the walkable boardwalk, cooldown slots, XP, and the
// louder half of the announcement ticker.

import * as THREE from 'three';
import { TXT, tf, localizeDom, i18nAudit } from './i18n.js';
import { makeSeed } from './rng.js';
import { createSim, COVE, TUNE, PHASE, SIM_HZ, TICK_S, creepHp, tideQuota, clearGold, tideNow, secs } from './sim.js';
import { createScene, PAL } from './scene.js';
import { SPELL, SPELLS, BODIES, MOD, CAT_COLOR, RULES } from './data.js';
import { initShop, shopFrame, anyShopOpen, closeShops, toggleCastaway, useItemSlot } from './shop.js';

export const VERSION = '0.2.0';
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
  body: el('hud-body'), lv: el('hud-lv'), xpBar: el('hud-xp-bar'), pts: el('hud-pts'),
  breakPanel: el('break-panel'), breakTimer: el('break-timer'), breakSkip: el('break-skip'),
  breakTide: el('break-next'),
  ann: el('ann'), seedLabel: el('seed-label'), build: el('build-label'),
  downPanel: el('down-panel'), downText: el('down-text'),
  barnote: el('barnote'),
  slots: { Q: el('slot-q'), W: el('slot-w'), E: el('slot-e'), R: el('slot-r') },
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
const warns = [];     // telegraphed circles: {x,z,r,ttl,total,color}
const beams = [];     // lightning / wand zaps: {pts,ttl,total,jag,color}
const aim = { x: 0, z: 6 };   // the hover point QWER smart-casts at (D3)

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

  initShop({
    getSim: () => sim,
    announce,
    onPlayAgain: () => { window.RESORT.setSeed(undefined); },
  });

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
  shopFrame();
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
        if (e.crit) pushFloat(e.x, e.z, '-' + e.amount + '!', '#FFB347', 23);
        else pushFloat(e.x, e.z, '-' + e.amount, e.fatal ? '#FFF2C4' : '#FFFFFF', e.fatal ? 20 : 15);
        break;
      case 'kill':
        pushFloat(e.x, e.z, '+' + e.gold, '#F5C542', e.big ? 24 : 17);
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
        announce(tf(TXT('TIDE %1 CLEARED  ·  +%2 GOLD  ·  +%3 PEARL  ·  +%4 XP'), e.tide, e.gold, e.pearls, e.xp), '#9CFF7A', 4);
        break;
      case 'hero_down':
        announce(TXT('WASHED OUT — THE SEA TAKES THIS TIDE BACK'), '#FF6B6B', 4);
        scene.kick(0.4);
        break;
      case 'wash_up':
        announce(TXT('YOU WASH BACK UP THE BEACH. AGAIN.'), '#F5C542', 3);
        break;

      // --- link 2: the build ---
      case 'body_pick': {
        scene.setHeroBody(e.id);
        const b = BODIES.find(x => x.id === e.id);
        announce(tf(TXT('%1 STEPS OFF THE FORGE. TIDE 1 IS COMING.'), b ? TXT(b.name) : ''), '#E7C25C', 4);
        break;
      }
      case 'buy_spell': {
        const sp = SPELL[e.id];
        announce(e.slot
          ? tf(TXT('%1 — RACKED TO %2'), TXT(sp.name), e.slot)
          : tf(TXT('%1 — BOUGHT. SLOT IT FROM THE RACK.'), TXT(sp.name)),
        CAT_COLOR[sp.cat] || '#E7C25C', 2.6);
        break;
      }
      case 'rank_up': {
        const sp = SPELL[e.id];
        announce(tf(TXT('%1 — RANK %2'), TXT(sp.name), e.rank), CAT_COLOR[sp.cat] || '#E7C25C', 2);
        break;
      }
      case 'level_up':
        announce(tf(TXT('LEVEL %1 — SKILL POINT EARNED'), e.level), '#F5C542', 2.6);
        scene.popRing(S.hero.x, S.hero.z, 0xF5C542, 1.1);
        break;
      case 'cast': {
        scene.popRing(e.x, e.z, parseInt((CAT_COLOR[e.cat] || '#FFFFFF').slice(1), 16), 0.5);
        break;
      }
      case 'proj_hit':
        scene.popRing(e.x, e.z, catHex(e.cat), Math.max(0.4, (e.r || 0.6) / 2.4));
        break;
      case 'aoe_hit':
        if (e.hostile) { scene.popRing(e.x, e.z, 0xFF5B5B, e.r / 2.2); scene.kick(0.1); }
        else scene.popRing(e.x, e.z, catHex(e.cat), e.r / 2.4);
        break;
      case 'aoe_warn':
        warns.push({ x: e.x, z: e.z, r: e.r, ttl: e.ticks / SIM_HZ, total: e.ticks / SIM_HZ, color: e.hostile ? '#FF5B5B' : '#F5C542' });
        break;
      case 'meteor_warn':
        scene.meteorWarn(e.x, e.z, e.ticks / SIM_HZ);
        warns.push({ x: e.x, z: e.z, r: e.r, ttl: e.ticks / SIM_HZ, total: e.ticks / SIM_HZ, color: '#F5C542' });
        break;
      case 'chain':
        beams.push({ pts: e.pts, ttl: 0.28, total: 0.28, jag: true, color: '#9FE7FF' });
        break;
      case 'zap':
        beams.push({ pts: [{ x: e.x0, z: e.z0 }, { x: e.x1, z: e.z1 }], ttl: 0.13, total: 0.13, jag: false, color: '#FFF6D2' });
        break;
      case 'dash':
        scene.popRing(e.x0, e.z0, 0x7FE7D8, 0.6);
        scene.popRing(e.x1, e.z1, 0x7FE7D8, 0.8);
        break;
      case 'heal':
        pushFloat(e.x, e.z, '+' + e.amount, '#9CFF7A', 17);
        break;
      case 'shield_up':
        pushFloat(S.hero.x, S.hero.z, TXT('SHIELD'), '#7AC8FF', 15);
        break;
      case 'summon':
        scene.popRing(e.x, e.z, 0xE7C25C, 1.2);
        announce(TXT('THE REEF ANSWERS'), '#E7C25C', 2);
        break;
      case 'stun':
        pushFloat(S.hero.x, S.hero.z, TXT('STUNNED!'), '#FF6B6B', 16);
        break;
      case 'dodge':
        pushFloat(e.x, e.z, TXT('MISS'), '#C8D8E0', 13);
        break;
      case 'mod_tide': {
        const m = MOD[e.mod];
        announce(tf(TXT('MODIFIER TIDE — %1: %2'), TXT(m.name), TXT(m.desc)), '#C77BE8', 5);
        break;
      }
      case 'boss_spawn':
        announce(tf(TXT('%1 SURFACES'), TXT(e.name)), '#FF5B5B', 4.5);
        scene.kick(0.3);
        break;
      case 'boss_down':
        announce(tf(TXT('%1 GOES UNDER'), TXT(e.name)), '#F5C542', 4);
        scene.kick(0.2);
        break;
      case 'surge':
        announce(TXT('THE UNDERTOW CALLS ITS SWARM'), '#C77BE8', 3);
        break;
      case 'victory':
        announce(TXT('TIDE 10 BROKEN — THE ISLAND RESPECTS YOU'), '#F5C542', 6);
        scene.kick(0.25);
        break;
    }
  }
}

function catHex(cat) {
  return parseInt((CAT_COLOR[cat] || '#FFFFFF').slice(1), 16);
}

function pushFloat(x, z, txt, col, size) {
  if (floats.length > 26) floats.shift();
  floats.push({ x, z, txt, col, size, t: 0 });
}

function announce(text, col, secsShown) {
  HUD.ann.textContent = text;
  HUD.ann.style.color = typeof col === 'number' ? '#' + col.toString(16).padStart(6, '0') : col;
  HUD.ann.classList.add('show');
  annUntil = tSec + (secsShown || 3);
}

// ---------------------------------------------------------------------------
// OVERLAY — creep HP bars, damage floats, telegraph circles and beams, all
// projected from the world. Cheaper and crisper than sprites, and it can
// never fight the depth buffer.
// ---------------------------------------------------------------------------
function drawOverlay(alpha, dt) {
  const w = innerWidth, h = innerHeight;
  octx.clearRect(0, 0, w, h);
  const S = sim.S;
  const lerp = (a, b) => a + (b - a) * alpha;

  // telegraphs first: under everything else
  for (let i = warns.length - 1; i >= 0; i--) {
    const c = warns[i];
    c.ttl -= dt;
    if (c.ttl <= 0) { warns.splice(i, 1); continue; }
    const p0 = scene.worldToScreen(c.x, 0.05, c.z, w, h);
    const pr = scene.worldToScreen(c.x + c.r, 0.05, c.z, w, h);
    if (p0.behind) continue;
    const rp = Math.hypot(pr.x - p0.x, pr.y - p0.y);
    const k = 1 - c.ttl / c.total;
    octx.beginPath();
    octx.arc(p0.x, p0.y, rp, 0, Math.PI * 2);
    octx.strokeStyle = c.color;
    octx.globalAlpha = 0.7;
    octx.lineWidth = 2;
    octx.stroke();
    octx.beginPath();
    octx.arc(p0.x, p0.y, rp * k, 0, Math.PI * 2);
    octx.fillStyle = c.color;
    octx.globalAlpha = 0.16;
    octx.fill();
    octx.globalAlpha = 1;
  }

  // beams: chain lightning and wand zaps
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    b.ttl -= dt;
    if (b.ttl <= 0) { beams.splice(i, 1); continue; }
    const a = b.ttl / b.total;
    octx.globalAlpha = a;
    octx.strokeStyle = b.color;
    octx.lineWidth = b.jag ? 2.5 : 2;
    octx.beginPath();
    for (let s = 0; s < b.pts.length - 1; s++) {
      const A = scene.worldToScreen(b.pts[s].x, 1.2, b.pts[s].z, w, h);
      const B = scene.worldToScreen(b.pts[s + 1].x, 1.2, b.pts[s + 1].z, w, h);
      if (A.behind || B.behind) continue;
      if (!b.jag) {
        octx.moveTo(A.x, A.y); octx.lineTo(B.x, B.y);
      } else {
        // jagged: subdivide with sideways noise. Render-side randomness is
        // legal — the sim never sees it.
        const SEG = 4;
        let px = A.x, py = A.y;
        octx.moveTo(px, py);
        for (let j = 1; j <= SEG; j++) {
          const t = j / SEG;
          const nx = A.x + (B.x - A.x) * t, ny = A.y + (B.y - A.y) * t;
          const off = j === SEG ? 0 : (Math.random() - 0.5) * 14;
          const dx = B.y - A.y, dy = -(B.x - A.x);
          const dl = Math.hypot(dx, dy) || 1;
          octx.lineTo(nx + (dx / dl) * off, ny + (dy / dl) * off);
        }
      }
    }
    octx.stroke();
    octx.globalAlpha = 1;
  }

  // HP bars: creeps (bosses get the wide bar), then allies
  for (const c of S.creeps) {
    if (c.receding) continue;
    const cx = lerp(c.px, c.x), cz = lerp(c.pz, c.z);
    const p = scene.worldToScreen(cx, c.big ? 4.6 : 1.95, cz, w, h);
    if (p.behind) continue;
    const bw = c.big ? 74 : (c.mini ? 18 : 25), bh = c.big ? 7 : 4;
    const frac = Math.max(0, c.hp / c.maxHp);
    octx.fillStyle = 'rgba(6,22,28,0.72)';
    octx.fillRect(p.x - bw / 2 - 1, p.y - 1, bw + 2, bh + 2);
    octx.fillStyle = frac > 0.5 ? '#5FD96B' : (frac > 0.22 ? '#F5C542' : '#FF5B5B');
    octx.fillRect(p.x - bw / 2, p.y, bw * frac, bh);
    if (c.big) {
      octx.font = '900 11px "Trebuchet MS", system-ui, sans-serif';
      octx.textAlign = 'center'; octx.textBaseline = 'bottom';
      octx.lineWidth = 3; octx.strokeStyle = 'rgba(5,26,34,0.85)';
      const nm = TXT(c.bossName || 'BOSS');
      octx.strokeText(nm, p.x, p.y - 3);
      octx.fillStyle = '#FFD2D2';
      octx.fillText(nm, p.x, p.y - 3);
    }
  }
  for (const a of S.allies) {
    const ax = lerp(a.px, a.x), az = lerp(a.pz, a.z);
    const p = scene.worldToScreen(ax, 2.3, az, w, h);
    if (p.behind) continue;
    const bw = 25, bh = 4;
    const frac = Math.max(0, a.hp / a.maxHp);
    octx.fillStyle = 'rgba(6,22,28,0.72)';
    octx.fillRect(p.x - bw / 2 - 1, p.y - 1, bw + 2, bh + 2);
    octx.fillStyle = '#7AC8FF';
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
  const inTide = S.phase === PHASE.TIDE;
  const nextTide = inTide ? S.tide : S.tide + 1;
  const key = [S.phase, S.tide, S.killed, S.quota, S.gold, S.pearls, S.kills,
    Math.round(S.hero.hp), S.hero.maxHp, Math.ceil(S.phaseTicks / SIM_HZ), S.creeps.length, S.queue,
    S.level, S.xp, S.skillPts, S.bodyId, Math.round(S.hero.shield)].join('|');

  if (key !== lastHud) {
    lastHud = key;
    HUD.tide.textContent = String(nextTide);
    const q = inTide ? S.quota : tideQuota(nextTide);
    const done = inTide ? Math.min(S.killed, q) : 0;
    HUD.quotaBar.style.width = (q ? (done / q) * 100 : 0) + '%';
    HUD.quotaText.textContent = done + ' / ' + q;
    HUD.gold.textContent = S.gold;
    HUD.pearls.textContent = S.pearls;
    HUD.kills.textContent = S.kills;
    const frac = S.hero.maxHp ? S.hero.hp / S.hero.maxHp : 0;
    HUD.hpBar.style.width = (frac * 100) + '%';
    HUD.hpBar.style.background = S.hero.shield > 0 ? 'linear-gradient(180deg,#9FDCFF,#3E8EC4)'
      : frac > 0.5 ? 'linear-gradient(180deg,#7BE88A,#2E9E4A)'
      : frac > 0.25 ? 'linear-gradient(180deg,#FFD86B,#D69A16)'
        : 'linear-gradient(180deg,#FF8080,#B32626)';
    HUD.hpText.textContent = Math.ceil(S.hero.hp) + (S.hero.shield > 0 ? ' +' + Math.round(S.hero.shield) : '') + ' / ' + S.hero.maxHp;

    const body = BODIES.find(b => b.id === S.bodyId);
    HUD.body.textContent = body ? TXT(body.name) : TXT('THE CASTAWAY');
    HUD.lv.textContent = tf(TXT('LV %1'), S.level);
    const need = 60 + 50 * S.level;
    HUD.xpBar.style.width = Math.min(100, (S.xp / need) * 100) + '%';
    HUD.pts.style.display = S.skillPts > 0 ? 'block' : 'none';
    HUD.pts.textContent = '+' + S.skillPts;

    const onBreak = S.phase === PHASE.BREAK;
    HUD.breakPanel.classList.toggle('show', onBreak && !anyShopOpen());
    if (onBreak) {
      HUD.breakTimer.textContent = String(Math.ceil(S.phaseTicks / SIM_HZ));
      HUD.breakTide.textContent = tf(TXT('TIDE %1  ·  %2 WASH ASHORE  ·  %3 HP EACH'),
        nextTide, tideQuota(nextTide), creepHp(nextTide));
    }
    HUD.downPanel.classList.toggle('show', S.phase === PHASE.WASHOUT);
    HUD.barnote.style.display = Object.values(S.slots).some(v => v) ? 'none' : 'block';
  }

  // cooldown slots run every frame — they are the game's wristwatch
  for (const k of ['Q', 'W', 'E', 'R']) {
    const slot = HUD.slots[k];
    const id = S.slots[k];
    const ico = slot.querySelector('.ico');
    const cd = slot.querySelector('.cd');
    const cdt = slot.querySelector('.cdt');
    const tag = slot.querySelector('.tag');
    if (!id) {
      if (ico.textContent !== '·') { ico.textContent = '·'; ico.style.opacity = 0.3; cd.style.height = '0%'; cdt.textContent = ''; tag.textContent = ''; slot.classList.remove('ready'); }
      continue;
    }
    const sp = SPELL[id];
    if (ico.textContent !== sp.ico) { ico.textContent = sp.ico; ico.style.opacity = 1; }
    if (sp.kind === 'passive') {
      const t = TXT('PASSIVE');
      if (tag.textContent !== t) { tag.textContent = t; cd.style.height = '0%'; cdt.textContent = ''; slot.classList.add('ready'); }
      continue;
    }
    if (tag.textContent !== '') tag.textContent = '';
    const left = S.cds[id] || 0;
    const max = Math.max(1, Math.round(secs(sp.cd) * S.hero.cdMult));
    cd.style.height = left > 0 ? ((left / max) * 100) + '%' : '0%';
    cdt.textContent = left > 0 ? String(Math.ceil(left / SIM_HZ)) : '';
    slot.classList.toggle('ready', left <= 0);
  }

  if (annUntil && tSec > annUntil) { HUD.ann.classList.remove('show'); annUntil = 0; }
}

// ---------------------------------------------------------------------------
// INPUT — click-to-move with instant repath; QWER smart-casts at the hover
// point, no click-confirm (D3). C is the castaway sheet, 1-6 drink the juice.
// ---------------------------------------------------------------------------
function wireInput() {
  let held = false;

  const groundAt = (clientX, clientY) => {
    const ndcX = (clientX / innerWidth) * 2 - 1;
    const ndcY = -(clientY / innerHeight) * 2 + 1;
    return scene.pickGround(ndcX, ndcY);
  };

  const orderAt = (clientX, clientY) => {
    const g = groundAt(clientX, clientY);
    if (!g) return;
    if (sim.order(g.x, g.z)) scene.markClick(sim.S.hero.tx, sim.S.hero.tz);
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 2) return;
    held = true;
    canvas.setPointerCapture(e.pointerId);
    orderAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', e => {
    const g = groundAt(e.clientX, e.clientY);
    if (g) { aim.x = g.x; aim.z = g.z; }     // the smart-cast reticle is the mouse
    if (held) orderAt(e.clientX, e.clientY);
  });
  addEventListener('pointerup', () => { held = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  HUD.breakSkip.addEventListener('click', () => { sim.skipTide(); });

  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') { if (sim.skipTide()) e.preventDefault(); }
    if (k === 'escape') closeShops();
    if (k === 'c') toggleCastaway();
    if (k >= '1' && k <= '6') useItemSlot(Number(k) - 1);
    if ('qwer'.includes(k) && k.length === 1) {
      const K = k.toUpperCase();
      const slot = HUD.slots[K];
      if (slot) { slot.classList.add('poke'); setTimeout(() => slot.classList.remove('poke'), 180); }
      const r = sim.cast(K, aim.x, aim.z);
      if (!r.ok && r.why === 'empty') announce(TXT('THAT SLOT IS EMPTY — THE RACKS ARE ON THE BOARDWALK'), '#8CF0E4', 1.6);
      if (!r.ok && r.why === 'passive') announce(TXT('THAT ONE WORKS ON ITS OWN'), '#8CF0E4', 1.4);
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
      while (i < cap && sim.S.cleared < target && sim.S.phase !== PHASE.VICTORY) {
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
    giveXp(n) { sim.giveXp(n === undefined ? 100 : n); return { level: sim.S.level, pts: sim.S.skillPts }; },
    order(x, z) { return sim.order(x, z); },
    hurtHero(n) { sim.S.hero.hp = Math.max(0, sim.S.hero.hp - (n | 0)); return sim.S.hero.hp; },

    // --- the build API, straight through to the sim ---
    pickBody(id) { return sim.pickBody(id); },
    buySpell(id) { return sim.buySpell(id); },
    equip(id, slot) { return sim.equip(id, slot); },
    rankUp(id) { return sim.rankUp(id); },
    buyFruit(id, pack) { return sim.buyFruit(id, pack); },
    buyItem(id) { return sim.buyItem(id); },
    useItem(i) { return sim.useItem(i); },
    respec() { return sim.respec(); },
    cast(slot, x, z) { return sim.cast(slot, x, z); },
    setHold(v) { return sim.setHold(v); },

    // Rebuild the run from a seed. Returns the seed OBJECT, v-field and all.
    setSeed(s) {
      sim = createSim(makeSeed(s));
      floats.length = 0;
      warns.length = 0;
      beams.length = 0;
      lastHud = '';
      scene.setHeroBody(null);
      HUD.seedLabel.textContent = sim.S.seed.label;
      return sim.S.seed;
    },

    snapshot() { return sim.snapshot(); },
    // Re-resolve every static string through TXT(). A language switch will
    // need exactly this; today it is also how ?l10n=audit proves coverage.
    relocalize() { localizeDom(document); lastHud = ''; return true; },
    tuning: TUNE,
    rules: RULES,
    curves: { creepHp, tideQuota, clearGold },
    content: { SPELLS, BODIES },
    tideNow: () => tideNow(sim.S),
    i18nAudit,
    THREE,
  };
  window.RESORT = api;
  window.dispatchEvent(new Event('resort-ready'));
}

boot();
