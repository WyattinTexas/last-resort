// LAST RESORT — THE SIM.
//
// This file is pure. It imports no three.js, touches no DOM, reads no clock.
// Give it a seed and call tick() and it produces the same run every time, on
// every machine. The renderer is a spectator.
//
// THE FOUR LAWS (spec §7):
//   1. Fixed 20Hz tick. SIM TICKS ARE NEVER WALL TIME. Nothing in here asks
//      what time it is; "4 seconds" is 80 ticks and only ever 80 ticks.
//   2. Seeded PRNG only, and the seed object carries v:1 (see rng.js).
//   3. NEVER splice a unit array mid-tick. Mark dead, sweep at tick end.
//   4. Render interpolates. Every unit keeps px/pz — where it was when the
//      tick began — so the renderer can draw the in-between and never stutter.

import { makeSeed, mulberry32, randInt, randRange } from './rng.js';

export const SIM_HZ = 20;
export const TICK_S = 1 / SIM_HZ;
export const secs = s => Math.round(s * SIM_HZ);   // seconds -> ticks, the only conversion allowed

// ---------------------------------------------------------------------------
// THE COVE — one walled beach. World units are metres. -Z is out to sea.
// ---------------------------------------------------------------------------
export const COVE = {
  halfWidth: 26,      // rope-post fences stand at +/- this
  waterline: -20,     // creeps wash ashore here
  inland: 22,         // jungle wall
  heroStart: { x: 0, z: 6 },
};

// ---------------------------------------------------------------------------
// TUNING — every number in the game lives in one object so a balance pass is
// one diff and never a scavenger hunt. Spec §6 values; all of it is TUNE.
// ---------------------------------------------------------------------------
export const TUNE = {
  // --- tides (§6) ---
  quotaBase: 12,          // quota = 12 + 2 x tide
  quotaPerTide: 2,
  surfSetMin: 6,          // surf-sets of 6-8 ...
  surfSetMax: 8,
  surfSetTicks: secs(4),  // ... every ~4s
  coveCap: 40,            // CONCURRENT cap per cove; the rest waits in the queue (SQ_CAP law)
  breakTicks: secs(25),   // 25s shop break between tides, skippable
  washoutTicks: secs(3),  // hero down: the tide drags back out to sea
  milestoneEvery: 5,      // boss tides 5/15/25 (link 2 fills them in)

  // --- economy (§6) ---
  bountyBase: 4,          // bounty = 4 + tide, per creep
  clearGoldBase: 25,      // clear bonus = 25 + 5 x tide
  clearGoldPerTide: 5,
  clearPearls: 1,
  clearPearlsMilestone: 2,
  startGold: 100,
  startPearls: 3,

  // --- hero (§6 chassis; bodies/spells are link 2) ---
  // P0 note: this hero is NAKED — no spells, no items, no fruit. It is tuned so
  // a graybox run is playable on its own, which link 2 will retune the moment
  // purchases exist. A standing hero should take tides 1-2 and start needing
  // its feet from about tide 3; that is the click-move game asserting itself.
  hero: {
    maxHp: 1200,
    regenPerSec: 10.0,
    dmg: 52,
    atkTicks: secs(0.5),
    range: 2.6,
    acquire: 7.0,         // idle auto-acquire radius (classic-RTS acquisition feel)
    ms: 6.8,              // metres/sec
    radius: 0.6,
    arrive: 0.16,
  },

  // --- creeps: ONE stat template, skin-swapped, script-scaled (§6/§2) ---
  creep: {
    baseHp: 100,
    baseDmg: 8,
    atkTicks: secs(1.15),
    range: 1.0,
    ms: 2.25,
    radius: 0.7,          // bodies OCCUPY SPACE — see resolveBodies()
  },
};

// The ONE creep statline, skin-swapped. Skins are cosmetic + tiny stat trims —
// content is 1 template x N skins x script math (the content cheat code, §2).
export const SKINS = [
  { id: 'crab',   name: 'SANDCLAW',   hp: 1.00, ms: 1.00, dmg: 1.00 },
  { id: 'jelly',  name: 'DRIFT JELLY',hp: 0.85, ms: 1.18, dmg: 0.90 },
  { id: 'monkey', name: 'REEF MONKEY',hp: 0.92, ms: 1.10, dmg: 1.05 },
];

