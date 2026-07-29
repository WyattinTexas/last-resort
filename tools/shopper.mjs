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

import { createSim, tideNow } from '../js/sim.js';
import { makeSeed } from '../js/rng.js';
import { ITEM } from '../js/data.js';
import { makeShopper } from './bot.mjs';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const BODIES = ['wrestler', 'diver', 'magician',
  'slinger', 'oldsalt', 'tourist', 'bandleader', 'purser'];   // WS6: the full roster
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

// ---------------------------------------------------------------------------
// WS5 — THE GOLD ECONOMY, PRINTED (plan 0077 §3 graduates into the tool).
// "earned" = 100 start + bounty + clears, cumulative at each clear; the break
// after tide N is the shopping window where tideNow = N+1. Classic kite bot,
// so the table is the same measurement the trader prices were set against.
// ---------------------------------------------------------------------------
console.log('\nGOLD ECONOMY — earned by the break after each tide (kite bot avg over 8 seeds)');
{
  const table = {};
  const unspent = [];
  for (const sd of SEEDS) {
    const sim = createSim(makeSeed(sd));
    sim.pickBody('wrestler');
    sim.buySpell('fireball');
    const bot = makeShopper(sim, { kite: true });
    const S = sim.S;
    let last = 0, t = 0;
    while (S.phase !== 'VICTORY' && t < MAXT) {
      bot.step(); sim.tick(); t++;
      if (S.cleared !== last) {
        last = S.cleared;
        (table[last] = table[last] || []).push(100 + S.ledger.bounty + S.ledger.clears);
      }
    }
    unspent.push(S.gold);
  }
  const hdr = [], row = [];
  for (let td = 1; td <= 10; td++) {
    const a = table[td] || [];
    hdr.push(String(td).padStart(6));
    row.push(String(Math.round(a.reduce((s, x) => s + x, 0) / (a.length || 1))).padStart(6));
  }
  console.log('after tide ' + hdr.join(''));
  console.log('earned ~   ' + row.join(''));
  console.log('unspent at victory (classic bot) ~ '
    + Math.round(unspent.reduce((s, x) => s + x, 0) / unspent.length) + 'g');
}

