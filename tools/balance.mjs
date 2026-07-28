// Headless balance probe — imports the pure sim directly, no browser.
import { createSim, PHASE, TUNE, creepHp, creepDmg, tideQuota } from '../js/sim.js';
import { makeSeed } from '../js/rng.js';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const MAXT = Number(process.argv[2] || 6);

console.log("tide  quota  hp   dmg | clears  avgTicks   avgHP  maxMelee");
for (let tide = 1; tide <= MAXT; tide++) {
  let clears = 0, tickSum = 0, hpSum = 0, maxMelee = 0;
  for (const sd of SEEDS) {
    const sim = createSim(makeSeed(sd));
    // jump straight to the tide under test
    while (sim.S.tide < tide - 1) { if (sim.S.phase === PHASE.BREAK) sim.skipTide(); sim.tick(); if (sim.S.tick > 60000) break; }
    sim.S.hero.hp = sim.S.hero.maxHp;
    sim.skipTide();
    const start = sim.S.tick;
    const targetTide = sim.S.tide + 1;
    let died = false;
    for (let i = 0; i < 20 * 240; i++) {
      sim.tick();
      // count how many creeps are actually in swing range of the hero
      let n = 0;
      for (const c of sim.S.creeps) {
        if (c.dead || c.receding) continue;
        const dx = c.x - sim.S.hero.x, dz = c.z - sim.S.hero.z;
        if (Math.sqrt(dx * dx + dz * dz) <= TUNE.creep.range + TUNE.hero.radius) n++;
      }
      if (n > maxMelee) maxMelee = n;
      if (sim.S.phase === PHASE.WASHOUT) { died = true; break; }
      if (sim.S.tide >= targetTide && sim.S.phase === PHASE.BREAK) break;
    }
    if (!died && sim.S.tide >= targetTide) {
      clears++; tickSum += sim.S.tick - start; hpSum += sim.S.hero.hp / sim.S.hero.maxHp;
    }
  }
  const c = clears || 1;
  console.log(
    String(tide).padStart(4),
    String(tideQuota(tide)).padStart(6),
    String(creepHp(tide)).padStart(5),
    String(creepDmg(tide)).padStart(4), '|',
    (clears + '/' + SEEDS.length).padStart(6),
    String(Math.round(tickSum / c)).padStart(9),
    (Math.round((hpSum / c) * 100) + '%').padStart(7),
    String(maxMelee).padStart(9));
}