// HP brackets straight off spec §6. Geometric inside a bracket, so the curve is
// smooth and the printed anchors are hit exactly.
const HP_BRACKETS = [
  [1, 5, 100, 260],
  [6, 10, 300, 500],
  [11, 15, 700, 1200],
  [16, 20, 1500, 2600],
  [21, 25, 3200, 5200],
  [26, 30, 6500, 11000],
];

export function creepHp(tide) {
  const t = Math.max(1, tide | 0);
  for (const [t0, t1, h0, h1] of HP_BRACKETS) {
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return Math.round(h0 * Math.pow(h1 / h0, f));
    }
  }
  // RIPTIDE (endless, P2): carry the last bracket's per-tide ratio forward.
  const r = Math.pow(11000 / 6500, 1 / 4);
  return Math.round(11000 * Math.pow(r, t - 30));
}

// Damage rides the HP curve at a gentler exponent — creeps get tankier faster
// than they get lethal, which is what keeps a big surf-set readable. TUNE.
export function creepDmg(tide) {
  return Math.max(1, Math.round(TUNE.creep.baseDmg * Math.pow(creepHp(tide) / TUNE.creep.baseHp, 0.42)));
}

export function tideQuota(tide) {
  return TUNE.quotaBase + TUNE.quotaPerTide * Math.max(0, tide | 0);
}

export function clearGold(tide) {
  return TUNE.clearGoldBase + TUNE.clearGoldPerTide * (tide | 0);
}

// ---------------------------------------------------------------------------
// PHASES
//   BREAK   — between tides. Shop break, skippable. (The shop is link 2; the
//             stall is real today so its timing is already tuned.)
//   TIDE    — the sea is sending them.
//   WASHOUT — hero went down. No game over in TIDES mode: the tide drags back
//             out, and you wash ashore again when the next one rolls in.
// ---------------------------------------------------------------------------
export const PHASE = { BREAK: 'BREAK', TIDE: 'TIDE', WASHOUT: 'WASHOUT' };

export function createSim(seedInput) {
  const seed = (seedInput && seedInput.v) ? seedInput : makeSeed(seedInput);

  const S = {
    seed,
    tick: 0,                     // THE clock. Everything else is derived from it.
    phase: PHASE.BREAK,
    phaseTicks: TUNE.breakTicks, // ticks remaining in the current phase

    tide: 0,                     // the tide now running (or just survived)
    cleared: 0,                  // tides actually CLEARED. Monotonic — a washout
                                 // rolls `tide` back, but never this. Standings
                                 // and tests both want the honest count.
    quota: 0,
    spawned: 0,
    killed: 0,

    setTimer: 0,                 // ticks until the next surf-set rolls in
    queue: 0,                    // creeps waiting on the cove cap (overflow queue)

    gold: TUNE.startGold,
    pearls: TUNE.startPearls,
    kills: 0,
    deaths: 0,
    bestTide: 0,

    hero: null,
    creeps: [],
    nextId: 1,
    events: [],                  // drained by the renderer; sim never reads it back
    rng: null,
    _draws: 0,                   // how many times the stream has been pulled (determinism probe)
  };

  const base = mulberry32(seed.seed);
  S.rng = () => { S._draws++; return base(); };

  S.hero = {
    id: 0,
    x: COVE.heroStart.x, z: COVE.heroStart.z,
    px: COVE.heroStart.x, pz: COVE.heroStart.z,
    hp: TUNE.hero.maxHp, maxHp: TUNE.hero.maxHp,
    dmg: TUNE.hero.dmg,
    atkCd: 0, atkAnim: 0,
    facing: 0,
    tx: COVE.heroStart.x, tz: COVE.heroStart.z,
    hasOrder: false,
    dead: false,
    hitFlash: 0,
    regenAcc: 0,
  };

  return makeApi(S);
}