// ---------------------------------------------------------------------------
// WS5 TRADER ARCHETYPES — do the new items EARN their price on the measured
// curve? The brain is the classic shopper's loop plus: fruit stops cold at
// tide 5 (the deliberate save), the trader list buys in order as gold allows
// (the tide each piece lands is the affordability proof), and actives are
// USED in the fight — a keg in the bag is dead stock. tools/bot.mjs is
// untouched; it stays the byte-identical proof.
// ---------------------------------------------------------------------------
function makeTraderBot(sim, cfg, opts) {
  opts = opts || {};
  const kite = opts.kite !== false;
  const S = sim.S;
  let tick = 0;
  const landed = {};   // trader id -> the break (after tide N) it was bought on
  const used = {};     // trader id -> successful uses

  function shopBreak() {
    for (const id of cfg.buys) if (!S.spells[id]) sim.buySpell(id);
    for (const [id, slot] of cfg.slots) {
      if (S.spells[id] && S.slots[slot] !== id) sim.equip(id, slot);
    }
    for (const id of cfg.ranks) {
      while (S.spells[id] && S.skillPts > 0 && sim.rankUp(id).ok) {}
    }
    for (const id of cfg.wearables) {
      if (!S.items.some(i => i.id === id)) { sim.buyItem(id); break; }
    }
    // KEEPER PHILOSOPHY (measured, not guessed): once the bottle has landed,
    // juice restocking stops FOR GOOD — the bottle is the one emergency ace,
    // the coconuts are the plan. Measured 6/8 V vs 2/8 with guava rebuys
    // (~100g/tide of juice is a slow bleed that permanent fruit beats) and
    // the freed sixth slot is what the conch moves into.
    if (S.tide >= 4 && !S.items.some(i => i.id === 'guava')
      && !(cfg.bottleReplacesGuava && landed.bottle !== undefined)) sim.buyItem('guava');
    // the trader list, in order — one save target at a time. A row may carry
    // `from` (no rational sailor saves for a tide-10 tool on tide 5's break)
    // or `restock` (consumables re-buy when the bag runs dry).
    let saveFor = 0;
    for (const row of cfg.trader) {
      const inBag = S.items.some(i => i.id === row.id);
      if (landed[row.id] !== undefined && (!row.restock || inBag)) continue;
      if (row.from && S.tide < row.from) break;
      if (inBag) continue;
      if (sim.buyItem(row.id).ok) {
        if (landed[row.id] === undefined) landed[row.id] = S.tide;
        continue;
      }
      saveFor = ITEM[row.id].price;   // the purse guards this much for the target
      break;
    }
    // two saving styles: TRADER-SAVER skips fruit cold from tide 5 (the
    // deliberate save); WARD-KEEPER keeps eating but reserves the target's
    // price — fruit only spends the gold ABOVE the save.
    if (!(cfg.fruitStop && S.tide >= cfg.fruitStop)) {
      let guard = 0;
      while (S.gold > 300 + saveFor && guard++ < 40) {
        if (!sim.buyFruit(['coconut', 'mango', 'starfruit'][(S.tide + guard) % 3], false).ok) break;
      }
    }
    sim.skipTide();
  }

  function useActives() {
    const h = S.hero;
    // the bottle is the panic button now (cleanse + 55% of max); guava backs it up
    if (h.hp < h.maxHp * 0.35) {
      const bi = S.items.findIndex(i => i.id === 'bottle');
      if (bi >= 0 && sim.useItem(bi).ok) { used.bottle = (used.bottle || 0) + 1; return; }
      const gi = S.items.findIndex(i => i.id === 'guava');
      if (gi >= 0) sim.useItem(gi);
    }
    let near = 0, bigNear = false;
    for (const c of S.creeps) {
      if (c.dead || c.receding) continue;
      const dx = c.x - h.x, dz = c.z - h.z;
      if (dx * dx + dz * dz <= 3.2 * 3.2) { near++; if (c.big) bigNear = true; }
    }
    const spot = S.items.findIndex(i => i.id === 'blackspot');
    if (spot >= 0 && (bigNear || near >= 5) && sim.useItem(spot).ok) used.blackspot = (used.blackspot || 0) + 1;
    const keg = S.items.findIndex(i => i.id === 'powderkeg');
    if (keg >= 0 && near >= 4 && sim.useItem(keg).ok) used.powderkeg = (used.powderkeg || 0) + 1;
    if (h.slamWardTicks <= 0) {
      const conch = S.items.findIndex(i => i.id === 'ghostconch');
      if (conch >= 0) {
        for (const c of S.creeps) {
          if (c.dead || c.receding || !c.big) continue;
          const dx = c.x - h.x, dz = c.z - h.z;
          if (dx * dx + dz * dz <= 6 * 6) {
            if (sim.useItem(conch).ok) used.ghostconch = (used.ghostconch || 0) + 1;
            break;
          }
        }
      }
    }
  }

  function fight() {
    const h = S.hero;
    if (h.dead) return;
    useActives();
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
    landed, used,
    step() {
      tick++;
      if (S.phase === 'BREAK') { shopBreak(); return; }
      if (S.phase === 'TIDE' && tick % 5 === 0) fight();
    },
  };
}

const TRADER_ARCHETYPES = [
  { name: 'TRADER-SAVER', body: 'wrestler',
    cfg: { buys: ['fireball', 'spinslash', 'bulwark', 'frostsnap', 'chainspark', 'meteortide'],
      slots: [],
      ranks: ['fireball', 'spinslash', 'bulwark', 'frostsnap', 'chainspark', 'meteortide'],
      wearables: ['flippers', 'reefblade'],
      trader: [{ id: 'cutlass' }, { id: 'powderkeg' }], fruitStop: 5 } },
  { name: 'WARD-KEEPER', body: 'magician',
    cfg: { buys: ['sirenskiss', 'crackedshell', 'aloesalve', 'tradewinds', 'drownedtide'],
      slots: [['sirenskiss', 'Q'], ['crackedshell', 'W'], ['tradewinds', 'E']],
      ranks: ['sirenskiss', 'crackedshell', 'tradewinds', 'drownedtide'],
      wearables: ['flippers', 'reefblade', 'shellplate', 'pearlpendant'],
      trader: [{ id: 'bottle' }, { id: 'ghostconch', from: 8 }],
      bottleReplacesGuava: true } },
];

