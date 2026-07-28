// LAST RESORT — THE BAND. Every sound is synthesized in WebAudio at call time;
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

function ding(freq, when, gain) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (when || 0);
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.55);
}

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
