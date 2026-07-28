// LAST RESORT — the shopper bot. One brain, two homes: the node balance tools
// import it, and the CDP battery injects this same source into the page (the
// export keyword is stripped; nothing else here may depend on module scope).
//
// It plays the way the balance target is phrased (P0 goal): "a fresh player
// buying sensibly". Sensible buys, smart-casts at the nearest pack, and —
// optionally — kiting. kite:false is the run-one player who stands and trades;
// kite:true is the run-three player who has learned that feet are a stat.

export function makeShopper(sim, opts) {
  opts = opts || {};
  const kite = opts.kite !== false;
  const S = sim.S;
  let tick = 0;

  const BUY_ORDER = ['fireball', 'spinslash', 'bulwark', 'frostsnap', 'chainspark', 'meteortide'];
  const RANK_ORDER = ['fireball', 'spinslash', 'bulwark', 'frostsnap', 'chainspark'];
  const ITEM_ORDER = ['flippers', 'reefblade', 'shellplate', 'pearlpendant'];
  const FRUIT_ROT = ['coconut', 'mango', 'starfruit'];

  function shopBreak() {
    for (const id of BUY_ORDER) if (!S.spells[id]) sim.buySpell(id);
    for (const id of RANK_ORDER) {
      while (S.spells[id] && S.skillPts > 0 && sim.rankUp(id).ok) {}
    }
    if (S.spells.meteortide) while (S.skillPts > 0 && sim.rankUp('meteortide').ok) {}
    for (const id of ITEM_ORDER) {
      if (!S.items.some(i => i.id === id)) { sim.buyItem(id); break; }
    }
    // keep one healing juice in the bag for the hard tides
    if (S.tide >= 4 && !S.items.some(i => i.id === 'guava')) sim.buyItem('guava');
    let guard = 0;
    while (S.gold > 300 && guard++ < 40) {
      if (!sim.buyFruit(FRUIT_ROT[(S.tide + guard) % 3], false).ok) break;
    }
    sim.skipTide();
  }

  function fight() {
    const h = S.hero;
    if (h.dead) return;

    // panic juice below 30%
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

    // smart-cast one ready slot at the nearest live creep
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
      // hold the big for real packs
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