function runTrader(arch, seed, kite) {
  const sim = createSim(makeSeed(seed));
  sim.pickBody(arch.body);
  const bot = makeTraderBot(sim, arch.cfg, { kite });
  let t = 0;
  while (sim.S.phase !== 'VICTORY' && t < MAXT) {
    bot.step();
    sim.tick(); t++;
    if (!kite && sim.S.deaths >= 1) break;
  }
  return { cleared: sim.S.cleared, victory: sim.S.phase === 'VICTORY',
    landed: bot.landed, used: bot.used };
}

console.log('\nWS5 TRADER ARCHETYPES (kite clears + the buys land on the curve; standing still dies t5-9)');
for (const arch of TRADER_ARCHETYPES) {
  for (const kite of [false, true]) {
    const rows = SEEDS.map(sd => runTrader(arch, sd, kite));
    const label = (kite ? 'KITE ' : 'STAND') + ' ' + (arch.name + ' ' + arch.body).padEnd(22);
    const per = rows.map(r => (r.victory ? 'V' : String(r.cleared))).join(' ');
    const avg = (rows.reduce((s, r) => s + r.cleared, 0) / rows.length).toFixed(1);
    const wins = rows.filter(r => r.victory).length;
    console.log(label, per.padEnd(24), 'avg', avg, kite ? ('wins ' + wins + '/8') : '(death tide = cleared+1)');
    if (kite) {
      for (const { id } of arch.cfg.trader) {
        const buys = rows.filter(r => r.landed[id] !== undefined);
        const brk = buys.map(r => r.landed[id]).sort((a, b) => a - b);
        const uses = rows.reduce((s, r) => s + (r.used[id] || 0), 0);
        console.log('      ' + id.padEnd(11) + ' landed ' + buys.length + '/8'
          + (brk.length ? ' (break after t' + brk[0] + '-t' + brk[brk.length - 1] + ')' : '')
          + (ITEM[id].kind === 'active' ? '  uses ' + uses : ''));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// WS6 PURSER ECONOMY (plan 0078 §7.3) — SERVICE CHARGE measured, never guessed:
// the earned-by-break table re-printed on the purser chassis (expect the flat
// +2 to compound to roughly +2 × kills over the run), then the WS5
// TRADER-SAVER config on the purser — do the same trader buys land earlier
// than the wrestler baseline printed above?
// ---------------------------------------------------------------------------
console.log('\nWS6 PURSER ECONOMY — earned by the break (vs the classic table above)');
{
  const table = {};
  const unspent = [];
  const killsAt = [];
  for (const sd of SEEDS) {
    const sim = createSim(makeSeed(sd));
    sim.pickBody('purser');
    sim.buySpell('fireball');
    const bot = makeShopper(sim, { kite: true });
    const S = sim.S;
    let last = 0, t = 0;
    while (S.phase !== 'VICTORY' && t < MAXT) {
      bot.step(); sim.tick(); t++;
      if (S.cleared !== last) {
        last = S.cleared;
        (table[last] = table[last] || []).push(100 + S.ledger.bounty + S.ledger.clears);
      }
    }
    unspent.push(S.gold);
    killsAt.push(S.kills);
  }
  const hdr = [], row = [];
  for (let td = 1; td <= 10; td++) {
    const a = table[td] || [];
    hdr.push(String(td).padStart(6));
    row.push(String(Math.round(a.reduce((s, x) => s + x, 0) / (a.length || 1))).padStart(6));
  }
  console.log('after tide ' + hdr.join(''));
  console.log('earned ~   ' + row.join(''));
  console.log('unspent at victory ~ '
    + Math.round(unspent.reduce((s, x) => s + x, 0) / unspent.length) + 'g · kills ~ '
    + Math.round(killsAt.reduce((s, x) => s + x, 0) / killsAt.length)
    + ' (the innate is worth ~2 × kills)');
}

console.log('\nWS6 PURSER TRADER-SAVER (the wrestler TRADER-SAVER cfg on the purser chassis)');
{
  const arch = { name: 'PURSER-SAVER', body: 'purser', cfg: TRADER_ARCHETYPES[0].cfg };
  for (const kite of [false, true]) {
    const rows = SEEDS.map(sd => runTrader(arch, sd, kite));
    const label = (kite ? 'KITE ' : 'STAND') + ' ' + (arch.name + ' ' + arch.body).padEnd(22);
    const per = rows.map(r => (r.victory ? 'V' : String(r.cleared))).join(' ');
    const avg = (rows.reduce((s, r) => s + r.cleared, 0) / rows.length).toFixed(1);
    const wins = rows.filter(r => r.victory).length;
    console.log(label, per.padEnd(24), 'avg', avg, kite ? ('wins ' + wins + '/8') : '(death tide = cleared+1)');
    if (kite) {
      for (const { id } of arch.cfg.trader) {
        const buys = rows.filter(r => r.landed[id] !== undefined);
        const brk = buys.map(r => r.landed[id]).sort((a, b) => a - b);
        const uses = rows.reduce((s, r) => s + (r.used[id] || 0), 0);
        console.log('      ' + id.padEnd(11) + ' landed ' + buys.length + '/8'
          + (brk.length ? ' (break after t' + brk[0] + '-t' + brk[brk.length - 1] + ')' : '')
          + (ITEM[id].kind === 'active' ? '  uses ' + uses : ''));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// WS6 SPYGLASS MARKSMAN (plan 0078 §7.3) — the parked WS3 debt, measured on
// its second customer: the classic shopper plan on the slinger, with and
// without SPYGLASS r1 slotted E from tide 5 (displacing BULWARK — a passive
// slot COSTS an active, that's the breadth pressure). LOGGED DEVIATION: the
// classic plan's pearl queue can never SAVE the 5 pearls (the greedy bot eats
// every income — the same breadth pressure WS3 measured), so the spyglass arm
// GRANTS the 5 at the t5 break; the probe measures the LANE, not the purse.
// Expect a visible but not window-breaking delta; if invisible, raise [12,4].
// ---------------------------------------------------------------------------
console.log('\nWS6 SPYGLASS MARKSMAN (slinger, classic plan ± spyglass r1 in E from t5 — 5 pearls granted)');
{
  function runMarksman(seed, withGlass, kite) {
    const sim = createSim(makeSeed(seed));
    sim.pickBody('slinger');
    sim.buySpell('fireball');
    const bot = makeShopper(sim, { kite });
    const S = sim.S;
    let t = 0, granted = false, landed = null;
    while (S.phase !== 'VICTORY' && t < MAXT) {
      if (withGlass && S.phase === 'BREAK' && S.tide >= 4) {   // tideNow = 5: the unlock break
        if (!S.spells.spyglass) {
          if (!granted) { sim.givePearls(5); granted = true; }
          if (sim.buySpell('spyglass').ok) landed = S.tide;
        }
        if (S.spells.spyglass && S.slots.E !== 'spyglass') sim.equip('spyglass', 'E');
      }
      bot.step(); sim.tick(); t++;
      if (!kite && S.deaths >= 1) break;
    }
    return { cleared: S.cleared, victory: S.phase === 'VICTORY', ticks: S.tick, landed };
  }
  const mmss = t => Math.floor(t / 20 / 60) + ':' + String(Math.floor(t / 20) % 60).padStart(2, '0');
  for (const withGlass of [false, true]) {
    for (const kite of [false, true]) {
      const rows = SEEDS.map(sd => runMarksman(sd, withGlass, kite));
      const label = (kite ? 'KITE ' : 'STAND') + ' ' + (withGlass ? 'SPYGLASS-E slinger' : 'CLASSIC-E  slinger').padEnd(22);
      const per = rows.map(r => (r.victory ? 'V' : String(r.cleared))).join(' ');
      const avg = (rows.reduce((s, r) => s + r.cleared, 0) / rows.length).toFixed(1);
      const wins = rows.filter(r => r.victory).length;
      const time = kite
        ? ' avg time ' + mmss(rows.reduce((s, r) => s + r.ticks, 0) / rows.length)
        : '';
      const landedN = rows.filter(r => r.landed !== null).length;
      console.log(label, per.padEnd(24), 'avg', avg,
        (kite ? ('wins ' + wins + '/8' + time) : '(death tide = cleared+1)')
        + (withGlass && kite ? '  landed ' + landedN + '/8 (break after t4)' : ''));
    }
  }
}