function makeApi(S) {
  return {
    S,
    get state() { return S; },
    tick: () => tickOnce(S),
    runTicks: n => { for (let i = 0; i < n; i++) tickOnce(S); return S.tick; },
    order: (x, z) => orderMove(S, x, z),
    skipTide: () => skipBreak(S),
    spawn: (n, skinId) => debugSpawn(S, n, skinId),
    giveGold: n => { S.gold += (n | 0); },
    givePearls: n => { S.pearls += (n | 0); },
    drainEvents: () => { const e = S.events; S.events = []; return e; },
    snapshot: () => snapshot(S),
  };
}

// A small, stable, JSON-able fingerprint of the run. Two machines that ran the
// same seed for the same number of TICKS must produce identical snapshots —
// that is the determinism assertion, and it never mentions wall time.
function snapshot(S) {
  let hpSum = 0, posSum = 0;
  for (const c of S.creeps) {
    hpSum += c.hp;
    posSum += Math.round(c.x * 100) + Math.round(c.z * 100) * 7;
  }
  return {
    v: S.seed.v, seed: S.seed.seed,
    tick: S.tick, phase: S.phase, tide: S.tide, cleared: S.cleared,
    quota: S.quota, spawned: S.spawned, killed: S.killed,
    alive: S.creeps.length, queue: S.queue,
    gold: S.gold, pearls: S.pearls, kills: S.kills, deaths: S.deaths,
    heroHp: Math.round(S.hero.hp),
    heroX: Math.round(S.hero.x * 100), heroZ: Math.round(S.hero.z * 100),
    hpSum: Math.round(hpSum), posSum,
    draws: S._draws,
  };
}

function ev(S, type, data) { S.events.push(Object.assign({ type, tick: S.tick }, data)); }

// ---------------------------------------------------------------------------
// THE TICK. One call = 1/20th of a simulated second, no matter how long the
// machine took to get here.
// ---------------------------------------------------------------------------
function tickOnce(S) {
  S.tick++;

  // LAW 4: stash where everything was, so the renderer can draw the in-between.
  S.hero.px = S.hero.x; S.hero.pz = S.hero.z;
  for (const c of S.creeps) { c.px = c.x; c.pz = c.z; }

  // --- phase clock ---
  if (S.phase === PHASE.BREAK) {
    S.phaseTicks--;
    if (S.phaseTicks <= 0) startTide(S);
  } else if (S.phase === PHASE.WASHOUT) {
    S.phaseTicks--;
    if (S.phaseTicks <= 0) endWashout(S);
  } else if (S.phase === PHASE.TIDE) {
    spawnPhase(S);
  }

  // --- units ---
  if (!S.hero.dead) heroStep(S);
  for (const c of S.creeps) creepStep(S, c);
  resolveBodies(S);

  // --- regen ---
  if (!S.hero.dead && S.hero.hp < S.hero.maxHp) {
    S.hero.regenAcc += TUNE.hero.regenPerSec * TICK_S;
    const whole = Math.floor(S.hero.regenAcc);
    if (whole > 0) { S.hero.regenAcc -= whole; S.hero.hp = Math.min(S.hero.maxHp, S.hero.hp + whole); }
  }
  if (S.hero.hitFlash > 0) S.hero.hitFlash--;
  if (S.hero.atkAnim > 0) S.hero.atkAnim--;

  // --- LAW 3: sweep the dead HERE, at the end of the tick, never mid-loop ---
  if (S.creeps.some(c => c.dead)) {
    const keep = [];
    for (const c of S.creeps) {
      if (c.dead) { if (!c.receded) onCreepKilled(S, c); }
      else keep.push(c);
    }
    S.creeps = keep;
  }

  // --- tide clear check (after the sweep, so "alive" means alive) ---
  if (S.phase === PHASE.TIDE && S.killed >= S.quota && S.creeps.length === 0 && S.queue === 0) {
    clearTide(S);
  }

  return S.tick;
}

