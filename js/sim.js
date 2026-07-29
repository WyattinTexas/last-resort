// SURVIVAL QUEST — THE SIM.
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
//
// Link 2 adds the GAME on top of the link-1 chassis: bodies, the one
// data-driven spell engine, purchases (pearls/gold), XP->ranks, items, fruit,
// bosses, modifier tides, and the 10-tide P0 finale. All content lives in
// data.js; this file only knows how to EXECUTE content.

import { makeSeed, mulberry32, randInt, randRange } from './rng.js';
import {
  RULES, rv, BODIES, SPELLS, SPELL, spellPrice, spellRankCap, spellUnlockTide,
  ITEMS, ITEM, FRUITS, FRUIT, MODS, MOD, BOSSES, killXp, clearXp, xpToNext,
} from './data.js';

export const SIM_HZ = 20;
export const TICK_S = 1 / SIM_HZ;
export const secs = s => Math.round(s * SIM_HZ);   // seconds -> ticks, the only conversion allowed

// ---------------------------------------------------------------------------
// THE MAP (rev 1) — the TFT structure: up to 16 PRIVATE SQUARES around one
// central MARKET. You fight tides alone in your square; between tides the
// island PORTS you to the market in the middle, where every shop stands.
// Both frames are LOCAL metre spaces (seat-independent, so the same seed
// replays identically from any square — the ghost race stays honest). The
// renderer decides where each frame sits in the world; the sim only knows
// which zone the hero is standing in. -Z is out to sea in the square frame.
// ---------------------------------------------------------------------------
export const SQUARE = {
  halfWidth: 26,      // rope-post fences stand at +/- this
  waterline: -20,     // the open sea edge (the classic door)
  inland: 22,         // the back fence / jungle wall
  heroStart: { x: 0, z: 1 },   // you hold the middle of your square
};
export const COVE = SQUARE;    // legacy alias — the node tools import COVE

export const MARKET = {
  halfWidth: 23,      // plaza walk bounds
  zMin: -20,          // the beach side (the port-in end)
  zMax: 14,           // the back arc where the racks stand
  heroStart: { x: 0, z: -14 },
};

export const ZONE = { SQUARE: 'SQUARE', MARKET: 'MARKET' };

// hero-legal walk bounds for the zone the hero is standing in
function heroBounds(S) {
  return S.zone === ZONE.MARKET
    ? { x0: -MARKET.halfWidth + 1, x1: MARKET.halfWidth - 1, z0: MARKET.zMin + 1, z1: MARKET.zMax - 1 }
    : { x0: -SQUARE.halfWidth + 1, x1: SQUARE.halfWidth - 1, z0: SQUARE.waterline + 1.5, z1: SQUARE.inland - 1 };
}

// aim clamps run a touch wider than feet — smart-cast never refuses (D3)
function aimBounds(S) {
  return S.zone === ZONE.MARKET
    ? { x0: -MARKET.halfWidth - 2, x1: MARKET.halfWidth + 2, z0: MARKET.zMin - 2, z1: MARKET.zMax + 2 }
    : { x0: -SQUARE.halfWidth - 2, x1: SQUARE.halfWidth + 2, z0: SQUARE.waterline - 6, z1: SQUARE.inland };
}

// summons walk beside you in either zone; in the square they may chase into
// the surf a little, exactly as before
function allyBounds(S) {
  return S.zone === ZONE.MARKET
    ? { x0: -MARKET.halfWidth + 0.6, x1: MARKET.halfWidth - 0.6, z0: MARKET.zMin + 0.6, z1: MARKET.zMax - 0.6 }
    : { x0: -SQUARE.halfWidth + 0.6, x1: SQUARE.halfWidth - 0.6, z0: SQUARE.waterline - 4, z1: SQUARE.inland - 0.6 };
}

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
  deadBreakTicks: secs(12), // the break AFTER a washout: you are dead on the
                            // sand and cannot shop, so 25s would be a timeout,
                            // not a breather. TUNE deviation, logged in memory.
  milestoneEvery: 5,      // milestone tides pay double pearls

  // --- economy (§6) ---
  bountyBase: 4,          // bounty = 4 + tide, per creep
  clearGoldBase: 25,      // clear bonus = 25 + 5 x tide
  clearGoldPerTide: 5,
  clearPearls: 1,
  clearPearlsMilestone: 2,
  startGold: 100,
  startPearls: 3,

  // --- hero fallback (pre-Forge chassis; a real BODY replaces this the moment
  // one is picked, and nothing can spawn before that happens) ---
  hero: {
    maxHp: 1000, regen: 8, dmg: 50, atkS: 0.5, range: 2.6, ms: 6.8, sp: 0, radius: 0.6,
  },
  heroAcquire: 7.0,       // idle auto-acquire radius (classic-RTS acquisition feel)
  heroArrive: 0.16,

  // --- ranged basics (rev 2 WS1): the wand LOBS A REAL MISSILE now. Speed 30
  // puts max-range flight at ~0.26s; retargetR is how far a missile will swing
  // to a neighbour when its target dies mid-flight (else it fizzles). These two
  // numbers are the whole DPS surface of the change — tune here, nowhere else.
  // Measured: at speed 26 the magician's full run came in 10.8s FAST (slower
  // missiles let packs bunch tighter around the hero, so the nova/aoe casts
  // hit more bodies); 30 reproduces the instant-zap pacing to +0.3s.
  basicMissile: { speed: 30, retargetR: 2.5 },

  // --- corpses (rev 2 WS3): kills leave a sim-side corpse record for a few
  // seconds. Pure DATA — zero draw calls; the render corpse beat is its own
  // independent pool. THE DROWNED TIDE eats these; WS4 entrance/death
  // theatrics may read them (skin + position ride along).
  corpse: { ttlSec: 6, cap: 16 },

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
// 0.58 is measured, not felt: at 0.42 a sensible-buys statue cleared tide 10,
// and the run-one death window (§ balance target: tides 6-8) never opened.
export function creepDmg(tide) {
  return Math.max(1, Math.round(TUNE.creep.baseDmg * Math.pow(creepHp(tide) / TUNE.creep.baseHp, 0.58)));
}

export function tideQuota(tide) {
  const base = TUNE.quotaBase + TUNE.quotaPerTide * Math.max(0, tide | 0);
  // Boss tides run a reduced quota (§6): the boss IS most of the tide.
  return RULES.bossTides.includes(tide | 0) ? Math.ceil(base / RULES.bossQuotaDiv) : base;
}

export function clearGold(tide) {
  return TUNE.clearGoldBase + TUNE.clearGoldPerTide * (tide | 0);
}

// Modifier tides (§6): from tide 6, every ~3 -> 6 and 9 inside the P0 slice.
export function isModTide(tide) {
  const t = tide | 0;
  return t >= RULES.modFromTide && (t - RULES.modFromTide) % RULES.modEvery === 0;
}

// ---------------------------------------------------------------------------
// PHASES
//   FORGE   — the run has not started: pick a body. Nothing spawns, no clocks.
//   BREAK   — between tides. Shop break, skippable; holdable while shopping.
//   TIDE    — the sea is sending them.
//   WASHOUT — hero went down. No game over in TIDES mode: the tide drags back
//             out, and you wash ashore again when the next one rolls in.
//   VICTORY — tide 10 (P0 finale) cleared. The island respects you. Run stats.
// ---------------------------------------------------------------------------
export const PHASE = { FORGE: 'FORGE', BREAK: 'BREAK', TIDE: 'TIDE', WASHOUT: 'WASHOUT', VICTORY: 'VICTORY' };

