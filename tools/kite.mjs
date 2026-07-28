// Does MOVING beat standing? If click-move is the game, a kiting hero must get
// meaningfully deeper than a statue. Same sim, two policies, same seeds.
import { createSim, PHASE, TUNE, COVE } from '../js/sim.js';
import { makeSeed } from '../js/rng.js';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function run(policy) {
  const depths = [];
  for (const sd of SEEDS) {
    const sim = createSim(makeSeed(sd));
    sim.pickBody('wrestler');   // the run starts at the Forge now
    let best = 0;
    for (let i = 0; i < 20 * 60 * 25; i++) {
      if (sim.S.phase === PHASE.BREAK) sim.skipTide();
      if (policy && i % 5 === 0) policy(sim);
      sim.tick();
      if (sim.S.tide > best) best = sim.S.tide;
      if (sim.S.deaths >= 1) break;      // first death ends the measurement
    }
    depths.push(best);
  }
  return depths;
}

// A dumb-but-honest kite: back away from the pack's centre of mass when three
// or more are in swing range, otherwise stand and fight.
const kite = sim => {
  const S = sim.S, h = S.hero;
  if (h.dead) return;
  let n = 0, cx = 0, cz = 0;
  for (const c of S.creeps) {
    if (c.dead || c.receding) continue;
    const dx = c.x - h.x, dz = c.z - h.z;
    if (dx * dx + dz * dz <= 9) { n++; cx += c.x; cz += c.z; }
  }
  if (n < 3) return;
  cx /= n; cz /= n;
  let ax = h.x - cx, az = h.z - cz;
  const d = Math.hypot(ax, az) || 1;
  sim.order(h.x + (ax / d) * 9, h.z + (az / d) * 9);
};

const stand = run(null);
const moved = run(kite);
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log('policy   depths                    avg');
console.log('STAND   ', stand.join(' '), '   ', avg(stand));
console.log('KITE    ', moved.join(' '), '   ', avg(moved));