// ---------------------------------------------------------------------------
// TIDE FLOW
// ---------------------------------------------------------------------------
function startTide(S) {
  S.tide++;
  S.quota = tideQuota(S.tide);
  S.spawned = 0;
  S.killed = 0;
  S.queue = 0;
  S.setTimer = secs(1.2);        // a beat of dread before the first set lands
  S.phase = PHASE.TIDE;
  S.phaseTicks = 0;

  // Death is not a game over in TIDES: you wash back up with the next tide.
  if (S.hero.dead) {
    S.hero.dead = false;
    S.hero.hp = S.hero.maxHp;
    S.hero.x = S.hero.px = COVE.heroStart.x;
    S.hero.z = S.hero.pz = COVE.heroStart.z;
    S.hero.tx = COVE.heroStart.x; S.hero.tz = COVE.heroStart.z;
    S.hero.hasOrder = false;
    ev(S, 'wash_up');
  }
  ev(S, 'tide_start', { tide: S.tide, quota: S.quota, boss: S.tide % TUNE.milestoneEvery === 0 });
}

function clearTide(S) {
  const gold = clearGold(S.tide);
  const pearls = (S.tide % TUNE.milestoneEvery === 0) ? TUNE.clearPearlsMilestone : TUNE.clearPearls;
  S.gold += gold;
  S.pearls += pearls;
  S.cleared++;
  if (S.tide > S.bestTide) S.bestTide = S.tide;
  S.phase = PHASE.BREAK;
  S.phaseTicks = TUNE.breakTicks;
  ev(S, 'tide_clear', { tide: S.tide, gold, pearls });
}

function skipBreak(S) {
  if (S.phase !== PHASE.BREAK) return false;
  S.phaseTicks = 1;              // resolves on the very next tick, never mid-tick
  return true;
}

// The hero went down. The sea takes the tide back and the same tide comes
// again — no game over, no softlock on an unmeetable quota.
function heroDown(S) {
  S.hero.dead = true;
  S.hero.hp = 0;
  S.hero.hasOrder = false;
  S.deaths++;
  S.tide = Math.max(0, S.tide - 1);   // this tide didn't count; it rolls in again
  S.phase = PHASE.WASHOUT;
  S.phaseTicks = TUNE.washoutTicks;
  for (const c of S.creeps) c.receding = true;
  ev(S, 'hero_down', { tide: S.tide + 1 });
}

function endWashout(S) {
  for (const c of S.creeps) { c.dead = true; c.receded = true; }  // no bounty for a tide you lost
  S.queue = 0;
  S.phase = PHASE.BREAK;
  S.phaseTicks = TUNE.breakTicks;
}

// ---------------------------------------------------------------------------
// SPAWNING — surf-sets of 6-8 every ~4s until the quota is out of the sea.
// Concurrent cap 40 per cove; the remainder waits in the overflow queue.
// ---------------------------------------------------------------------------
function spawnPhase(S) {
  // drain the overflow queue first, as soon as the cove has room
  while (S.queue > 0 && S.creeps.length < TUNE.coveCap) {
    S.queue--;
    spawnOne(S);
  }

  if (S.spawned >= S.quota) return;

  S.setTimer--;
  if (S.setTimer > 0) return;
  S.setTimer = TUNE.surfSetTicks;

  const want = Math.min(randInt(S.rng, TUNE.surfSetMin, TUNE.surfSetMax), S.quota - S.spawned);
  ev(S, 'surf_set', { count: want });
  for (let i = 0; i < want; i++) {
    S.spawned++;
    if (S.creeps.length < TUNE.coveCap) spawnOne(S);
    else S.queue++;
  }
}

function spawnOne(S) {
  const skin = SKINS[randInt(S.rng, 0, SKINS.length - 1)];
  const hp = Math.max(1, Math.round(creepHp(S.tide) * skin.hp));
  const x = randRange(S.rng, -COVE.halfWidth + 3, COVE.halfWidth - 3);
  const z = COVE.waterline - randRange(S.rng, 0, 2.2);
  const c = {
    id: S.nextId++,
    skin: skin.id,
    x, z, px: x, pz: z,
    hp, maxHp: hp,
    dmg: Math.max(1, Math.round(creepDmg(S.tide) * skin.dmg)),
    ms: TUNE.creep.ms * skin.ms,
    atkCd: randInt(S.rng, 0, 6),   // desync the first swing of a surf-set
    atkAnim: 0,
    dead: false, receding: false, receded: false,
    hitFlash: 0,
    bob: randInt(S.rng, 0, 999),   // cosmetic phase, drawn from the sim stream so it replays
  };
  S.creeps.push(c);
  ev(S, 'spawn', { id: c.id, skin: c.skin, x: c.x, z: c.z });
  return c;
}