export function createSim(seedInput) {
  const seed = (seedInput && seedInput.v) ? seedInput : makeSeed(seedInput);

  const S = {
    seed,
    tick: 0,                     // THE clock. Everything else is derived from it.
    phase: PHASE.FORGE,
    phaseTicks: 0,               // ticks remaining in the current phase
    hold: false,                 // shopping at a stall holds the BREAK countdown
    zone: ZONE.MARKET,           // the run OPENS at the market: pick a body among
                                 // the stalls, spend, then the first tide ports
                                 // you home. Dead breaks stay in your square.
    setEdge: 0,                  // which fence the current surf-set breaks over
                                 // (0 sea · 1 east · 2 back · 3 west)
    edgeLog: [],                 // per-set edge telemetry (battery probe; not in
                                 // the snapshot, so it can never skew determinism
                                 // comparisons — it IS deterministic regardless)

    tide: 0,                     // the tide now running (or just survived)
    cleared: 0,                  // tides actually CLEARED. Monotonic — a washout
                                 // rolls `tide` back, but never this. Standings
                                 // and tests both want the honest count.
    tideLog: {},                 // tide -> { tick, kills, worth } at the moment
                                 // of clear. THE standings record: the ghost
                                 // race reads this and nothing else. Washout
                                 // retries fold into the same entry's time.
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

    // --- the build (link 2) ---
    bodyId: null,
    spells: {},                  // id -> { rank }
    slots: { Q: null, W: null, E: null, R: null },
    cds: {},                     // id -> ticks left
    items: [],                   // [{ id }], RULES.itemSlots max; potions burn on use
    fruit: { mango: 0, starfruit: 0, coconut: 0 },
    xp: 0, level: 1, skillPts: 0,

    // The honest money story. gold === startGold + bounty + clears - spent must
    // hold on EVERY tick — the CDP battery asserts exactly that.
    ledger: { bounty: 0, clears: 0, spent: 0, pearlsSpent: 0, pointsSpent: 0 },

    tideMod: null,               // modifier bolted onto this tide's creeps
    modByTide: {},               // rolled once per tide NUMBER: a washout retry
                                 // faces the same modifier, not a re-roll
    victory: null,

    hero: null,
    creeps: [],
    allies: [],                  // summons fight beside you (golems, the drowned)
    corpses: [],                 // WS3: fresh kills, FIFO, zone-local debris
    projs: [],                   // spell projectiles are SIM entities, law 3 applies
    pendings: [],                // scheduled impacts: meteors, boss slams
    nextId: 1,
    events: [],                  // drained by the renderer; sim never reads it back
    rng: null,
    _draws: 0,                   // how many times the stream has been pulled (determinism probe)
  };

  const base = mulberry32(seed.seed);
  S.rng = () => { S._draws++; return base(); };

  S.hero = {
    id: 0,
    x: MARKET.heroStart.x, z: MARKET.heroStart.z,   // born at the market (FORGE)
    px: MARKET.heroStart.x, pz: MARKET.heroStart.z,
    hp: TUNE.hero.maxHp, maxHp: TUNE.hero.maxHp,
    dmg: TUNE.hero.dmg,
    regen: TUNE.hero.regen,
    atkTicks: secs(TUNE.hero.atkS),
    range: TUNE.hero.range,
    ms: TUNE.hero.ms,
    sp: 0, crit: 0, lifesteal: 0, thorns: 0, cdMult: 1,
    radius: TUNE.hero.radius,
    atkCd: 0, atkAnim: 0,
    facing: 0,
    tx: MARKET.heroStart.x, tz: MARKET.heroStart.z,
    hasOrder: false,
    dead: false,
    hitFlash: 0,
    regenAcc: 0,
    stun: 0,
    shield: 0, shieldTicks: 0,
    buffs: [],                   // [{ id, ticks, mods }]
    swingN: 0,                   // suplex counter
    // WS3 verb state + recompute-derived riders (all zero for a classic build
    // — every new rng draw in the engine gates on one of these, which is how
    // the old runs stay byte-identical)
    hideTicks: 0,
    goldShieldTicks: 0, goldShieldRate: 0,
    flatDR: 0, dodgePct: 0,
    poisonPerSec: 0, poisonSec: 0, poisonSlowPct: 0,
    cleavePct: 0, cleaveR: 0,
    procPct: 0, procDmg: 0, procR: 0,
    pinchPct: 0, pinchDmg: 0, pinchSec: 0,
    burnPerSec: 0, burnR: 0,
    auraDmgPct: 0,
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
    giveXp: n => gainXp(S, n | 0),
    drainEvents: () => { const e = S.events; S.events = []; return e; },
    snapshot: () => snapshot(S),

    // --- the build API. The shop UI and the CDP battery drive the SAME calls. ---
    pickBody: id => pickBody(S, id),
    buySpell: id => buySpell(S, id),
    equip: (id, slot) => equipSpell(S, id, slot),
    rankUp: id => rankUp(S, id),
    buyFruit: (id, pack) => buyFruit(S, id, pack),
    buyItem: id => buyItem(S, id),
    useItem: idx => useItem(S, idx),
    respec: () => respec(S),
    cast: (slot, x, z) => castSpell(S, slot, x, z),
    setHold: v => { S.hold = !!v; return S.hold; },
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
  const spellsKey = Object.keys(S.spells).sort().map(id => id + ':' + S.spells[id].rank).join(',');
  return {
    v: S.seed.v, seed: S.seed.seed,
    tick: S.tick, phase: S.phase, zone: S.zone, tide: S.tide, cleared: S.cleared,
    quota: S.quota, spawned: S.spawned, killed: S.killed,
    alive: S.creeps.length, queue: S.queue,
    gold: S.gold, pearls: S.pearls, kills: S.kills, deaths: S.deaths,
    heroHp: Math.round(S.hero.hp),
    heroX: Math.round(S.hero.x * 100), heroZ: Math.round(S.hero.z * 100),
    hpSum: Math.round(hpSum), posSum,
    draws: S._draws,
    corpses: S.corpses.length,   // WS3 (additive — same-build comparisons only)
    // link 2 surface
    body: S.bodyId, xp: S.xp, level: S.level, pts: S.skillPts,
    shield: Math.round(S.hero.shield),
    projs: S.projs.length, allies: S.allies.length,
    spells: spellsKey, items: S.items.map(i => i.id).join(','),
    ledger: { ...S.ledger },
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
  for (const a of S.allies) { a.px = a.x; a.pz = a.z; }
  for (const p of S.projs) { p.px = p.x; p.pz = p.z; }

  // --- phase clock ---
  if (S.phase === PHASE.BREAK) {
    if (!S.hold) S.phaseTicks--;          // shopping at a stall holds the tide
    if (S.phaseTicks <= 0) startTide(S);
  } else if (S.phase === PHASE.WASHOUT) {
    S.phaseTicks--;
    if (S.phaseTicks <= 0) endWashout(S);
  } else if (S.phase === PHASE.TIDE) {
    spawnPhase(S);
  }
  // FORGE and VICTORY have no clock: the sea waits for a body, then forever.

  // --- timers: cooldowns, buffs, shield ---
  for (const id in S.cds) { if (S.cds[id] > 0) S.cds[id]--; }
  if (S.hero.buffs.length) {
    let expired = false;
    for (const b of S.hero.buffs) { b.ticks--; if (b.ticks <= 0) expired = true; }
    if (expired) {
      S.hero.buffs = S.hero.buffs.filter(b => b.ticks > 0);
      recomputeStats(S);
    }
  }
  if (S.hero.shield > 0) {
    S.hero.shieldTicks--;
    if (S.hero.shieldTicks <= 0) { S.hero.shield = 0; ev(S, 'shield_down'); }
  }
  if (S.hero.stun > 0) S.hero.stun--;
  if (S.hero.hideTicks > 0) S.hero.hideTicks--;
  if (S.hero.goldShieldTicks > 0) {
    S.hero.goldShieldTicks--;
    if (S.hero.goldShieldTicks <= 0) S.hero.goldShieldRate = 0;
  }

  // --- WS3 corpse records age out (FIFO by push order, so the front expires first) ---
  while (S.corpses.length && S.corpses[0].until <= S.tick) S.corpses.shift();

  // --- WS3 EMBER SKIN: the burn ring pulses every half second, tides only ---
  if (S.hero.burnPerSec > 0 && S.phase === PHASE.TIDE && !S.hero.dead && S.tick % 10 === 0) {
    areaDamage(S, S.hero.x, S.hero.z, S.hero.burnR,
      Math.max(1, Math.round(S.hero.burnPerSec / 2)), { kind: 'dot' });
  }

  // --- units ---
  if (!S.hero.dead) heroStep(S);
  for (const a of S.allies) allyStep(S, a);
  for (const c of S.creeps) creepStep(S, c);
  stepProjectiles(S);
  resolvePendings(S);
  resolveBodies(S);

  // --- regen (ALOE SALVE's heal-over-time rides the same accumulator) ---
  if (!S.hero.dead && S.hero.hp < S.hero.maxHp) {
    let hot = 0;
    for (const b of S.hero.buffs) if (b.mods.hotPerSec) hot += b.mods.hotPerSec;
    S.hero.regenAcc += (S.hero.regen + hot) * TICK_S;
    const whole = Math.floor(S.hero.regenAcc);
    if (whole > 0) { S.hero.regenAcc -= whole; S.hero.hp = Math.min(S.hero.maxHp, S.hero.hp + whole); }
  }
  if (S.hero.hitFlash > 0) S.hero.hitFlash--;
  if (S.hero.atkAnim > 0) S.hero.atkAnim--;

  // --- LAW 3: sweep the dead HERE, at the end of the tick, never mid-loop ---
  if (S.creeps.some(c => c.dead)) {
    const keep = [];
    const splits = [];
    for (const c of S.creeps) {
      if (c.dead) {
        if (!c.receded) {
          onCreepKilled(S, c);
          // WS3: a real kill leaves a corpse record for a few seconds (FIFO
          // cap — the freshest dead are the ones that matter)
          S.corpses.push({ x: c.x, z: c.z, skin: c.skin, until: S.tick + secs(TUNE.corpse.ttlSec) });
          if (S.corpses.length > TUNE.corpse.cap) S.corpses.shift();
          // SPLITTING JELLIES (modifier, §6): the sweep is the one safe place
          // to add units — the tick's loops are all behind us.
          if (S.tideMod === 'split' && !c.mini && !c.big) splits.push(c);
        }
      } else keep.push(c);
    }
    for (const c of splits) {
      for (let k = 0; k < 2; k++) {
        keep.push(makeCreep(S, {
          skin: c.skin,
          x: c.x + (k ? 0.6 : -0.6), z: c.z,
          hp: Math.max(1, Math.round(c.maxHp * 0.45)),
          dmg: Math.max(1, Math.round(c.dmg * 0.7)),
          ms: c.ms * 1.15, radius: 0.5,
          mini: true, bountyMult: 0.5, xpMult: 0.5,
        }));
      }
    }
    S.creeps = keep;
  }
  if (S.allies.some(a => a.dead)) {
    for (const a of S.allies) if (a.dead) ev(S, 'ally_down', { id: a.id });
    S.allies = S.allies.filter(a => !a.dead);
  }
  if (S.projs.some(p => p.dead)) S.projs = S.projs.filter(p => !p.dead);

  // --- tide clear check (after the sweep, so "alive" means alive) ---
  if (S.phase === PHASE.TIDE && S.killed >= S.quota && S.creeps.length === 0 && S.queue === 0) {
    clearTide(S);
  }

  return S.tick;
}

// ---------------------------------------------------------------------------
// THE PORT (rev 1) — the between-rounds teleport. Tide clears: boom, you stand
// in the market. Tide starts: boom, you stand in your square. Summons ride
// along; projectiles and scheduled impacts are zone-local debris and drop
// (nothing they could hit exists across the port). A dead castaway is never
// ported — the washout vista and the dead break play out in the square.
// ---------------------------------------------------------------------------
function portTo(S, zone) {
  if (S.zone === zone) return;
  S.zone = zone;
  const at = zone === ZONE.MARKET ? MARKET.heroStart : SQUARE.heroStart;
  const h = S.hero;
  h.x = h.px = h.tx = at.x;
  h.z = h.pz = h.tz = at.z;
  h.hasOrder = false;
  let k = 0;
  for (const a of S.allies) {
    if (a.dead) continue;
    a.x = a.px = at.x + (k % 2 ? 2.2 : -2.2);
    a.z = a.pz = at.z + 1.6 + Math.floor(k / 2) * 1.4;
    k++;
  }
  S.projs = [];
  S.pendings = [];
  S.corpses = [];                // zone-local debris, exactly like the projs
  ev(S, 'port', { to: zone, x: at.x, z: at.z });
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
  S.hold = false;
  portTo(S, ZONE.SQUARE);        // the market empties the moment a tide rolls

  // Modifier tides (§6): ONE bolted ability, rolled once per tide NUMBER so a
  // washout retry faces the same tide it lost to.
  S.tideMod = null;
  if (isModTide(S.tide)) {
    if (!S.modByTide[S.tide]) {
      const used = Object.values(S.modByTide);
      let pool = MODS.filter(m => !used.includes(m.id));
      if (!pool.length) pool = MODS;
      S.modByTide[S.tide] = pool[randInt(S.rng, 0, pool.length - 1)].id;
    }
    S.tideMod = S.modByTide[S.tide];
    ev(S, 'mod_tide', { tide: S.tide, mod: S.tideMod });
  }

  // Death is not a game over in TIDES: you wash back up with the next tide.
  if (S.hero.dead) {
    S.hero.dead = false;
    S.hero.hp = S.hero.maxHp;
    S.hero.x = S.hero.px = SQUARE.heroStart.x;
    S.hero.z = S.hero.pz = SQUARE.heroStart.z;
    S.hero.tx = SQUARE.heroStart.x; S.hero.tz = SQUARE.heroStart.z;
    S.hero.hasOrder = false;
    ev(S, 'wash_up');
  }

  const boss = BOSSES[S.tide];
  ev(S, 'tide_start', { tide: S.tide, quota: S.quota, boss: !!boss, mod: S.tideMod });
  if (boss) spawnBoss(S, boss);
}

function clearTide(S) {
  const gold = clearGold(S.tide);
  const pearls = (S.tide % TUNE.milestoneEvery === 0) ? TUNE.clearPearlsMilestone : TUNE.clearPearls;
  S.gold += gold;
  S.ledger.clears += gold;
  S.pearls += pearls;
  S.cleared++;
  if (S.tide > S.bestTide) S.bestTide = S.tide;
  // the standings entry: when, how bloody, how rich. Net worth counts the gear
  // at purchase price — spending gold must never LOWER a standings line.
  S.tideLog[S.tide] = { tick: S.tick, kills: S.kills, worth: S.gold + S.ledger.spent };
  const xp = clearXp(S.tide);
  gainXp(S, xp);
  ev(S, 'tide_clear', { tide: S.tide, gold, pearls, xp });

  if (S.tide >= RULES.finalTide) {
    S.phase = PHASE.VICTORY;
    S.phaseTicks = 0;
    S.victory = {
      tide: S.tide, cleared: S.cleared, ticks: S.tick,
      kills: S.kills, deaths: S.deaths, level: S.level,
      goldEarned: TUNE.startGold + S.ledger.bounty + S.ledger.clears,
      body: S.bodyId,
      spells: Object.keys(S.spells).map(id => ({ id, rank: S.spells[id].rank })),
      fruit: { ...S.fruit },
      tideLog: JSON.parse(JSON.stringify(S.tideLog)),   // the ghost record
    };
    ev(S, 'victory', { stats: S.victory });
    return;
  }
  S.phase = PHASE.BREAK;
  S.phaseTicks = TUNE.breakTicks;
  portTo(S, ZONE.MARKET);        // boom — spend it before the next tide
}

function skipBreak(S) {
  if (S.phase !== PHASE.BREAK) return false;
  S.hold = false;
  S.phaseTicks = 1;              // resolves on the very next tick, never mid-tick
  return true;
}

// The hero went down. The sea takes the tide back and the same tide comes
// again — no game over, no softlock on an unmeetable quota.
function heroDown(S) {
  S.hero.dead = true;
  S.hero.hp = 0;
  S.hero.hasOrder = false;
  S.hero.shield = 0;
  S.hero.buffs = [];
  S.hero.hideTicks = 0;
  S.hero.goldShieldTicks = 0;
  S.hero.goldShieldRate = 0;
  recomputeStats(S);
  S.deaths++;
  S.tide = Math.max(0, S.tide - 1);   // this tide didn't count; it rolls in again
  S.phase = PHASE.WASHOUT;
  S.phaseTicks = TUNE.washoutTicks;
  for (const c of S.creeps) c.receding = true;
  for (const a of S.allies) a.dead = true;
  S.projs = [];
  S.pendings = [];
  S.corpses = [];                // the sea takes its dead back too
  ev(S, 'hero_down', { tide: S.tide + 1 });
}

function endWashout(S) {
  for (const c of S.creeps) { c.dead = true; c.receded = true; }  // no bounty for a tide you lost
  S.queue = 0;
  S.phase = PHASE.BREAK;
  // You are DEAD on this break — no shopping, just the vista and the countdown
  // (death is a spectacle, never a logout, §3). The full 25s would be a
  // timeout; the hero stays down until the next tide actually starts.
  S.phaseTicks = TUNE.deadBreakTicks;
}

// ---------------------------------------------------------------------------
// SPAWNING (rev 1) — surf-sets of 6-8 every ~4s until the quota is in. The sea
// is no longer the only door: each SET rolls which fence it breaks over (sea /
// east / back / west), so pressure rotates around your square instead of
// forming one polite front. Tides 1-2 stay sea-only — the taught front — then
// RULES.multiEdgeFromTide opens the other three. One edge per set (not per
// creep) keeps every arrival readable and keeps kiting a real answer.
// Concurrent cap 40 per square; the remainder waits in the overflow queue.
// ---------------------------------------------------------------------------
function rollEdge(S) {
  return S.tide >= RULES.multiEdgeFromTide ? randInt(S.rng, 0, 3) : 0;
}

function spawnPhase(S) {
  // drain the overflow queue first, as soon as the square has room
  while (S.queue > 0 && S.creeps.length < TUNE.coveCap) {
    S.queue--;
    spawnOne(S);
  }

  if (S.spawned >= S.quota) return;

  S.setTimer--;
  if (S.setTimer > 0) return;
  S.setTimer = TUNE.surfSetTicks;

  S.setEdge = rollEdge(S);
  if (S.edgeLog.length < 400) S.edgeLog.push(S.setEdge);
  const want = Math.min(randInt(S.rng, TUNE.surfSetMin, TUNE.surfSetMax), S.quota - S.spawned);
  ev(S, 'surf_set', { count: want, edge: S.setEdge });
  for (let i = 0; i < want; i++) {
    S.spawned++;
    if (S.creeps.length < TUNE.coveCap) spawnOne(S);
    else S.queue++;
  }
}

function makeCreep(S, o) {
  const c = {
    id: S.nextId++,
    skin: o.skin,
    x: o.x, z: o.z, px: o.x, pz: o.z,
    hp: o.hp, maxHp: o.hp,
    dmg: o.dmg,
    ms: o.ms,
    radius: o.radius !== undefined ? o.radius : TUNE.creep.radius,
    atkTicks: o.atkTicks !== undefined ? o.atkTicks : TUNE.creep.atkTicks,
    range: o.range !== undefined ? o.range : TUNE.creep.range,
    atkCd: o.atkCd !== undefined ? o.atkCd : 0,
    atkAnim: 0,
    dead: false, receding: false, receded: false,
    hitFlash: 0,
    slowTicks: 0, slowMult: 1,
    rootTicks: 0,
    stunTicks: 0,                                  // WS3: stopped outright (feet AND claws)
    vulnTicks: 0, vulnPct: 0,                      // WS3: takes +% damage
    weakenTicks: 0, weakenPct: 0,                  // WS3: deals -% damage
    missTicks: 0, missPct: 0,                      // WS3: whiffs % of swings
    dotTicks: 0, dotPerSec: 0, dotAcc: 0,          // WS3: venom, chunked 0.5s
    bob: o.bob !== undefined ? o.bob : 0,
    mini: !!o.mini, big: !!o.big,
    bountyMult: o.bountyMult !== undefined ? o.bountyMult : 1,
    xpMult: o.xpMult !== undefined ? o.xpMult : 1,
  };
  if (o.boss) Object.assign(c, o.boss);
  S.creeps.push(c);
  // WS4: edge rides along (undefined for splits/surges/summons — they bloom in
  // place). Event fields are presentation-only; the sim never reads them back.
  ev(S, 'spawn', { id: c.id, skin: c.skin, x: c.x, z: c.z, mini: c.mini, big: c.big, edge: o.edge });
  return c;
}

function spawnOne(S) {
  const skin = SKINS[randInt(S.rng, 0, SKINS.length - 1)];
  const hp = Math.max(1, Math.round(creepHp(S.tide) * skin.hp));
  // spread along the set's fence; always exactly TWO draws so the stream shape
  // is identical whichever edge rolled
  const half = SQUARE.halfWidth;
  let x, z;
  if (S.setEdge === 1) {          // over the east fence
    z = randRange(S.rng, SQUARE.waterline + 3, SQUARE.inland - 3);
    x = half - 0.8 - randRange(S.rng, 0, 2.0);
  } else if (S.setEdge === 2) {   // over the back fence
    x = randRange(S.rng, -half + 3, half - 3);
    z = SQUARE.inland - 0.8 - randRange(S.rng, 0, 2.0);
  } else if (S.setEdge === 3) {   // over the west fence
    z = randRange(S.rng, SQUARE.waterline + 3, SQUARE.inland - 3);
    x = -half + 0.8 + randRange(S.rng, 0, 2.0);
  } else {                        // out of the sea — the classic door
    x = randRange(S.rng, -half + 3, half - 3);
    z = SQUARE.waterline - randRange(S.rng, 0, 2.2);
  }
  return makeCreep(S, {
    skin: skin.id, x, z, hp,
    dmg: Math.max(1, Math.round(creepDmg(S.tide) * skin.dmg)),
    ms: TUNE.creep.ms * skin.ms,
    atkCd: randInt(S.rng, 0, 6),   // desync the first swing of a surf-set
    bob: randInt(S.rng, 0, 999),   // cosmetic phase, drawn from the sim stream so it replays
    edge: S.setEdge,               // WS4: which fence this arrival breaks over
  });
}

// A hero-unit boss (§6): the creep template, scaled up and given ONE trick.
// It surfaces at the midpoint of a rolled fence — tide 5+ is past the taught
// front, so the king comes in from wherever it pleases.
function spawnBoss(S, spec) {
  const bossEdge = rollEdge(S);
  const BOSS_SPOTS = [
    { x: 0, z: SQUARE.waterline - 1 },
    { x: SQUARE.halfWidth - 1.2, z: 1 },
    { x: 0, z: SQUARE.inland - 1.2 },
    { x: -SQUARE.halfWidth + 1.2, z: 1 },
  ];
  const at = BOSS_SPOTS[bossEdge];
  const c = makeCreep(S, {
    skin: spec.skin,
    x: at.x, z: at.z,
    hp: Math.round(creepHp(S.tide) * spec.hpMult),
    dmg: Math.round(creepDmg(S.tide) * spec.dmgMult),
    ms: spec.ms,
    radius: spec.radius,
    atkTicks: secs(spec.atkS),
    range: 1.4,
    big: true,
    bountyMult: spec.bountyMult,
    xpMult: 6,
    boss: {
      bossId: spec.id, bossName: spec.name, scale: spec.scale,
      slamCd: secs(2.5),           // first slam comes soon but not instantly
      slamCdMax: secs(spec.slamCd), slamMult: spec.slamMult, slamR: spec.slamR,
      surgeAt: spec.surgeAt || 0, surgeCount: spec.surgeCount || 0, surged: false,
    },
  });
  ev(S, 'boss_spawn', { id: c.id, name: spec.name, bossId: spec.id,
    x: at.x, z: at.z, edge: bossEdge, skin: spec.skin });   // WS4: staging reads these
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
  const bounty = Math.max(1, Math.round((TUNE.bountyBase + S.tide) * c.bountyMult));
  S.gold += bounty;
  S.ledger.bounty += bounty;
  S.kills++;
  S.killed++;
  gainXp(S, Math.max(1, Math.round(killXp(S.tide) * c.xpMult)));
  ev(S, 'kill', { id: c.id, x: c.x, z: c.z, gold: bounty, skin: c.skin, big: c.big, mini: c.mini });
  if (c.big) ev(S, 'boss_down', { name: c.bossName });
  // RIPTIDE FEET (Pearl Diver innate): kills grant a burst of speed.
  if (S.bodyId === 'diver') addBuff(S, { id: 'riptide', ticks: secs(1.5), mods: { msMult: 1.45 } });
}

// ---------------------------------------------------------------------------
// XP — levels buy depth. A level is a skill point and NOTHING else (§2/§6).
// ---------------------------------------------------------------------------
function gainXp(S, amount) {
  if (S.level >= RULES.levelCap || amount <= 0) return;
  S.xp += amount;
  while (S.level < RULES.levelCap && S.xp >= xpToNext(S.level)) {
    S.xp -= xpToNext(S.level);
    S.level++;
    S.skillPts++;
    ev(S, 'level_up', { level: S.level, pts: S.skillPts });
  }
  if (S.level >= RULES.levelCap) S.xp = 0;
}

// ---------------------------------------------------------------------------
// THE FORGE + THE RACKS — every purchase the shop UI can make, as sim calls.
// The CDP battery drives these same functions; the UI owns nothing.
// Every mutator returns { ok } or { ok:false, why } — why is a short code the
// UI turns into a TXT() line.
// ---------------------------------------------------------------------------
function pickBody(S, id) {
  if (S.phase !== PHASE.FORGE) return { ok: false, why: 'phase' };
  const body = BODIES.find(b => b.id === id);
  if (!body) return { ok: false, why: 'none' };
  S.bodyId = id;
  recomputeStats(S);
  S.hero.hp = S.hero.maxHp;
  S.phase = PHASE.BREAK;
  S.phaseTicks = TUNE.breakTicks;
  ev(S, 'body_pick', { id });
  return { ok: true };
}

// the tide the player is ON: the one running, or the one the break leads to
export function tideNow(S) {
  return S.phase === PHASE.TIDE ? S.tide : S.tide + 1;
}

function buySpell(S, id) {
  const sp = SPELL[id];
  if (!sp) return { ok: false, why: 'none' };
  if (S.phase === PHASE.FORGE) return { ok: false, why: 'phase' };
  if (S.spells[id]) return { ok: false, why: 'owned' };
  if (tideNow(S) < spellUnlockTide(sp)) return { ok: false, why: 'locked' };
  const price = spellPrice(sp);
  if (S.pearls < price) return { ok: false, why: 'pearls' };
  S.pearls -= price;
  S.ledger.pearlsSpent += price;
  S.spells[id] = { rank: 1 };
  // auto-slot: bigs go to R, everything else to the first open QWE slot
  let slot = null;
  if (sp.tier === 'big') { if (!S.slots.R) slot = 'R'; }
  else { for (const k of ['Q', 'W', 'E']) if (!S.slots[k]) { slot = k; break; } }
  if (slot) S.slots[slot] = id;
  recomputeStats(S);
  ev(S, 'buy_spell', { id, slot });
  return { ok: true, slot };
}

function equipSpell(S, id, slot) {
  if (!['Q', 'W', 'E', 'R'].includes(slot)) return { ok: false, why: 'none' };
  if (id === null) { S.slots[slot] = null; recomputeStats(S); return { ok: true }; }
  const sp = SPELL[id];
  if (!sp || !S.spells[id]) return { ok: false, why: 'none' };
  if (sp.tier === 'big' && slot !== 'R') return { ok: false, why: 'slot' };
  if (sp.tier !== 'big' && slot === 'R') return { ok: false, why: 'slot' };
  // one spell, one slot: clear it from wherever it sat
  for (const k of ['Q', 'W', 'E', 'R']) if (S.slots[k] === id) S.slots[k] = null;
  S.slots[slot] = id;
  recomputeStats(S);
  ev(S, 'equip', { id, slot });
  return { ok: true };
}

function rankUp(S, id) {
  const sp = SPELL[id];
  if (!sp || !S.spells[id]) return { ok: false, why: 'none' };
  if (S.skillPts < 1) return { ok: false, why: 'points' };
  if (S.spells[id].rank >= spellRankCap(sp)) return { ok: false, why: 'cap' };
  S.skillPts--;
  S.ledger.pointsSpent++;
  S.spells[id].rank++;
  recomputeStats(S);
  ev(S, 'rank_up', { id, rank: S.spells[id].rank });
  return { ok: true, rank: S.spells[id].rank };
}

function buyFruit(S, id, pack) {
  const f = FRUIT[id];
  if (!f) return { ok: false, why: 'none' };
  const n = pack ? RULES.fruitPackSize : 1;
  const price = pack ? RULES.fruitPackPrice : RULES.fruitPrice;
  if (S.fruit[id] + n > RULES.fruitCap) return { ok: false, why: 'cap' };
  if (S.gold < price) return { ok: false, why: 'gold' };
  S.gold -= price;
  S.ledger.spent += price;
  S.fruit[id] += n;
  recomputeStats(S);
  ev(S, 'buy_fruit', { id, n, rank: S.fruit[id] });
  return { ok: true, rank: S.fruit[id] };
}

function buyItem(S, id) {
  const it = ITEM[id];
  if (!it) return { ok: false, why: 'none' };
  if (S.items.length >= RULES.itemSlots) return { ok: false, why: 'slots' };
  if (S.gold < it.price) return { ok: false, why: 'gold' };
  S.gold -= it.price;
  S.ledger.spent += it.price;
  S.items.push({ id });
  recomputeStats(S);
  ev(S, 'buy_item', { id });
  return { ok: true };
}

function useItem(S, idx) {
  const inst = S.items[idx | 0];
  if (!inst) return { ok: false, why: 'none' };
  const it = ITEM[inst.id];
  if (it.kind !== 'potion') return { ok: false, why: 'kind' };
  if (S.hero.dead) return { ok: false, why: 'dead' };
  const u = it.use;
  if (u.heal) {
    const healed = Math.min(S.hero.maxHp - S.hero.hp, u.heal);
    S.hero.hp += healed;
    ev(S, 'heal', { x: S.hero.x, z: S.hero.z, amount: Math.round(healed) });
  }
  if (u.shield) { S.hero.shield = u.shield; S.hero.shieldTicks = secs(u.sec || 10); ev(S, 'shield_up', { amount: u.shield }); }
  if (u.buff) {
    const { sec, ...mods } = u.buff;
    addBuff(S, { id: inst.id, ticks: secs(sec), mods });
  }
  S.items.splice(idx | 0, 1);   // inventory is UI-side state, not a unit array
  recomputeStats(S);
  ev(S, 'use_item', { id: inst.id });
  return { ok: true };
}

// THE TIDE TABLET (§2: cheap respec is SACRED). 100g: every pearl comes back,
// every skill point comes back, the racks reopen. Experimentation is the game.
function respec(S) {
  if (S.gold < RULES.respecCost) return { ok: false, why: 'gold' };
  if (!Object.keys(S.spells).length) return { ok: false, why: 'none' };
  S.gold -= RULES.respecCost;
  S.ledger.spent += RULES.respecCost;
  const pearlsBack = S.ledger.pearlsSpent;
  const pointsBack = S.ledger.pointsSpent;
  S.pearls += pearlsBack;
  S.skillPts += pointsBack;
  S.ledger.pearlsSpent = 0;
  S.ledger.pointsSpent = 0;
  S.spells = {};
  S.slots = { Q: null, W: null, E: null, R: null };
  S.cds = {};
  recomputeStats(S);
  ev(S, 'respec', { pearlsBack, pointsBack });
  return { ok: true, pearlsBack, pointsBack };
}

function addBuff(S, buff) {
  const cur = S.hero.buffs.find(b => b.id === buff.id);
  if (cur) { cur.ticks = buff.ticks; cur.mods = buff.mods; }
  else S.hero.buffs.push(buff);
  recomputeStats(S);
}

// ---------------------------------------------------------------------------
// DERIVED STATS — one pure recompute from body + fruit + items + slotted
// passives + buffs. Nothing increments stats in place; drift is impossible.
// ---------------------------------------------------------------------------
function recomputeStats(S) {
  const h = S.hero;
  const body = BODIES.find(b => b.id === S.bodyId);
  const base = body ? body.base : TUNE.hero;

  let dmgFlat = 0, hpFlat = 0, regenFlat = 0, spFlat = 0;
  let asPct = 0, msPct = 0, crit = 0, lifesteal = 0, thorns = 0;
  let dmgMult = 1, asMult = 1, msMult = 1;

  // fruit (§6 tome economy)
  dmgFlat += FRUIT.mango.per.dmg * S.fruit.mango;
  spFlat += FRUIT.mango.per.sp * S.fruit.mango;
  asPct += FRUIT.starfruit.per.asPct * S.fruit.starfruit;
  msPct += FRUIT.starfruit.per.msPct * S.fruit.starfruit;
  hpFlat += FRUIT.coconut.per.hp * S.fruit.coconut;
  regenFlat += FRUIT.coconut.per.regen * S.fruit.coconut;

  // items (passives; potions act through buffs)
  for (const inst of S.items) {
    const m = ITEM[inst.id].mods;
    if (!m) continue;
    dmgFlat += m.dmg || 0; hpFlat += m.hp || 0; regenFlat += m.regen || 0;
    spFlat += m.sp || 0; asPct += m.asPct || 0; msPct += m.msPct || 0;
  }

  // slotted passives ONLY — three slots force real choices (§6's 3+1 layout).
  // WS3: the scan includes R now (SECOND SUNRISE is an R-slot passive big) —
  // every shipped big before it is an active, so nothing changes for them.
  // spNow mirrors the h.sp assignment below exactly (passives never grant sp),
  // so sp-scaled riders like SHOREBREAK's proc damage compute here once.
  let flatDR = 0, dodgePct = 0, poisonPerSec = 0, poisonSec = 0, poisonSlowPct = 0;
  let cleavePct = 0, cleaveR = 0, procPct = 0, procDmg = 0, procR = 0;
  let pinchPct = 0, pinchDmg = 0, pinchSec = 0, burnPerSec = 0, burnR = 0;
  let dmgPct = 0, cdrPct = 0;
  const spNow = Math.round(base.sp + spFlat);
  for (const k of ['Q', 'W', 'E', 'R']) {
    const id = S.slots[k];
    if (!id) continue;
    const sp = SPELL[id];
    if (!sp || sp.kind !== 'passive') continue;
    const r = S.spells[id].rank;
    const fx = sp.fx;
    if (fx.crit) crit += rv(fx.crit, r);
    if (fx.lifesteal) lifesteal += rv(fx.lifesteal, r);
    if (fx.asPct) asPct += rv(fx.asPct, r);
    if (fx.msPct) msPct += rv(fx.msPct, r);
    if (fx.thorns) thorns += rv(fx.thorns, r);
    // --- the WS3 rider set ---
    if (fx.flatDR) flatDR += rv(fx.flatDR, r);
    if (fx.dodgePct) dodgePct += rv(fx.dodgePct, r);
    if (fx.poisonPerSec) {
      poisonPerSec = Math.max(poisonPerSec, rv(fx.poisonPerSec, r));
      poisonSec = fx.poisonSec;
      poisonSlowPct = fx.poisonSlowPct;
    }
    if (fx.cleavePct) { cleavePct += rv(fx.cleavePct, r); cleaveR = Math.max(cleaveR, fx.cleaveR); }
    if (fx.procPct) {
      procPct += rv(fx.procPct, r);
      procDmg = Math.round(rv(fx.procDmg, r) + spNow * (fx.procSpc || 0));
      procR = fx.procR;
    }
    if (fx.pinchPct) { pinchPct += rv(fx.pinchPct, r); pinchDmg = rv(fx.pinchDmg, r); pinchSec = fx.pinchSec; }
    if (fx.burnPerSec) { burnPerSec += rv(fx.burnPerSec, r); burnR = Math.max(burnR, rv(fx.burnR, r)); }
    if (fx.dmgPct) dmgPct += rv(fx.dmgPct, r);
    if (fx.cdrPct) cdrPct += rv(fx.cdrPct, r);
  }

  // timed buffs (avatar, riptide feet, juices)
  for (const b of S.hero.buffs) {
    const m = b.mods;
    if (m.dmgMult) dmgMult *= m.dmgMult;
    if (m.asMult) asMult *= m.asMult;
    if (m.msMult) msMult *= m.msMult;
    if (m.dmgFlat) dmgFlat += m.dmgFlat;
  }

  // TIKI DRUMS folds into the damage multiplier (and feeds the summons)
  dmgMult *= (1 + dmgPct / 100);

  const oldMax = h.maxHp;
  h.maxHp = Math.round(base.maxHp + hpFlat);
  if (h.maxHp > oldMax && !h.dead) h.hp = Math.min(h.maxHp, h.hp + (h.maxHp - oldMax));
  h.hp = Math.min(h.hp, h.maxHp);
  h.regen = base.regen + regenFlat;
  h.dmg = Math.round((base.dmg + dmgFlat) * dmgMult);
  h.atkTicks = Math.max(2, Math.round(secs(base.atkS) / ((1 + asPct / 100) * asMult)));
  h.ms = base.ms * (1 + msPct / 100) * msMult;
  h.range = base.range;
  h.radius = base.radius;
  h.sp = Math.round(base.sp + spFlat);
  h.crit = crit;
  h.lifesteal = lifesteal;
  h.thorns = thorns;
  // WS3 riders land as plain hero stats — recomputed, never incremented
  h.flatDR = flatDR;
  h.dodgePct = dodgePct;
  h.poisonPerSec = poisonPerSec; h.poisonSec = poisonSec; h.poisonSlowPct = poisonSlowPct;
  h.cleavePct = cleavePct; h.cleaveR = cleaveR;
  h.procPct = procPct; h.procDmg = procDmg; h.procR = procR;
  h.pinchPct = pinchPct; h.pinchDmg = pinchDmg; h.pinchSec = pinchSec;
  h.burnPerSec = burnPerSec; h.burnR = burnR;
  h.auraDmgPct = dmgPct;
  // ENCORE innate × TRADE WINDS aura — the HUD and the charge both read this live
  h.cdMult = ((S.bodyId === 'magician') ? 0.85 : 1) * (1 - cdrPct / 100);
}

// ---------------------------------------------------------------------------
// THE SPELL ENGINE — one interpreter, thirty-eight data rows, zero bespoke
// spells. Numbers: value = rv(spec, rank) (+ sp × spc where damage-like).
// ---------------------------------------------------------------------------
function castSpell(S, slotKey, ax, az) {
  if (S.phase === PHASE.FORGE || S.phase === PHASE.WASHOUT) return { ok: false, why: 'phase' };
  const h = S.hero;
  if (h.dead) return { ok: false, why: 'dead' };
  if (h.stun > 0) return { ok: false, why: 'stun' };
  const id = S.slots[slotKey];
  if (!id) return { ok: false, why: 'empty' };
  const sp = SPELL[id];
  if (sp.kind === 'passive') return { ok: false, why: 'passive' };
  if ((S.cds[id] || 0) > 0) return { ok: false, why: 'cd', left: S.cds[id] };
  const rank = S.spells[id].rank;
  const fx = sp.fx;

  // aim lands inside the zone you stand in, always — smart-cast never refuses (D3)
  const ab = aimBounds(S);
  ax = clamp(ax === undefined ? h.x : ax, ab.x0, ab.x1);
  az = clamp(az === undefined ? h.z : az, ab.z0, ab.z1);

  // WS3: refusals that depend on the world refuse BEFORE the cooldown spends.
  // A bolt with nothing to crack and a corpse-raise over clean sand both cost
  // nothing — the refusal string teaches, the purse and the clock stay whole.
  let boltTgt = null;
  if (fx.type === 'bolt') {
    boltTgt = nearestCreepTo(S, ax, az, 3.5, null) || nearestCreepTo(S, h.x, h.z, 9, null);
    if (!boltTgt) return { ok: false, why: 'target' };
  }
  if (fx.type === 'summon' && fx.fromCorpses && S.corpses.length === 0) {
    return { ok: false, why: 'corpses' };
  }

  S.cds[id] = Math.round(secs(sp.cd) * h.cdMult);
  ev(S, 'cast', { id, cat: sp.cat, x: h.x, z: h.z, ax, az });

  // SQUID INK: doing anything loud blows the cover — any other cast included
  if (fx.type !== 'hide' && h.hideTicks > 0) { h.hideTicks = 0; ev(S, 'unhide'); }

  const D = spec => Math.round(rv(spec, rank) + (fx.spc ? h.sp * fx.spc : 0));
  // the shared status-rider bundle: any area verb can carry any of these
  const riderOpts = () => ({
    cat: sp.cat,
    slowPct: fx.slowPct ? rv(fx.slowPct, rank) : 0, slowSec: fx.slowSec || 0,
    rootSec: fx.rootSec ? rv(fx.rootSec, rank) : 0,
    stunSec: fx.stunSec ? rv(fx.stunSec, rank) : 0,
    vulnPct: fx.vulnPct ? rv(fx.vulnPct, rank) : 0, vulnSec: fx.vulnSec || 0,
    weakenPct: fx.weakenPct ? rv(fx.weakenPct, rank) : 0,
    weakenSec: fx.weakenSec ? rv(fx.weakenSec, rank) : 0,
    missPct: fx.missPct ? rv(fx.missPct, rank) : 0, missSec: fx.missSec || 0,
  });

  switch (fx.type) {
    case 'proj': {
      const count = Math.round(rv(fx.count, rank));
      let dx = ax - h.x, dz = az - h.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      const baseAng = Math.atan2(dx, dz);
      const spread = (fx.spread * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        const off = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
        const a = baseAng + off;
        S.projs.push({
          id: S.nextId++,
          x: h.x, z: h.z, px: h.x, pz: h.z,
          dx: Math.sin(a), dz: Math.cos(a),
          speed: fx.speed,
          traveled: 0,
          maxDist: fx.aoe > 0 ? Math.max(3, d) : 11,
          aoe: fx.aoe, dmg: D(fx.dmg),
          slowPct: fx.slowPct ? rv(fx.slowPct, rank) : 0,
          slowSec: fx.slowSec || 0,
          cat: sp.cat, dead: false,
        });
      }
      break;
    }
    case 'nova': {
      const r = rv(fx.radius, rank);
      areaDamage(S, h.x, h.z, r, D(fx.dmg), riderOpts());
      ev(S, 'aoe_hit', { x: h.x, z: h.z, r, cat: sp.cat, stun: !!fx.stunSec });
      break;
    }
    case 'aoe': {
      const r = rv(fx.radius, rank);
      areaDamage(S, ax, az, r, D(fx.dmg), riderOpts());
      // slow/root/stun flags let the state change have a BIRTH on screen (WS1)
      // — a crackle ring at the blast, not just a tint that was suddenly there
      ev(S, 'aoe_hit', { x: ax, z: az, r, cat: sp.cat, slow: !!fx.slowPct, root: !!fx.rootSec, stun: !!fx.stunSec });
      break;
    }
    case 'bolt': {
      // the WS1 homing lane, generalised: a spell missile at the acquired
      // creep (boltTgt was proven above), riders land on CONNECT
      S.projs.push({
        id: S.nextId++,
        kind: 'bolt',
        x: h.x, z: h.z, px: h.x, pz: h.z,
        tgt: boltTgt.id,
        speed: fx.speed,
        traveled: 0,
        maxDist: Math.max(0.1, Math.hypot(boltTgt.x - h.x, boltTgt.z - h.z)),
        dmg: D(fx.dmg),
        stunSec: fx.stunSec || 0,
        drainPct: fx.drainPct || 0,
        cat: sp.cat, dead: false,
      });
      break;
    }
    case 'line': {
      // RIPCURRENT: a travelling tear that never dies on contact — each creep
      // it crosses is hit exactly once (the hit list), gone at full distance
      let dx = ax - h.x, dz = az - h.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.001) { dx = Math.sin(h.facing); dz = Math.cos(h.facing); }
      else { dx /= d; dz /= d; }
      S.projs.push({
        id: S.nextId++,
        kind: 'line',
        x: h.x, z: h.z, px: h.x, pz: h.z,
        dx, dz,
        speed: fx.speed,
        traveled: 0,
        dist: fx.dist,
        width: fx.width,
        dmg: D(fx.dmg),
        hit: [],
        cat: sp.cat, dead: false,
      });
      break;
    }
    case 'goldshield': {
      // COWRIE WARD: the purse takes the hits (the burn itself lives in
      // hurtHero, where the ledger law is enforced by construction)
      S.hero.goldShieldTicks = secs(fx.sec);
      S.hero.goldShieldRate = rv(fx.rate, rank);
      ev(S, 'gold_ward', { sec: fx.sec });
      break;
    }
    case 'hide': {
      S.hero.hideTicks = secs(rv(fx.sec, rank));
      ev(S, 'hide', { sec: rv(fx.sec, rank) });
      break;
    }
    case 'chain': {
      const jumps = Math.round(rv(fx.jumps, rank));
      let dmg = D(fx.dmg);
      const pts = [{ x: h.x, z: h.z }];
      const hit = new Set();
      let from = nearestCreepTo(S, ax, az, 3.5, hit) || nearestCreepTo(S, h.x, h.z, 9, hit);
      for (let i = 0; i < jumps && from; i++) {
        hit.add(from.id);
        pts.push({ x: from.x, z: from.z });
        damageCreep(S, from, Math.round(dmg), { spell: true });
        dmg *= fx.falloff;
        from = nearestCreepTo(S, from.x, from.z, fx.jumpRange, hit);
      }
      ev(S, 'chain', { pts });
      break;
    }
    case 'shield': {
      const amt = D(fx.amount);
      S.hero.shield = amt;
      S.hero.shieldTicks = secs(fx.sec);
      ev(S, 'shield_up', { amount: amt });
      break;
    }
    case 'heal': {
      const amt = Math.min(S.hero.maxHp - S.hero.hp, D(fx.amount));
      S.hero.hp += amt;
      ev(S, 'heal', { x: h.x, z: h.z, amount: amt });
      break;
    }
    case 'dash': {
      const dist = rv(fx.dist, rank);
      let dx = ax - h.x, dz = az - h.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = Math.min(dist, d);
      const x0 = h.x, z0 = h.z;
      const hb = heroBounds(S);
      h.x = clamp(h.x + (dx / d) * step, hb.x0, hb.x1);
      h.z = clamp(h.z + (dz / d) * step, hb.z0, hb.z1);
      h.px = h.x; h.pz = h.z;      // a blink does not interpolate
      h.stun = 0;                  // sheds stuns — the escape button works
      h.hasOrder = false;
      h.facing = Math.atan2(dx, dz);
      ev(S, 'dash', { x0, z0, x1: h.x, z1: h.z });
      break;
    }
    case 'rain': {
      const count = Math.round(rv(fx.count, rank));
      const dmg = D(fx.dmg);
      const span = secs(fx.sec);
      for (let i = 0; i < count; i++) {
        const rx = clamp(ax + randRange(S.rng, -fx.spreadR, fx.spreadR), ab.x0, ab.x1);
        const rz = clamp(az + randRange(S.rng, -fx.spreadR, fx.spreadR), ab.z0, ab.z1);
        const due = S.tick + secs(0.8) + Math.round((i / count) * span);
        S.pendings.push({ due, x: rx, z: rz, r: fx.hitR, dmg, side: 'friendly', cat: sp.cat });
        ev(S, 'meteor_warn', { x: rx, z: rz, ticks: due - S.tick, r: fx.hitR });
      }
      break;
    }
    case 'buff': {
      const mods = { dmgMult: rv(fx.dmgMult, rank), asMult: fx.asMult };
      // ALOE SALVE: the total restore spread across the duration, riding the
      // regen accumulator (dead heroes don't tick it, overheal does nothing)
      if (fx.hotAmount) mods.hotPerSec = D(fx.hotAmount) / fx.sec;
      addBuff(S, { id: sp.id, ticks: secs(fx.sec), mods });
      if (fx.shield) {
        const amt = D(fx.shield);
        S.hero.shield = amt;
        S.hero.shieldTicks = secs(fx.sec);
        ev(S, 'shield_up', { amount: amt });
      }
      break;
    }
    case 'summon': {
      // recasting replaces YOUR OWN standing units of this spell only — the
      // golem and the drowned coexist (one golem today: behaviour-identical)
      for (const a of S.allies) if (a.src === sp.id) a.dead = true;
      const hpEach = D(fx.hp);
      const spawnAlly = (sx, sz) => {
        const gb = heroBounds(S);
        S.allies.push({
          id: S.nextId++,
          x: clamp(sx, gb.x0, gb.x1),
          z: clamp(sz, gb.z0, gb.z1),
          px: sx, pz: sz,
          hp: hpEach, maxHp: hpEach,
          dmg: Math.round(rv(fx.dmg, rank)),
          atkTicks: secs(fx.atkS), atkCd: 0, atkAnim: 0,
          range: fx.range, ms: fx.ms, radius: fx.radius,
          ttl: secs(fx.sec),
          facing: 0, dead: false, hitFlash: 0,
          kind: fx.unit || 'golem', src: sp.id,
        });
      };
      if (fx.fromCorpses) {
        // THE DROWNED TIDE: consume the n FRESHEST corpses (the tail of the
        // FIFO — deterministic), raise each drowned crab where its body lay
        const n = Math.min(Math.round(rv(fx.count, rank)), S.corpses.length);
        const used = S.corpses.splice(S.corpses.length - n, n);
        for (const co of used) spawnAlly(co.x, co.z);
        ev(S, 'summon', { x: used[0].x, z: used[0].z, count: n });
      } else {
        const gx = clamp(ax, h.x - 4, h.x + 4), gz = clamp(az, h.z - 4, h.z + 4);
        spawnAlly(gx, gz);
        ev(S, 'summon', { x: gx, z: gz });
      }
      break;
    }
  }
  return { ok: true };
}

// damage every living creep in a circle; riders apply slows/roots/stuns and
// the WS3 debuff set. A zero-damage cast (FOGHORN, GULL SWARM) applies riders
// ONLY — no hit events, no floats, no batch-kill pollution. Stuns and roots
// always land at HALF duration on a boss — one rule, every tooltip states it.
function areaDamage(S, x, z, r, dmg, o) {
  for (const c of S.creeps) {
    if (c.dead || c.receding) continue;
    const dx = c.x - x, dz = c.z - z;
    if (dx * dx + dz * dz > (r + c.radius) * (r + c.radius)) continue;
    if (dmg > 0) damageCreep(S, c, dmg, { spell: true, kind: o.kind });
    if (o.slowPct) { c.slowTicks = secs(o.slowSec); c.slowMult = 1 - o.slowPct / 100; }
    if (o.rootSec) c.rootTicks = secs(o.rootSec * (c.big ? 0.5 : 1));
    if (o.stunSec) c.stunTicks = secs(o.stunSec * (c.big ? 0.5 : 1));
    if (o.vulnPct) { c.vulnTicks = secs(o.vulnSec); c.vulnPct = o.vulnPct; }
    if (o.weakenPct) { c.weakenTicks = secs(o.weakenSec); c.weakenPct = o.weakenPct; }
    if (o.missPct) { c.missTicks = secs(o.missSec); c.missPct = o.missPct; }
  }
}

function nearestCreepTo(S, x, z, maxD, exclude) {
  let best = null, bestD = maxD * maxD;
  for (const c of S.creeps) {
    if (c.dead || c.receding) continue;
    if (exclude && exclude.has(c.id)) continue;
    const dx = c.x - x, dz = c.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD || (d2 === bestD && best && c.id < best.id)) { bestD = d2; best = c; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// PROJECTILES — sim entities under the same laws as units.
// ---------------------------------------------------------------------------
function stepProjectiles(S) {
  for (const p of S.projs) {
    if (p.dead) continue;

    // The homing lane (rev 2 WS1, generalised by WS3): the ranged BASIC and
    // the spell BOLT both home on their target's current position. Target died
    // mid-flight? Swing to the nearest living creep within retargetR
    // (deterministic lowest-id tie-break, same as every other nearest), else
    // fizzle silently — overkill shots simply vanish. Damage, crit, lifesteal
    // and the bolt riders (stun / drain) all land on CONNECT.
    if (p.kind === 'basic' || p.kind === 'bolt') {
      let tgt = null;
      for (const c of S.creeps) {
        if (c.id === p.tgt) { if (!c.dead && !c.receding) tgt = c; break; }
      }
      if (!tgt) {
        tgt = nearestCreepTo(S, p.x, p.z, TUNE.basicMissile.retargetR, null);
        if (!tgt) { p.dead = true; continue; }
        p.tgt = tgt.id;
        // the render lob normalises on maxDist; keep it honest across a retarget
        p.maxDist = Math.max(p.maxDist, p.traveled + Math.hypot(tgt.x - p.x, tgt.z - p.z));
      }
      const dx = tgt.x - p.x, dz = tgt.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d <= 0.45 + tgt.radius) {
        p.dead = true;
        const h = S.hero;
        if (p.kind === 'basic') {
          damageCreep(S, tgt, p.dmg, { kind: 'shot', crit: p.crit });
          if (h.lifesteal > 0 && !h.dead) h.hp = Math.min(h.maxHp, h.hp + p.dmg * (h.lifesteal / 100));
          if (h.poisonPerSec > 0) applyPoison(S, tgt, h);   // JELLY STING rides wand connects too
          ev(S, 'proj_hit', { x: p.x, z: p.z, r: 0.5, basic: true });
        } else {
          damageCreep(S, tgt, p.dmg, { kind: 'spell' });
          if (p.stunSec) c_stun(tgt, p.stunSec);
          if (p.drainPct && !h.dead) {
            const heal = Math.min(h.maxHp - h.hp, Math.round(p.dmg * p.drainPct / 100));
            if (heal > 0) { h.hp += heal; ev(S, 'heal', { x: h.x, z: h.z, amount: heal }); }
          }
          ev(S, 'proj_hit', { x: p.x, z: p.z, r: 0.6, cat: p.cat, stun: !!p.stunSec });
        }
        continue;
      }
      const step = Math.min(d, p.speed * TICK_S);
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
      p.traveled += step;
      continue;
    }

    // The LINE (WS3, RIPCURRENT): a travelling tear that never dies on
    // contact. Each tick it sweeps a segment; every living creep within
    // width of that segment is hit exactly once (the hit list). Dies only
    // at full distance.
    if (p.kind === 'line') {
      const step = p.speed * TICK_S;
      const x0 = p.x, z0 = p.z;
      p.x += p.dx * step;
      p.z += p.dz * step;
      p.traveled += step;
      for (const c of S.creeps) {
        if (c.dead || c.receding) continue;
        if (p.hit.includes(c.id)) continue;
        const along = Math.max(0, Math.min(step, (c.x - x0) * p.dx + (c.z - z0) * p.dz));
        const qx = x0 + p.dx * along, qz = z0 + p.dz * along;
        const dx = c.x - qx, dz = c.z - qz;
        const rr = p.width + c.radius;
        if (dx * dx + dz * dz <= rr * rr) {
          p.hit.push(c.id);
          damageCreep(S, c, p.dmg, { spell: true });
          ev(S, 'proj_hit', { x: c.x, z: c.z, r: 0.8, cat: p.cat });
        }
      }
      if (p.traveled >= p.dist) p.dead = true;
      continue;
    }

    const step = p.speed * TICK_S;
    p.x += p.dx * step;
    p.z += p.dz * step;
    p.traveled += step;

    // first body it touches
    let hit = null;
    for (const c of S.creeps) {
      if (c.dead || c.receding) continue;
      const dx = c.x - p.x, dz = c.z - p.z;
      const rr = 0.5 + c.radius;
      if (dx * dx + dz * dz <= rr * rr) {
        if (!hit || c.id < hit.id) hit = c;   // deterministic tie: lowest id
      }
    }

    const expire = p.traveled >= p.maxDist;
    if (!hit && !expire) continue;
    p.dead = true;

    if (p.aoe > 0) {
      // burst where it landed — on the creep it met, or at the aim point
      areaDamage(S, p.x, p.z, p.aoe, p.dmg, { slowPct: p.slowPct, slowSec: p.slowSec });
      ev(S, 'proj_hit', { x: p.x, z: p.z, r: p.aoe, cat: p.cat, slow: p.slowPct > 0 });
    } else if (hit) {
      damageCreep(S, hit, p.dmg, { spell: true });
      if (p.slowPct) { hit.slowTicks = secs(p.slowSec); hit.slowMult = 1 - p.slowPct / 100; }
      ev(S, 'proj_hit', { x: p.x, z: p.z, r: 0.6, cat: p.cat, slow: p.slowPct > 0 });
    }
  }
}

// scheduled impacts: meteors (friendly) and boss slams (hostile)
function resolvePendings(S) {
  if (!S.pendings.length) return;
  const keep = [];
  for (const pd of S.pendings) {
    if (pd.due > S.tick) { keep.push(pd); continue; }
    if (pd.side === 'friendly') {
      areaDamage(S, pd.x, pd.z, pd.r, pd.dmg, { cat: pd.cat });
      ev(S, 'aoe_hit', { x: pd.x, z: pd.z, r: pd.r, cat: pd.cat });
    } else {
      const h = S.hero;
      if (!h.dead) {
        const dx = h.x - pd.x, dz = h.z - pd.z;
        if (dx * dx + dz * dz <= (pd.r + h.radius) * (pd.r + h.radius)) hurtHero(S, pd.dmg, null);
      }
      for (const a of S.allies) {
        if (a.dead) continue;
        const dx = a.x - pd.x, dz = a.z - pd.z;
        if (dx * dx + dz * dz <= (pd.r + a.radius) * (pd.r + a.radius)) { a.hp -= pd.dmg; a.hitFlash = 3; if (a.hp <= 0) a.dead = true; }
      }
      ev(S, 'aoe_hit', { x: pd.x, z: pd.z, r: pd.r, hostile: true });
    }
  }
  S.pendings = keep;
}

// ---------------------------------------------------------------------------
// HERO — click-to-move with instant repath (classic-RTS feel: no acceleration, no
// turn delay, the order lands the frame you give it). Auto-attacks the nearest
// creep in range while it has no order of its own.
// ---------------------------------------------------------------------------
function orderMove(S, x, z) {
  if (S.hero.dead || S.hero.stun > 0) return false;
  const hb = heroBounds(S);
  S.hero.tx = clamp(x, hb.x0, hb.x1);
  S.hero.tz = clamp(z, hb.z0, hb.z1);
  S.hero.hasOrder = true;
  return true;
}

function heroStep(S) {
  const h = S.hero;
  if (h.atkCd > 0) h.atkCd--;
  if (h.stun > 0) return;        // BASH CRABS: stunned means STOPPED

  if (h.hasOrder) {
    const dx = h.tx - h.x, dz = h.tz - h.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= TUNE.heroArrive) { h.hasOrder = false; }
    else {
      const step = Math.min(d, h.ms * TICK_S);
      h.x += (dx / d) * step;
      h.z += (dz / d) * step;
      h.facing = Math.atan2(dx, dz);
    }
  }

  // Auto-attack: nearest first. Ties break on ID, never on array index — an
  // array index is a rendering detail and will desync a shared sim (FAVOR law).
  const target = nearestCreepTo(S, h.x, h.z, h.hasOrder ? h.range : TUNE.heroAcquire, null);
  if (!target) return;

  const dx = target.x - h.x, dz = target.z - h.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const reach = h.range + target.radius;

  if (d > reach) {
    if (h.hasOrder) return;                // a player order outranks acquisition
    const step = Math.min(d - reach * 0.9, h.ms * TICK_S);
    if (step > 0) { h.x += (dx / d) * step; h.z += (dz / d) * step; }
    h.facing = Math.atan2(dx, dz);
    return;
  }

  h.facing = Math.atan2(dx, dz);
  if (h.atkCd > 0) return;
  h.atkCd = h.atkTicks;
  h.atkAnim = 5;
  heroBasicHit(S, target);
}

// One landed swing: dodge check, suplex, crit, lifesteal — the whole basic kit.
function heroBasicHit(S, c) {
  const h = S.hero;
  // swinging blows SQUID INK's cover — landed or whiffed, missile or melee
  if (h.hideTicks > 0) { h.hideTicks = 0; ev(S, 'unhide'); }
  // EVASIVE MONKEYS dodge SWINGS; spells never miss (the counterplay IS the shop)
  if (S.tideMod === 'evasive' && !c.big && S.rng() < 0.25) {
    ev(S, 'dodge', { x: c.x, z: c.z });
    return;
  }
  let dmg = h.dmg;
  h.swingN++;
  let crit = false;
  if (S.bodyId === 'wrestler' && h.swingN % 6 === 0) { dmg *= 2; crit = true; }   // SUPLEX TIMING
  if (h.crit > 0 && S.rng() < h.crit / 100) { dmg *= 2; crit = true; }
  dmg = Math.round(dmg);
  // A ranged basic (the wand, range >= 5) lobs a REAL missile now (rev 2 WS1):
  // the swing's damage rides it and lands on CONNECT, a few ticks out. Every
  // roll happens here at trigger, in the same order as the melee path — dodge
  // then crit — so the RNG stream keeps its exact shape. Lifesteal rides the
  // connect too (stepProjectiles), same magnitude, just later.
  if (h.range >= 5) {
    S.projs.push({
      id: S.nextId++,
      kind: 'basic',
      x: h.x, z: h.z, px: h.x, pz: h.z,
      tgt: c.id,
      speed: TUNE.basicMissile.speed,
      traveled: 0,
      maxDist: Math.max(0.1, Math.hypot(c.x - h.x, c.z - h.z)),
      dmg, crit, dead: false,
    });
    ev(S, 'shot', { id: c.id, x0: h.x, z0: h.z });
    return;
  }
  damageCreep(S, c, dmg, { spell: false, crit });
  if (h.lifesteal > 0 && !h.dead) {
    S.hero.hp = Math.min(h.maxHp, h.hp + dmg * (h.lifesteal / 100));
  }
  // --- WS3 on-hit riders, melee connects only. NEW rng draws sit STRICTLY
  // AFTER the existing dodge→crit draws and each one gates on owning the row
  // (the RNG law: a classic build's stream keeps its exact shape). ---
  if (h.pinchPct > 0 && S.rng() < h.pinchPct / 100) {          // PINCH POINT
    damageCreep(S, c, h.pinchDmg, { kind: 'melee' });
    c_stun(c, h.pinchSec);
    ev(S, 'proj_hit', { x: c.x, z: c.z, r: 0.55, stun: true });
  }
  if (h.procPct > 0 && S.rng() < h.procPct / 100) {            // SHOREBREAK
    areaDamage(S, c.x, c.z, h.procR, h.procDmg, { kind: 'spell' });
    ev(S, 'aoe_hit', { x: c.x, z: c.z, r: h.procR, cat: 'CURRENT' });
  }
  if (h.cleavePct > 0) {                                       // WIDE WAKE (no roll)
    const splash = Math.max(1, Math.round(dmg * h.cleavePct / 100));
    for (const o of S.creeps) {
      if (o === c || o.dead || o.receding) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      const rr = h.cleaveR + o.radius;
      if (dx * dx + dz * dz <= rr * rr) damageCreep(S, o, splash, { kind: 'spell' });
    }
  }
  if (h.poisonPerSec > 0) applyPoison(S, c, h);                // JELLY STING (no roll)
}

function damageCreep(S, c, amount, opts) {
  // CRACKED SHELL: a vulnerable creep takes amplified damage from EVERYTHING
  // — swings, spells, venom, the golem. The float shows the honest number.
  if (c.vulnTicks > 0) amount = Math.round(amount * (1 + c.vulnPct / 100));
  c.hp -= amount;
  c.hitFlash = 3;
  // kind rides every hit so the presentation can pick its spark and its sound:
  // 'melee' (a swing), 'shot' (a basic missile connecting), 'spell', 'dot'.
  ev(S, 'hit', { id: c.id, x: c.x, z: c.z, amount, fatal: c.hp <= 0, crit: !!(opts && opts.crit),
    kind: (opts && opts.kind) || (opts && opts.spell ? 'spell' : 'melee') });
  if (c.hp <= 0) { c.hp = 0; c.dead = true; }   // LAW 3: marked only. Swept at tick end.
}

// WS3 stun application — ALWAYS half duration on a boss, the one rule every
// stun tooltip states. Longer stuns win; they never stack.
function c_stun(c, sec) {
  c.stunTicks = Math.max(c.stunTicks, secs(sec * (c.big ? 0.5 : 1)));
}

// WS3 JELLY STING — reapplying refreshes the clock and keeps the strongest
// rate; the fractional carry (dotAcc) survives the refresh so fast attackers
// never starve the chunks.
function applyPoison(S, c, h) {
  c.dotTicks = secs(h.poisonSec);
  c.dotPerSec = Math.max(c.dotPerSec, h.poisonPerSec);
  if (h.poisonSlowPct > 0) {
    const pm = 1 - h.poisonSlowPct / 100;
    // never overwrite a STRONGER slow (frost); do start one if none is running
    c.slowMult = c.slowTicks > 0 ? Math.min(c.slowMult, pm) : pm;
    c.slowTicks = Math.max(c.slowTicks, secs(h.poisonSec));
  }
}

// Every point of hero damage flows through here. THE ORDER IS LAW (WS3 §V6):
//   (1) CRABWALK dodge — attacker-sourced swings only; a dodge is a full
//       whiff: no damage, no thorns answer. (2) BARNACLE flat-DR — swings
//       only, floor 1. (3) COWRIE gold-burn. (4) shield soak. (5) hp.
//   (6) thorns answers. (7) SECOND SUNRISE intercepts the death.
// Boss slams and meteors arrive with attacker null and honestly skip 1-2 —
// the tooltips say "swings" because the engine does.
function hurtHero(S, amount, attacker) {
  const h = S.hero;
  if (h.dead) return;
  if (attacker && h.dodgePct > 0 && S.rng() < h.dodgePct / 100) {
    ev(S, 'dodge', { x: h.x, z: h.z });
    return;
  }
  if (attacker && h.flatDR > 0) amount = Math.max(1, amount - h.flatDR);
  if (h.goldShieldTicks > 0 && amount > 0 && S.gold > 0) {
    // COWRIE WARD: 1g soaks `rate` damage. Burned gold rides ledger.spent, so
    // the every-tick ledger law holds by construction — the battery proves it.
    const soak = Math.min(amount, S.gold * h.goldShieldRate);
    const spentGold = Math.ceil(soak / h.goldShieldRate);
    S.gold -= spentGold;
    S.ledger.spent += spentGold;
    amount -= soak;
    ev(S, 'gold_burn', { g: spentGold });
  }
  if (h.shield > 0) {
    const soak = Math.min(h.shield, amount);
    h.shield -= soak;
    amount -= soak;
    if (h.shield <= 0) { h.shield = 0; ev(S, 'shield_down'); }
  }
  if (amount > 0) {
    h.hp -= amount;
    h.hitFlash = 3;
    ev(S, 'hero_hit', { amount, id: attacker ? attacker.id : 0 });
  }
  if (attacker && h.thorns > 0) damageCreep(S, attacker, h.thorns, { spell: true });
  if (h.hp <= 0) {
    // SECOND SUNRISE: an awake R-slot sunrise takes the death instead — flash
    // back, shed the stun, and it sleeps. The washout never fires. (A respec
    // clears S.cds, which refunds AND disarms — correct and sacred.)
    const sr = S.slots.R === 'secondsunrise' && S.spells.secondsunrise && SPELL.secondsunrise;
    if (sr && (S.cds.secondsunrise || 0) === 0) {
      const rank = S.spells.secondsunrise.rank;
      const pct = rv(SPELL.secondsunrise.fx.cheatPct, rank);
      h.hp = Math.max(1, Math.round(h.maxHp * pct / 100));
      h.stun = 0;
      S.cds.secondsunrise = secs(rv(SPELL.secondsunrise.fx.sleepSec, rank));
      ev(S, 'cheat_death', { pct });
    } else {
      h.hp = 0;
      heroDown(S);
    }
  }
}

// ---------------------------------------------------------------------------
// ALLIES — the reef golem. Fights the nearest creep, follows you between packs.
// ---------------------------------------------------------------------------
function allyStep(S, a) {
  if (a.dead) return;
  a.ttl--;
  if (a.ttl <= 0) { a.dead = true; return; }
  if (a.atkCd > 0) a.atkCd--;
  if (a.atkAnim > 0) a.atkAnim--;
  if (a.hitFlash > 0) a.hitFlash--;

  const target = nearestCreepTo(S, a.x, a.z, 14, null);
  if (target) {
    const dx = target.x - a.x, dz = target.z - a.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const reach = a.range + target.radius;
    a.facing = Math.atan2(dx, dz);
    if (d > reach) {
      const step = Math.min(d - reach * 0.9, a.ms * TICK_S);
      if (step > 0) { a.x += (dx / d) * step; a.z += (dz / d) * step; }
    } else if (a.atkCd <= 0) {
      a.atkCd = a.atkTicks;
      a.atkAnim = 5;
      if (S.tideMod === 'evasive' && !target.big && S.rng() < 0.25) ev(S, 'dodge', { x: target.x, z: target.z });
      // TIKI DRUMS carries to the summons — allies stay stat-frozen otherwise
      // (auraDmgPct 0 → round(dmg × 1) is the integer it always was)
      else damageCreep(S, target, Math.round(a.dmg * (1 + S.hero.auraDmgPct / 100)), { spell: false });
    }
  } else {
    // heel: drift back to the hero's side
    const dx = S.hero.x - a.x, dz = S.hero.z - a.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 3) {
      const step = Math.min(d - 2.5, a.ms * TICK_S);
      a.x += (dx / d) * step; a.z += (dz / d) * step;
      a.facing = Math.atan2(dx, dz);
    }
  }
  const bb = allyBounds(S);
  a.x = clamp(a.x, bb.x0, bb.x1);
  a.z = clamp(a.z, bb.z0, bb.z1);
}

