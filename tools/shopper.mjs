// Balance matrix for the P0 target (goal/§6): a fresh player buying sensibly
// dies around tide 6-8 on run one, clears 10 by run three.
//
//   node tools/shopper.mjs
//
// Proxies, measured not guessed:
//   STAND = run-one player: sensible buys, casts, but stands and trades.
//   KITE  = run-three player: same buys, has learned to move.
// STAND should die ~6-8. KITE should clear 10 on most seeds.

import { createSim } from '../js/sim.js';
import { makeSeed } from '../js/rng.js';
import { makeShopper } from './bot.mjs';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const BODIES = ['wrestler', 'diver', 'magician'];
const MAXT = 20 * 60 * 40;

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
