// Balance matrix for the P0 target (goal/§6): a fresh player buying sensibly
// dies around tide 6-8 on run one, clears 10 by run three.
//
//   node tools/shopper.mjs
//
// Proxies, measured not guessed:
//   STAND = run-one player: sensible buys, casts, but stands and trades.
//   KITE  = run-three player: same buys, has learned to move.
// STAND should die ~6-8. KITE should clear 10 on most seeds.
//
// WS3 re-baseline: three ARCHETYPE builds over the new pool run the same
// matrix (node-side only; tools/bot.mjs is the byte-identical proof and is
// never touched). Targets: every archetype clears with kite play, none
// clears STANDING, and each affords 4-6 rows by tide 10 on 15 pearls.

import { createSim } from '../js/sim.js';
import { makeSeed } from '../js/rng.js';
import { makeShopper } from './bot.mjs';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const BODIES = ['wrestler', 'diver', 'magician'];
const MAXT = 20 * 60 * 40;

// The archetype brain: the classic shopper's play loop with a parameterised
// buy/equip plan. Kept HERE so bot.mjs stays byte-identical.
function makeArchetype(sim, plan, opts) {
  opts = opts || {};
  const kite = opts.kite !== false;
  const S = sim.S;
  let tick = 0;

  function shopBreak() {
    for (const id of plan.buys) if (!S.spells[id]) sim.buySpell(id);
    for (const [id, slot] of plan.slots) {
      if (S.spells[id] && S.slots[slot] !== id) sim.equip(id, slot);
    }
    for (const id of plan.ranks) {
      while (S.spells[id] && S.skillPts > 0 && sim.rankUp(id).ok) {}
    }
    for (const id of ['flippers', 'reefblade', 'shellplate', 'pearlpendant']) {
      if (!S.items.some(i => i.id === id)) { sim.buyItem(id); break; }
    }
    if (S.tide >= 4 && !S.items.some(i => i.id === 'guava')) sim.buyItem('guava');
    let guard = 0;
    while (S.gold > 300 && guard++ < 40) {
      if (!sim.buyFruit(['coconut', 'mango', 'starfruit'][(S.tide + guard) % 3], false).ok) break;
    }
    sim.skipTide();
  }

  function fight() {
    const h = S.hero;
    if (h.dead) return;
    if (h.hp < h.maxHp * 0.3) {
      const gi = S.items.findIndex(i => i.id === 'guava');
      if (gi >= 0) sim.useItem(gi);
    }
    if (kite) {
      let n = 0, cx = 0, cz = 0;
      for (const c of S.creeps) {
        if (c.dead || c.receding) continue;
        const dx = c.x - h.x, dz = c.z - h.z;
        if (dx * dx + dz * dz <= 16) { n++; cx += c.x; cz += c.z; }
      }
      if (n >= 3) {
        cx /= n; cz /= n;
        let ax = h.x - cx, az = h.z - cz;
        const d = Math.hypot(ax, az) || 1;
        sim.order(h.x + (ax / d) * 9, h.z + (az / d) * 9);
      }
    }
    let t = null, td = Infinity;
    for (const c of S.creeps) {
      if (c.dead || c.receding) continue;
      const dx = c.x - h.x, dz = c.z - h.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < td) { td = d2; t = c; }
    }
    if (!t) return;
    for (const k of ['R', 'Q', 'W', 'E']) {
      const id = S.slots[k];
      if (!id) continue;
      if ((S.cds[id] || 0) > 0) continue;
      if (k === 'R' && S.creeps.length < 6) continue;
      if (sim.cast(k, t.x, t.z).ok) break;
    }
  }

  return {
    step() {
      tick++;
      if (S.phase === 'BREAK') { shopBreak(); return; }
      if (S.phase === 'TIDE' && tick % 5 === 0) fight();
    },
  };
}