// ---------------------------------------------------------------------------
// CREEPS — wash in, march inland at the nearest defender, swing when they reach.
// ---------------------------------------------------------------------------
function creepStep(S, c) {
  if (c.dead) return;
  if (c.atkCd > 0) c.atkCd--;
  if (c.hitFlash > 0) c.hitFlash--;
  if (c.atkAnim > 0) c.atkAnim--;
  if (c.slowTicks > 0) c.slowTicks--;
  if (c.rootTicks > 0) c.rootTicks--;
  if (c.stunTicks > 0) c.stunTicks--;
  if (c.vulnTicks > 0) c.vulnTicks--;
  if (c.weakenTicks > 0) c.weakenTicks--;
  if (c.missTicks > 0) c.missTicks--;

  // WS3 venom: fractional damage accrues every tick, lands in 0.5s chunks so
  // the floats stay chunky, not rain. The carry survives chunk boundaries and
  // reapplication — the total is tick-exact. A DoT kill pays like any kill.
  if (c.dotTicks > 0) {
    c.dotTicks--;
    c.dotAcc += c.dotPerSec * TICK_S;
    if (c.dotTicks % 10 === 0 || c.dotTicks === 0) {
      const chunk = Math.floor(c.dotAcc);
      if (chunk > 0) {
        c.dotAcc -= chunk;
        damageCreep(S, c, chunk, { kind: 'dot' });
      }
      if (c.dotTicks === 0) { c.dotPerSec = 0; c.dotAcc = 0; }
    }
    if (c.dead) return;
  }

  if (c.receding) {                     // the sea takes them back
    c.z -= (c.ms * 1.7) * TICK_S;
    return;
  }

  // WS3 stun: stopped OUTRIGHT — feet, claws, and a boss's slam windup all
  // hold until it wears off (unlike root, which only ever held feet)
  if (c.stunTicks > 0) return;

  // the boss winds up a slam wherever its target stands (§6 readable telegraphs)
  if (c.big && c.slamCdMax) bossAbility(S, c);

  // nearest defender: the hero, or a golem standing closer. Ties break on id;
  // the hero is id 0 and wins them all. A hero under SQUID INK is unseeable —
  // the tide falls back to its no-defender march while the cover holds.
  const h = S.hero;
  let tgt = null, tgtD = Infinity, tgtHero = false;
  if (!h.dead && !(h.hideTicks > 0)) {
    const dx = h.x - c.x, dz = h.z - c.z;
    tgt = h; tgtD = dx * dx + dz * dz; tgtHero = true;
  }
  for (const a of S.allies) {
    if (a.dead) continue;
    const dx = a.x - c.x, dz = a.z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < tgtD) { tgt = a; tgtD = d2; tgtHero = false; }
  }

  const targetX = tgt ? tgt.x : 0;
  const targetZ = tgt ? tgt.z : COVE.heroStart.z;
  const tgtRadius = tgt ? tgt.radius : 0.6;

  let dx = targetX - c.x, dz = targetZ - c.z;
  let d = Math.sqrt(dx * dx + dz * dz) || 1;
  const reach = c.range + tgtRadius;

  if (tgt && d <= reach) {
    if (c.atkCd <= 0) {
      c.atkCd = c.atkTicks;
      c.atkAnim = 5;
      // WS3 GULL SWARM: a blinded creep whiffs — the roll exists ONLY while
      // the debuff runs (classic runs never draw it). WS3 FOGHORN: a weakened
      // creep swings soft. Both apply to swings at the hero AND at summons.
      if (c.missTicks > 0 && S.rng() < c.missPct / 100) {
        ev(S, 'dodge', { x: tgt.x, z: tgt.z });
      } else {
        const cdmg = c.weakenTicks > 0 ? Math.max(1, Math.round(c.dmg * (1 - c.weakenPct / 100))) : c.dmg;
        if (tgtHero) {
          hurtHero(S, cdmg, c);
          // BASH CRABS: hits can stun (modifier, §6)
          if (S.tideMod === 'bash' && !c.big && !S.hero.dead && S.rng() < 0.2) {
            S.hero.stun = secs(0.8);
            ev(S, 'stun', { sec: 0.8 });
          }
        } else {
          tgt.hp -= cdmg;
          tgt.hitFlash = 3;
          if (tgt.hp <= 0) tgt.dead = true;
        }
      }
      if (S.hero.dead) return;
    }
  } else if (c.rootTicks <= 0) {        // ROOT VINE holds feet, not claws
    const slow = c.slowTicks > 0 ? c.slowMult : 1;
    const step = c.ms * slow * TICK_S;
    c.x += (dx / d) * step;
    c.z += (dz / d) * step;
  }

  c.x = clamp(c.x, -COVE.halfWidth + 0.6, COVE.halfWidth - 0.6);
  c.z = clamp(c.z, COVE.waterline - 4, COVE.inland - 0.6);
}

