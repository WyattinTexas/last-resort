// SURVIVAL QUEST — THE BAND. Every sound is synthesized in WebAudio at call time;
// there are no assets, no fetches, no files (§5 audio plan, done the quick
// way). Render-side and wall-clock by nature — the sim never hears any of it.
//
// The kit: a steel-pan idle that noodles between tides, a drum swell when a
// tide rolls in, and short stings for the moments (boss, clear, washout,
// victory, lead change). Autoplay law: the context is created lazily on the
// first user gesture; headless runs never create one (--mute-audio is house
// law regardless).

const PENTA = [293.66, 369.99, 440.0, 493.88, 587.33, 659.25]; // D maj pent, island key

let ctx = null;
let master = null;
let muted = false;
let unlocked = false;
let idleAt = 0;           // wall ms of the next idle pluck
let lastPlay = Object.create(null);   // throttle: name -> wall ms

try { muted = localStorage.getItem('resort.mute') === '1'; } catch (e) { /* default on */ }

function ac() {
  if (!unlocked || muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.30;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// one throttled entry per named sound: juice, not spam
function gate(name, ms) {
  const now = performance.now();
  if (lastPlay[name] && now - lastPlay[name] < ms) return false;
  lastPlay[name] = now;
  return true;
}

// --- the steel pan: two detuned sines + a fast strike envelope --------------
function pan(freq, when, gain, decay) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (when || 0);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain || 0.10, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || 0.7));
  const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.02; // the "ping" partial
  const g2 = c.createGain(); g2.gain.value = 0.35;
  o1.connect(g); o2.connect(g2); g2.connect(g);
  g.connect(master);
  o1.start(t); o2.start(t);
  o1.stop(t + (decay || 0.7) + 0.05); o2.stop(t + (decay || 0.7) + 0.05);
}

// --- drums: a pitch-dropping sine thump + a noise wash ----------------------
function thump(f0, f1, when, gain, len) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (when || 0);
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (len || 0.22));
  const g = c.createGain();
  g.gain.setValueAtTime(gain || 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (len || 0.22) + 0.05);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + (len || 0.22) + 0.1);
}

function wash(when, gain, len, fFrom, fTo) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (when || 0);
  const dur = len || 1.2;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(fFrom || 300, t);
  f.frequency.exponentialRampToValueAtTime(fTo || 2400, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain || 0.16, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.2);
}

function ding(freq, when, gain, decay) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (when || 0);
  const d = decay || 0.5;
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + d + 0.05);
}

// ---------------------------------------------------------------------------
// WS1 COMBAT PRIMITIVES — the click is the consonant every impact needs: a
// 4ms noise transient through a bandpass. pluck and noiseBurst round out the
// kit; every combat cue below is a chord of these four-plus-two.
// ---------------------------------------------------------------------------
function click(when, gain, freq) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (when || 0);
  const dur = 0.004;
  const buf = c.createBuffer(1, Math.max(8, (c.sampleRate * dur) | 0), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.value = freq || 1800; f.Q.value = 0.9;
  const g = c.createGain(); g.gain.value = gain || 0.15;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.01);
}

function noiseBurst(when, gain, dur, type, f0, f1, Q) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (when || 0);
  const buf = c.createBuffer(1, Math.max(8, (c.sampleRate * dur) | 0), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type || 'bandpass';
  f.frequency.setValueAtTime(f0 || 600, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  f.Q.value = Q || 1;
  const g = c.createGain();
  g.gain.setValueAtTime(gain || 0.1, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

function pluck(f0, f1, when, gain, len, type) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (when || 0);
  const l = len || 0.08;
  const o = c.createOscillator(); o.type = type || 'triangle';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + l);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain || 0.1, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + l + 0.03);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + l + 0.06);
}