// The three WS3 archetypes (plan 0075 §7): buys in pearl order, an explicit
// slot map (three QWE slots force a bench — that IS the design), ranks on
// what is actually slotted.
const ARCHETYPES = [
  { name: 'STUN-CONTROL', body: 'wrestler',
    plan: { buys: ['conchcrack', 'sandspout', 'barnaclehide', 'pinchpoint', 'krakengrip'],
      slots: [['conchcrack', 'Q'], ['sandspout', 'W'], ['pinchpoint', 'E']],
      ranks: ['conchcrack', 'sandspout', 'pinchpoint', 'krakengrip'] } },
  { name: 'DRAIN-SUSTAIN', body: 'magician',
    plan: { buys: ['sirenskiss', 'crackedshell', 'aloesalve', 'tradewinds', 'drownedtide'],
      slots: [['sirenskiss', 'Q'], ['crackedshell', 'W'], ['tradewinds', 'E']],
      ranks: ['sirenskiss', 'crackedshell', 'tradewinds', 'drownedtide'] } },
  { name: 'ON-HIT', body: 'diver',
    plan: { buys: ['jellysting', 'widewake', 'crabwalk', 'shorebreak', 'secondsunrise'],
      slots: [['jellysting', 'Q'], ['widewake', 'W'], ['shorebreak', 'E']],
      ranks: ['jellysting', 'widewake', 'shorebreak', 'secondsunrise'] } },
];

function runArchetype(arch, seed, kite) {
  const sim = createSim(makeSeed(seed));
  sim.pickBody(arch.body);
  const bot = makeArchetype(sim, arch.plan, { kite });
  let t = 0;
  while (sim.S.phase !== 'VICTORY' && t < MAXT) {
    bot.step();
    sim.tick(); t++;
    if (!kite && sim.S.deaths >= 1) break;
  }
  return { cleared: sim.S.cleared, victory: sim.S.phase === 'VICTORY',
    owned: Object.keys(sim.S.spells).length };
}

function run(body, seed, kite, stopAtFirstDeath) {
  const sim = createSim(makeSeed(seed));
  sim.pickBody(body);
  sim.buySpell('fireball');
  const bot = makeShopper(sim, { kite });
  let t = 0;
  while (sim.S.phase !== 'VICTORY' && t < MAXT) {
    bot.step();
    sim.tick(); t++;
    if (stopAtFirstDeath && sim.S.deaths >= 1) break;
  }
  return { cleared: sim.S.cleared, deaths: sim.S.deaths, victory: sim.S.phase === 'VICTORY', level: sim.S.level };
}

for (const body of BODIES) {
  for (const kite of [false, true]) {
    const rows = SEEDS.map(sd => run(body, sd, kite, !kite));
    const label = (kite ? 'KITE ' : 'STAND') + ' ' + body.padEnd(9);
    const per = rows.map(r => (r.victory ? 'V' : String(r.cleared))).join(' ');
    const avg = (rows.reduce((s, r) => s + r.cleared, 0) / rows.length).toFixed(1);
    const wins = rows.filter(r => r.victory).length;
    console.log(label, per.padEnd(24), 'avg', avg, kite ? ('wins ' + wins + '/8') : '(death tide = cleared+1)');
  }
}

console.log('\nWS3 ARCHETYPES (new-pool re-baseline: kite clears, standing dies t5-9, 4-6 rows by t10)');
for (const arch of ARCHETYPES) {
  for (const kite of [false, true]) {
    const rows = SEEDS.map(sd => runArchetype(arch, sd, kite));
    const label = (kite ? 'KITE ' : 'STAND') + ' ' + (arch.name + ' ' + arch.body).padEnd(22);
    const per = rows.map(r => (r.victory ? 'V' : String(r.cleared))).join(' ');
    const avg = (rows.reduce((s, r) => s + r.cleared, 0) / rows.length).toFixed(1);
    const wins = rows.filter(r => r.victory).length;
    const owned = (rows.reduce((s, r) => s + r.owned, 0) / rows.length).toFixed(1);
    console.log(label, per.padEnd(24), 'avg', avg, 'rows', owned, kite ? ('wins ' + wins + '/8') : '(death tide = cleared+1)');
  }
}