function debugSpawn(S, n, skinId) {
  const out = [];
  for (let i = 0; i < (n | 0 || 1); i++) {
    if (S.creeps.length >= TUNE.coveCap) { S.queue++; continue; }
    const c = spawnOne(S);
    if (skinId && SKINS.some(s => s.id === skinId)) c.skin = skinId;
    out.push(c.id);
  }
  return out;
}

function onCreepKilled(S, c) {
  const bounty = TUNE.bountyBase + S.tide;
  S.gold += bounty;
  S.kills++;
  S.killed++;
  ev(S, 'kill', { id: c.id, x: c.x, z: c.z, gold: bounty, skin: c.skin });
}

// ---------------------------------------------------------------------------
// HERO — click-to-move with instant repath (classic-RTS feel: no acceleration, no
// turn delay, the order lands the frame you give it). Auto-attacks the nearest
// creep in range while it has no order of its own.
// ---------------------------------------------------------------------------
function orderMove(S, x, z) {
  if (S.hero.dead) return false;
  S.hero.tx = clamp(x, -COVE.halfWidth + 1, COVE.halfWidth - 1);
  S.hero.tz = clamp(z, COVE.waterline + 1.5, COVE.inland - 1);
  S.hero.hasOrder = true;
  return true;
}

function heroStep(S) {
  const h = S.hero;
  if (h.atkCd > 0) h.atkCd--;

  if (h.hasOrder) {
    const dx = h.tx - h.x, dz = h.tz - h.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= TUNE.hero.arrive) { h.hasOrder = false; }
    else {
      const step = Math.min(d, TUNE.hero.ms * TICK_S);
      h.x += (dx / d) * step;
      h.z += (dz / d) * step;
      h.facing = Math.atan2(dx, dz);
    }
  }

  // Auto-attack: nearest first. Ties break on ID, never on array index — an
  // array index is a rendering detail and will desync a shared sim (FAVOR law).
  const target = nearestCreep(S, h.x, h.z, h.hasOrder ? TUNE.hero.range : TUNE.hero.acquire);
  if (!target) return;

  const dx = target.x - h.x, dz = target.z - h.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const reach = TUNE.hero.range + TUNE.creep.radius;

  if (d > reach) {
    if (h.hasOrder) return;                // a player order outranks acquisition
    const step = Math.min(d - reach * 0.9, TUNE.hero.ms * TICK_S);
    if (step > 0) { h.x += (dx / d) * step; h.z += (dz / d) * step; }
    h.facing = Math.atan2(dx, dz);
    return;
  }

  h.facing = Math.atan2(dx, dz);
  if (h.atkCd > 0) return;
  h.atkCd = TUNE.hero.atkTicks;
  h.atkAnim = 5;
  damageCreep(S, target, h.dmg);
}

function nearestCreep(S, x, z, maxD) {
  let best = null, bestD = maxD * maxD;
  for (const c of S.creeps) {
    if (c.dead || c.receding) continue;
    const dx = c.x - x, dz = c.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD || (d2 === bestD && best && c.id < best.id)) { bestD = d2; best = c; }
  }
  return best;
}

function damageCreep(S, c, amount) {
  c.hp -= amount;
  c.hitFlash = 3;
  ev(S, 'hit', { id: c.id, x: c.x, z: c.z, amount, fatal: c.hp <= 0 });
  if (c.hp <= 0) { c.hp = 0; c.dead = true; }   // LAW 3: marked only. Swept at tick end.
}