function bossAbility(S, c) {
  if (c.slamCd > 0) { c.slamCd--; }
  else {
    const h = S.hero;
    // a hidden hero can't be AIMED at — slams already falling still land (honest)
    if (!h.dead && !(h.hideTicks > 0)) {
      const dx = h.x - c.x, dz = h.z - c.z;
      if (dx * dx + dz * dz <= 5.5 * 5.5) {
        c.slamCd = c.slamCdMax;
        const warn = secs(0.9);
        S.pendings.push({
          due: S.tick + warn, x: h.x, z: h.z, r: c.slamR,
          dmg: Math.round(c.dmg * c.slamMult), side: 'hostile',
        });
        ev(S, 'aoe_warn', { x: h.x, z: h.z, r: c.slamR, ticks: warn, hostile: true });
      }
    }
  }
  // THE UNDERTOW calls a surge of jellies at half health, once
  if (c.surgeAt > 0 && !c.surged && c.hp <= c.maxHp * c.surgeAt) {
    c.surged = true;
    for (let i = 0; i < c.surgeCount; i++) {
      makeCreep(S, {
        skin: 'jelly',
        x: clamp(c.x + randRange(S.rng, -2.5, 2.5), -COVE.halfWidth + 1, COVE.halfWidth - 1),
        z: clamp(c.z + randRange(S.rng, -1.5, 1.5), COVE.waterline - 3, COVE.inland - 1),
        hp: Math.max(1, Math.round(creepHp(S.tide) * 0.45)),
        dmg: Math.max(1, Math.round(creepDmg(S.tide) * 0.7)),
        ms: TUNE.creep.ms * 1.3, radius: 0.5,
        mini: true, bountyMult: 0.5, xpMult: 0.5,
        bob: randInt(S.rng, 0, 999),
      });
    }
    ev(S, 'surge', { count: c.surgeCount, x: c.x, z: c.z });   // WS4: the burst has a spot
  }
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
// hero shoves through a crowd instead of being carried by it. Summons join the
// pass as pushable bodies — a golem is a wall exactly as wide as its radius.
// O(n^2) at n<=45 is ~1000 pair checks a tick. Free.
// ---------------------------------------------------------------------------
function resolveBodies(S) {
  const bodies = [];
  for (const c of S.creeps) { if (!c.dead && !c.receding) bodies.push(c); }
  for (const a of S.allies) { if (!a.dead) bodies.push(a); }

  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const minD = a.radius + b.radius;
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
    for (const c of bodies) {
      const minH = c.radius + h.radius;
      let dx = c.x - h.x, dz = c.z - h.z;
      let d2 = dx * dx + dz * dz;
      if (d2 >= minH * minH) continue;
      if (d2 < 1e-6) { const ang = ((c.id * 2654435761) % 628) / 100; dx = Math.cos(ang); dz = Math.sin(ang); d2 = 1; }
      const d = Math.sqrt(d2);
      c.x = h.x + (dx / d) * minH;
      c.z = h.z + (dz / d) * minH;
    }
  }

  // creeps live in the square frame, always; allies stand wherever the hero is
  for (const c of S.creeps) {
    if (c.dead || c.receding) continue;
    c.x = clamp(c.x, -SQUARE.halfWidth + 0.6, SQUARE.halfWidth - 0.6);
    c.z = clamp(c.z, SQUARE.waterline - 4, SQUARE.inland - 0.6);
  }
  const bb = allyBounds(S);
  for (const a of S.allies) {
    if (a.dead) continue;
    a.x = clamp(a.x, bb.x0, bb.x1);
    a.z = clamp(a.z, bb.z0, bb.z1);
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
