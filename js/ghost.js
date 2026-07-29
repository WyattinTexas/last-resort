// SURVIVAL QUEST — THE GHOST. Standings, persistence, and the race (P0's
// "standings vs ghost", spec §4: the standings board is ALWAYS visible).
//
// The sim writes S.tideLog — { tide: { tick, kills, worth } } — and knows
// nothing else. This file turns that log into a race: it keeps your best run
// in localStorage, freezes it as THE GHOST when a run starts, and calls the
// lead changes like a fight announcer. Presentation-side only: nothing here
// may ever write into the sim (the ghost is a spectator by definition).
//
// Apples-to-apples law: a ghost is keyed by seed MODE. The DAILY TIDE runs one
// fixed seed all day (label DAILY-YYYYMMDD, v:1 field intact), so you and the
// ghost fight the exact same sea. Free-play ghosts race across seeds — still
// your best self, just a fairer fight on the daily.

import { TXT, tf } from './i18n.js';
import { RULES } from './data.js';

const LS_PREFIX = 'resort.ghost.';

let getSim = null;
let announce = null;
let onMoment = null;      // audio hook: ('lead'|'ghost_clear'|'best') => void

let ghost = null;         // frozen best-run record for THIS run (or null)
let leader = null;        // 'you' | 'ghost' | null — as of the last common clear
let ghostPassedTide = 0;  // highest tide we already announced "the ghost cleared"
let savedThisRun = false; // a victory already ran the save; don't double-fold
let lastBoardKey = '';
let victoryLine = '';     // filled at victory; the victory screen reads it

// WS2: at phone heights the full board collides with the herobox, so small
// viewports boot COLLAPSED to a one-line strip ("T4 0:58" + the lead chip);
// a tap opens the ten rows and the next tide start folds them away again.
// Desktop (860px) boots expanded — the board is ALWAYS up there (spec §4).
const collapseDefault = () => matchMedia('(max-height: 480px)').matches;
let stCollapsed = collapseDefault();

export function toggleStandings(force) {
  stCollapsed = force !== undefined ? !!force : !stCollapsed;
  lastBoardKey = '';
  return stCollapsed;
}

const el = id => document.getElementById(id);
const UI = {};

// ---------------------------------------------------------------------------
// time helpers — ticks are the only clock (20Hz); mm:ss is presentation
// ---------------------------------------------------------------------------
export function mmss(ticks) {
  const s = Math.max(0, Math.round(ticks / 20));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function deltaStr(ticks) { return mmss(Math.abs(ticks)); }

// ---------------------------------------------------------------------------
// persistence — one record per ghost key. try/catch everywhere: private
// windows and file:// contexts get a memory-only ghost, never a crash.
// ---------------------------------------------------------------------------
const mem = Object.create(null);   // storage-less fallback

function ghostKey(seed) {
  return /^DAILY-\d{8}$/.test(seed.label) ? 'daily.' + seed.label : 'free';
}

function loadRecord(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw) { const r = JSON.parse(raw); if (r && r.v === 1 && r.tides) return r; }
  } catch (e) { /* storage denied: fall through to memory */ }
  return mem[key] || null;
}

function saveRecord(key, rec) {
  mem[key] = rec;
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(rec)); } catch (e) { /* memory-only */ }
}

// deeper beats shallower; same depth, faster beats slower
function better(a, b) {
  if (!b) return true;
  if (!a) return false;
  if (a.cleared !== b.cleared) return a.cleared > b.cleared;
  return a.totalTick < b.totalTick;
}

function recordFromRun(S) {
  const tides = {};
  let deepest = 0;
  for (const t in S.tideLog) {
    tides[t] = { ...S.tideLog[t] };
    if (+t > deepest) deepest = +t;
  }
  if (!deepest) return null;
  return {
    v: 1,
    seed: { ...S.seed },
    body: S.bodyId,
    cleared: deepest,
    totalTick: tides[deepest].tick,
    kills: tides[deepest].kills,
    worth: tides[deepest].worth,
    date: new Date().toISOString().slice(0, 10),
    tides,
  };
}