// ---------------------------------------------------------------------------
// CREEPS — wash in, march inland at the hero, swing when they reach.
// ---------------------------------------------------------------------------
function creepStep(S, c) {
  if (c.dead) return;
  if (c.atkCd > 0) c.atkCd--;
  if (c.hitFlash > 0) c.hitFlash--;
  if (c.atkAnim > 0) c.atkAnim--;

  if (c.receding) {                     // the sea takes them back
    c.z -= (c.ms * 1.7) * TICK_S;
    return;
  }

  const h = S.hero;
  const targetX = h.dead ? 0 : h.x;
  const targetZ = h.dead ? COVE.heroStart.z : h.z;

  let dx = targetX - c.x, dz = targetZ - c.z;
  let d = Math.sqrt(dx * dx + dz * dz) || 1;
  const reach = TUNE.creep.range + TUNE.hero.radius;

  if (!h.dead && d <= reach) {
    if (c.atkCd <= 0) {
      c.atkCd = TUNE.creep.atkTicks;
      c.atkAnim = 5;
      h.hp -= c.dmg;
      h.hitFlash = 3;
      ev(S, 'hero_hit', { amount: c.dmg, id: c.id });
      if (h.hp <= 0) { h.hp = 0; heroDown(S); return; }
    }
  } else {
    const step = c.ms * TICK_S;
    c.x += (dx / d) * step;
    c.z += (dz / d) * step;
  }

  c.x = clamp(c.x, -COVE.halfWidth + 0.6, COVE.halfWidth - 0.6);
  c.z = clamp(c.z, COVE.waterline - 4, COVE.inland - 0.6);
}

// ---------------------------------------------------------------------------
// BODIES OCCUPY SPACE. One positional relaxation pass after everything has
// moved: overlapping creeps get pushed apart by half the overlap each.
//
// This is not a cosmetic anti-stacking tweak — it is THE thing that caps how
// many creeps can touch the hero at once. Without it a surf-set collapses onto
// one point and 11 of them swing from inside a metre; with it they form a ring
// and about six get to reach. That is the classic melee surround, and it is the
// difference between a fight and an execution.
//
// A creep never pushes the HERO: the player's click stays authoritative and a
// hero shoves through a crowd instead of being carried by it.
// O(n^2) at n<=40 is ~800 pair checks a tick. Free.
// ---------------------------------------------------------------------------
function resolveBodies(S) {
  const cs = S.creeps;
  const minD = TUNE.creep.radius * 2;
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    if (a.dead || a.receding) continue;
    for (let j = i + 1; j < cs.length; j++) {
      const b = cs[j];
      if (b.dead || b.receding) continue;
      let dx = a.x - b.x, dz = a.z - b.z;
      let d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      if (d2 < 1e-6) {
        // Exactly coincident: separate along a deterministic axis derived from
        // the pair's IDs, never from Math.random and never from array index.
        const ang = ((a.id * 2654435761) % 628) / 100;
        dx = Math.cos(ang); dz = Math.sin(ang); d2 = 1;
      }
      const d = Math.sqrt(d2);
      const push = (minD - d) * 0.5;
      const nx = dx / d, nz = dz / d;
      a.x += nx * push; a.z += nz * push;
      b.x -= nx * push; b.z -= nz * push;
    }
  }

  // ...and nothing stands inside the hero.
  const h = S.hero;
  if (!h.dead) {
    const minH = TUNE.creep.radius + TUNE.hero.radius;
    for (const c of cs) {
      if (c.dead || c.receding) continue;
      let dx = c.x - h.x, dz = c.z - h.z;
      let d2 = dx * dx + dz * dz;
      if (d2 >= minH * minH) continue;
      if (d2 < 1e-6) { const ang = ((c.id * 2654435761) % 628) / 100; dx = Math.cos(ang); dz = Math.sin(ang); d2 = 1; }
      const d = Math.sqrt(d2);
      c.x = h.x + (dx / d) * minH;
      c.z = h.z + (dz / d) * minH;
    }
  }

  for (const c of cs) {
    if (c.dead) continue;
    c.x = clamp(c.x, -COVE.halfWidth + 0.6, COVE.halfWidth - 0.6);
    c.z = clamp(c.z, COVE.waterline - 4, COVE.inland - 0.6);
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