// the stun bell: a detuned pair under a 6 Hz tremolo, rung for the duration
function bellRing(sec) {
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const dur = Math.max(0.4, sec || 0.8);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const tg = c.createGain(); tg.gain.value = 0.7;
  const lfo = c.createOscillator(); lfo.frequency.value = 6;
  const lg = c.createGain(); lg.gain.value = 0.3;
  lfo.connect(lg); lg.connect(tg.gain);
  const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.value = 1244.51;
  const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 1279.0;
  o1.connect(tg); o2.connect(tg); tg.connect(g); g.connect(master);
  lfo.start(t); o1.start(t); o2.start(t);
  lfo.stop(t + dur + 0.05); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

// A hard ceiling on live combat voices (~10): over budget we DROP, never
// queue — a 40-creep scrum must never become rain on a tin roof. Each entry
// is the wall-ms when that voice ends.
const voiceEnds = [];
function voiceOk(len) {
  const now = performance.now();
  while (voiceEnds.length && voiceEnds[0] <= now) voiceEnds.shift();
  if (voiceEnds.length >= 10) return false;
  voiceEnds.push(now + len * 1000);
  voiceEnds.sort((a, b) => a - b);
  return true;
}

// per-cue throttles (ms) — juice, not spam
const COMBAT_GATES = {
  whoosh: 120, melee_hit: 70, melee_crit: 150, hit_taken: 150,
  shot: 90, shot_hit: 70, kill_pop: 60, coin: 90, stun_ring: 500,
  slow_crackle: 200, root_snare: 200, slam: 400, whiff: 150,
};

// fired-counters: bumped on every combat() CALL, before the unlock/mute gate,
// so a muted headless battery can still prove the event wiring is alive.
const combatFired = Object.create(null);

// ---------------------------------------------------------------------------
// the public kit
// ---------------------------------------------------------------------------
export const AUDIO = {
  get muted() { return muted; },
  get unlocked() { return unlocked; },

  // first gesture opens the bar
  unlock() {
    if (unlocked) return true;
    unlocked = true;
    ac();
    return true;
  },

  toggleMute() {
    muted = !muted;
    try { localStorage.setItem('resort.mute', muted ? '1' : '0'); } catch (e) { /* fine */ }
    if (muted && ctx) ctx.suspend().catch(() => {});
    if (!muted && ctx) ctx.resume().catch(() => {});
    return muted;
  },

  // the idle noodle: a lazy pluck or two while nobody is fighting
  frame(phase) {
    if (!unlocked || muted) return;
    const now = performance.now();
    if (phase === 'TIDE') { idleAt = now + 2600; return; }   // the drums own the tide
    if (now < idleAt) return;
    idleAt = now + 1900 + Math.random() * 2600;
    const n = PENTA[(Math.random() * PENTA.length) | 0];
    pan(n, 0, 0.055, 0.9);
    if (Math.random() < 0.4) pan(PENTA[(Math.random() * PENTA.length) | 0] * 0.5, 0.22, 0.04, 1.1);
  },

  // WS1: the combat kit — every landed hit, launch, kill and state change
  // speaks. Pitch varies ±12% per call (render-side randomness, sim-legal).
  // Creep-on-creep stays silent by design: only the hero's fights talk.
  combat(kind, o) {
    combatFired[kind] = (combatFired[kind] || 0) + 1;
    if (!unlocked || muted) return;
    if (!gate('c_' + kind, COMBAT_GATES[kind] || 100)) return;
    o = o || {};
    const p = 1 + (Math.random() - 0.5) * 0.24;   // ±12% pitch vary
    switch (kind) {
      case 'whoosh':
        if (voiceOk(0.08)) noiseBurst(0, 0.05, 0.07, 'bandpass', 400 * p, 900 * p, 1.4);
        break;
      case 'melee_hit':
        if (!voiceOk(0.1)) return;
        click(0, 0.16, 1700 * p);
        thump(190 * p, 85, 0, 0.30, 0.06);
        break;
      case 'melee_crit':
        if (!voiceOk(0.25)) return;
        click(0, 0.20, 1900 * p);
        thump(200 * p, 80, 0, 0.42, 0.07);
        ding(620 * p, 0.012, 0.11, 0.2);
        break;
      case 'hit_taken':
        if (!voiceOk(0.12)) return;
        thump(120 * p, 55, 0, 0.42, 0.09);
        noiseBurst(0, 0.06, 0.09, 'lowpass', 500, 180);
        break;
      case 'shot':
        if (voiceOk(0.09)) pluck(700 * p, 300 * p, 0, 0.10, 0.08);
        break;
      case 'shot_hit':
        if (!voiceOk(0.08)) return;
        click(0, 0.15, 2600 * p);
        noiseBurst(0, 0.09, 0.05, 'highpass', 1400 * p, 2600 * p);
        break;
      case 'kill_pop':
        if (!voiceOk(o.big ? 0.6 : 0.12)) return;
        if (o.big) {
          pluck(140 * p, 450 * p, 0, 0.16, 0.14, 'sine');
          wash(0, 0.14, 0.5, 300, 1400);
        } else {
          pluck(280 * p, 900 * p, 0, 0.11, 0.07, 'sine');
          noiseBurst(0.01, 0.05, 0.06, 'bandpass', 900 * p, 1600 * p);
        }
        break;
      case 'coin':
        if (!voiceOk(0.3)) return;
        ding(1568 * p, o.delay || 0, 0.07, 0.3);
        ding(2093 * p, (o.delay || 0) + 0.07, 0.07, 0.3);
        break;
      case 'stun_ring':
        if (voiceOk(o.sec || 0.8)) bellRing(o.sec);
        break;
      case 'slow_crackle':
        if (!voiceOk(0.2)) return;
        noiseBurst(0, 0.07, 0.05, 'highpass', 3200, 2400);
        noiseBurst(0.06, 0.06, 0.05, 'highpass', 2400, 1700);
        noiseBurst(0.12, 0.05, 0.05, 'highpass', 1800, 1200);
        break;
      case 'root_snare':
        if (!voiceOk(0.15)) return;
        click(0, 0.18, 900);
        pluck(140 * p, 90 * p, 0.01, 0.12, 0.12);
        break;
      case 'slam':
        if (!voiceOk(0.55)) return;
        thump(70, 28, 0, 0.75, 0.5);
        wash(0, 0.16, 0.5, 200, 900);
        break;
      case 'whiff':
        if (voiceOk(0.1)) noiseBurst(0, 0.035, 0.09, 'bandpass', 500 * p, 1100 * p, 1.2);
        break;
    }
  },

  // the battery reads this to prove wiring without ever unlocking a context
  get combatFired() { return combatFired; },

  // the moments — called from the event consumer with sim events
  moment(kind) {
    if (!unlocked || muted) return;
    switch (kind) {
      case 'tide_start':
        if (!gate('tide', 1500)) return;
        wash(0, 0.15, 1.0, 240, 2200);
        thump(160, 55, 0.15, 0.5, 0.3);
        thump(180, 60, 0.5, 0.42, 0.28);
        thump(200, 70, 0.85, 0.6, 0.34);
        break;
      case 'boss':
        if (!gate('boss', 3000)) return;
        thump(90, 28, 0, 0.8, 0.9);
        wash(0, 0.2, 1.6, 120, 900);
        pan(146.83, 0.3, 0.12, 1.6); pan(155.56, 0.32, 0.10, 1.6);   // a sour minor shimmer
        break;
      case 'clear':
        if (!gate('clear', 1200)) return;
        pan(440, 0, 0.10, 0.5); pan(587.33, 0.12, 0.11, 0.7); pan(880, 0.24, 0.09, 0.9);
        break;
      case 'washout':
        if (!gate('washout', 2000)) return;
        thump(300, 40, 0, 0.5, 0.9);
        wash(0, 0.12, 1.4, 1200, 160);
        break;
      case 'victory':
        pan(587.33, 0, 0.12, 0.8); pan(739.99, 0.16, 0.12, 0.8);
        pan(880, 0.32, 0.12, 0.9); pan(1174.66, 0.5, 0.14, 1.6);
        thump(140, 50, 0.5, 0.5, 0.4);
        break;
      case 'lead':
        if (!gate('lead', 1500)) return;
        ding(1244.51, 0, 0.10); ding(1567.98, 0.1, 0.10);
        break;
      case 'ghost_clear':
        if (!gate('ghost', 1500)) return;
        ding(392, 0, 0.10); ding(311.13, 0.14, 0.10);   // a falling "uh-oh"
        break;
      case 'best':
        pan(880, 0, 0.12, 0.7); pan(1108.73, 0.14, 0.12, 0.8); pan(1318.51, 0.28, 0.13, 1.2);
        break;
      case 'level':
        if (!gate('level', 800)) return;
        ding(987.77, 0, 0.07); ding(1318.51, 0.08, 0.07);
        break;
    }
  },
};