// Fold the current run into the stored best (if it IS the best). Called at
// victory, and again when a run is abandoned for a new seed — a run you walked
// away from at tide 7 still counts as a record if it went deepest.
function foldRun(S) {
  const rec = recordFromRun(S);
  if (!rec) return false;
  const key = ghostKey(S.seed);
  const cur = loadRecord(key);
  if (better(rec, cur)) { saveRecord(key, rec); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// the race — called on run start, per frame, and on sim events
// ---------------------------------------------------------------------------
export function initGhost(opts) {
  getSim = opts.getSim;
  announce = opts.announce;
  onMoment = opts.onMoment || (() => {});
  for (const id of ['standings', 'st-label', 'st-lead', 'st-rows', 'st-foot', 'victory-ghost', 'title-ghost']) UI[id] = el(id);
  // WS2: the header strip is the board's toggle (its shead alone takes taps)
  document.querySelector('#standings .shead').addEventListener('pointerdown', e => {
    e.stopPropagation();
    toggleStandings();
  });
  ghostRunStart();
}

// A new run began (boot, or setSeed): fold the old run away, freeze the ghost.
export function ghostRunStart(prevS) {
  if (prevS && !savedThisRun) foldRun(prevS);
  savedThisRun = false;
  leader = null;
  ghostPassedTide = 0;
  victoryLine = '';
  lastBoardKey = '';
  const S = getSim().S;
  ghost = loadRecord(ghostKey(S.seed));
  fillTitleGhost();
}

function fillTitleGhost() {
  if (!UI['title-ghost']) return;
  const free = loadRecord('free');
  UI['title-ghost'].textContent = free
    ? tf(TXT('GHOST ON DUTY: %1 TIDES · %2 · %3 KILLS'), free.cleared, mmss(free.totalTick), free.kills)
    : TXT('NO GHOST ON DUTY YET — SURVIVE SOMETHING');
}

export function ghostEvent(e) {
  const S = getSim().S;
  // WS2: glass shows the board when you ask, never squats — an opened board
  // folds back to the small-viewport default when the next tide rolls in.
  // (Desktop's default is expanded, so this is a no-op there and the board
  // stays ALWAYS up — spec §4.)
  if (e.type === 'tide_start' && collapseDefault() && !stCollapsed) toggleStandings(true);
  if (e.type === 'tide_clear') {
    const t = e.tide;
    const g = ghost && ghost.tides[t];
    if (!g) return;
    const you = S.tideLog[t];
    if (!you) return;
    const delta = g.tick - you.tick;              // positive: you are faster
    const newLeader = delta >= 0 ? 'you' : 'ghost';
    if (leader !== null && newLeader !== leader) {
      onMoment('lead');
      announce(newLeader === 'you'
        ? tf(TXT('LEAD CHANGE — YOU OVERTAKE THE GHOST BY %1'), deltaStr(delta))
        : tf(TXT('LEAD CHANGE — THE GHOST SLIPS AHEAD BY %1'), deltaStr(delta)),
      newLeader === 'you' ? '#9CFF7A' : '#FF6B6B', 4, true);
    } else if (leader === null) {
      announce(newLeader === 'you'
        ? tf(TXT('TIDE %1 — YOU LEAD THE GHOST BY %2'), t, deltaStr(delta))
        : tf(TXT('TIDE %1 — THE GHOST LEADS BY %2'), t, deltaStr(delta)),
      newLeader === 'you' ? '#9CFF7A' : '#8CF0E4', 3);
    }
    leader = newLeader;
  }

  if (e.type === 'victory') {
    // write the record NOW so "back to the forge" already races the new best
    const wasGhost = ghost;
    const isBest = foldRun(S);
    savedThisRun = true;
    if (!wasGhost) {
      victoryLine = TXT('FIRST RUN ON THE BOARD — THE GHOST IS BORN');
    } else {
      const d = wasGhost.cleared < RULES.finalTide
        ? null                                       // old ghost never finished
        : wasGhost.totalTick - S.tideLog[RULES.finalTide].tick;
      if (d === null) victoryLine = TXT('YOU WENT WHERE THE GHOST NEVER DID — NEW BEST RUN');
      else if (isBest) victoryLine = tf(TXT('YOU BEAT THE GHOST BY %1 — NEW BEST RUN'), deltaStr(d));
      else victoryLine = tf(TXT('THE GHOST KEEPS THE CROWN BY %1'), deltaStr(d));
    }
    if (isBest) onMoment('best');
    if (UI['victory-ghost']) UI['victory-ghost'].textContent = victoryLine;
    fillTitleGhost();
  }
}

export function victoryGhostLine() { return victoryLine; }

// ---------------------------------------------------------------------------
// per-frame: the board itself + the mid-tide "ghost already cleared" call
// ---------------------------------------------------------------------------
export function ghostFrame() {
  const S = getSim().S;
  const show = S.phase !== 'FORGE';
  UI.standings.classList.toggle('show', show);
  if (!show) return;

  // the ghost clears tide T while you are still fighting it: one loud call
  if (ghost && S.phase === 'TIDE') {
    const g = ghost.tides[S.tide];
    if (g && !S.tideLog[S.tide] && S.tick > g.tick && ghostPassedTide < S.tide) {
      ghostPassedTide = S.tide;
      onMoment('ghost_clear');
      announce(tf(TXT('THE GHOST HAS ALREADY CLEARED TIDE %1 — SWING FASTER'), S.tide), '#C77BE8', 3.5);
    }
  }

  // cheap redraw: only when a second flips or state moves
  const key = [S.tide, S.cleared, S.phase, Math.floor(S.tick / 20), ghost ? ghost.totalTick : 0, stCollapsed].join('|');
  if (key === lastBoardKey) return;
  lastBoardKey = key;

  UI.standings.classList.toggle('collapsed', stCollapsed);

  // header chip: who holds the race as of the last common clear
  let lead = '';
  let leadCls = '';
  if (ghost) {
    let common = 0;
    for (let t = RULES.finalTide; t >= 1; t--) {
      if (S.tideLog[t] && ghost.tides[t]) { common = t; break; }
    }
    if (common) {
      const d = ghost.tides[common].tick - S.tideLog[common].tick;
      lead = (d >= 0 ? TXT('YOU') + ' +' : TXT('GHOST') + ' +') + deltaStr(d);
      leadCls = d >= 0 ? 'you' : 'ghost';
    }
  }
  UI['st-lead'].textContent = lead;
  UI['st-lead'].className = leadCls;

  const rows = UI['st-rows'];
  rows.textContent = '';

  // WS2 collapsed: the header IS the board — current tide + the live run
  // clock in the label, the lead chip untouched; no rows built (cheaper, and
  // the row count becomes the honest probe).
  if (stCollapsed) {
    UI['st-label'].textContent = 'T' + (S.phase === 'TIDE' ? S.tide : S.tide + 1) + ' ' + mmss(S.tick);
    return;
  }
  UI['st-label'].textContent = TXT('STANDINGS');
  const head = document.createElement('div');
  head.className = 'strow head';
  head.innerHTML = '<div class="stt" data-notr>~</div>';
  const hy = document.createElement('div'); hy.className = 'sty'; hy.textContent = TXT('YOU');
  const hg = document.createElement('div'); hg.className = 'stg'; hg.textContent = TXT('GHOST');
  head.appendChild(hy); head.appendChild(hg);
  rows.appendChild(head);

  const onTide = S.phase === 'TIDE' ? S.tide : 0;
  for (let t = 1; t <= RULES.finalTide; t++) {
    const row = document.createElement('div');
    row.className = 'strow' + (t === onTide ? ' now' : '');
    const tt = document.createElement('div'); tt.className = 'stt'; tt.textContent = String(t);
    const ty = document.createElement('div'); ty.className = 'sty';
    const tg = document.createElement('div'); tg.className = 'stg';
    const you = S.tideLog[t];
    const g = ghost && ghost.tides[t];
    ty.textContent = you ? mmss(you.tick) : (t === onTide ? mmss(S.tick) : '—');
    tg.textContent = g ? mmss(g.tick) : '—';
    if (you && g) {
      if (you.tick <= g.tick) { ty.classList.add('win'); tg.classList.add('lose'); }
      else { tg.classList.add('win'); ty.classList.add('lose'); }
    }
    row.appendChild(tt); row.appendChild(ty); row.appendChild(tg);
    rows.appendChild(row);
  }

  UI['st-foot'].textContent = ghost
    ? tf(TXT('GHOST: %1 TIDES · %2 KILLS · WORTH %3'), ghost.cleared, ghost.kills, ghost.worth)
      + (ghostKey(S.seed) !== 'free' ? '  ·  ' + TXT('DAILY') : '')
    : TXT('NO GHOST YET — YOUR FIRST RUN WRITES THE RECORD');
}

// ---------------------------------------------------------------------------
// debug/test surface — the battery asserts through this, never through DOM
// ---------------------------------------------------------------------------
export const ghostDebug = {
  get ghost() { return ghost; },
  get leader() { return leader; },
  get collapsed() { return stCollapsed; },
  key() { return ghostKey(getSim().S.seed); },
  load(key) { return loadRecord(key); },
  fold() { return foldRun(getSim().S); },
  wipe() {
    for (const k of Object.keys(mem)) delete mem[k];
    try {
      const dead = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) dead.push(k);
      }
      dead.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* memory-only */ }
    ghost = null; leader = null; ghostPassedTide = 0; lastBoardKey = '';
    return true;
  },
};
