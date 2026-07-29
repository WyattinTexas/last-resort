// SURVIVAL QUEST — THE BOARDWALK. Forge, spell racks, fruit stand, surf shack,
// the castaway sheet and the victory screen. Pure presentation: every purchase
// goes through the sim's build API, the same calls the CDP battery drives.
//
// The racks are WALKABLE (§4: the vendor boardwalk is physical space): stand
// at a stall and its rack opens; walk away and it closes. While a rack is open
// during a shop break the countdown holds — the tide waits while you haggle.

import { TXT, tf } from './i18n.js';
import {
  RULES, rv, BODIES, SPELLS, SPELL, spellPrice, spellRankCap, spellUnlockTide,
  ITEMS, ITEM, FRUITS, MODS, STALLS, STALL_REACH, CAT_COLOR,
} from './data.js';
import { PHASE, ZONE, tideNow } from './sim.js';

let getSim = null;        // () => sim api (rebound on every setSeed)
let announce = null;      // (text, color, secs)
let onPlayAgain = null;

const el = id => document.getElementById(id);
const UI = {};
let openStall = null;     // stall id whose sheet is showing
let suppressStall = null; // ESC'd this stall; stays shut until you walk away
let castawayOpen = false;
let lastKey = '';
let lastItemsKey = '';

export function initShop(opts) {
  getSim = opts.getSim;
  announce = opts.announce;
  onPlayAgain = opts.onPlayAgain;

  for (const id of ['forge', 'forge-cards', 'victory', 'victory-stats', 'victory-build', 'victory-again',
    'sheet', 'sheet-title', 'sheet-sub', 'sheet-rows', 'sheet-gold', 'sheet-pearls', 'sheet-respec',
    'castaway', 'castaway-title', 'castaway-body', 'items', 'hud-pts']) {
    UI[id] = el(id);
  }

  UI['victory-again'].addEventListener('click', () => { hideAll(); onPlayAgain(); });
  UI['sheet-respec'].addEventListener('click', doRespec);
  UI['hud-pts'].addEventListener('click', () => toggleCastaway(true));

  buildForge();
}

// ---------------------------------------------------------------------------
// failure codes -> loud honest words
// ---------------------------------------------------------------------------
function why(code, extra) {
  switch (code) {
    case 'pearls': return TXT('NOT ENOUGH PEARLS');
    case 'gold': return TXT('NOT ENOUGH GOLD');
    case 'locked': return tf(TXT('THAT ONE UNLOCKS AT TIDE %1'), extra);
    case 'owned': return TXT('ALREADY ON YOUR BELT');
    case 'slots': return TXT('SIX SLOTS. THE BAG IS FULL.');
    case 'cap': return TXT('MAXED OUT');
    case 'points': return TXT('NO SKILL POINTS — CLEAR TIDES');
    default: return TXT('THE SHOPKEEPER SHRUGS');
  }
}

// ---------------------------------------------------------------------------
// THE FORGE — pick a body (run start)
// ---------------------------------------------------------------------------
function buildForge() {
  UI['forge-cards'].textContent = '';
  for (const b of BODIES) {
    const card = document.createElement('div');
    card.className = 'bodycard panel';
    const perSec = (1 / b.base.atkS).toFixed(1);
    card.innerHTML =
      '<div class="bico" data-notr>' + b.ico + '</div>' +
      '<div class="bname" data-notr></div>' +
      '<div class="barch" data-notr></div>' +
      '<div class="bflav" data-notr></div>' +
      '<div class="bstats" data-notr>' +
        esc(tf(TXT('%1 HP · %2 DMG · %3 SWINGS/S'), b.base.maxHp, b.base.dmg, perSec)) + '<br>' +
        esc(tf(TXT('SPEED %1 · RANGE %2'), b.base.ms, b.base.range)) +
        (b.base.sp ? '<br>' + esc(tf(TXT('SPELLPOWER %1'), b.base.sp)) : '') +
      '</div>' +
      '<div class="binnate" data-notr><b></b> <span></span></div>';
    card.querySelector('.bname').textContent = TXT(b.name);
    card.querySelector('.barch').textContent = TXT(b.arch);
    card.querySelector('.bflav').textContent = TXT(b.flavor);
    card.querySelector('.binnate b').textContent = TXT(b.innate.name);
    card.querySelector('.binnate span').textContent = TXT(b.innate.desc);
    card.addEventListener('click', () => {
      const r = getSim().pickBody(b.id);
      if (!r.ok) announce(why(r.why), '#FF6B6B', 2);
    });
    UI['forge-cards'].appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// per-frame: overlays follow the phase; stall proximity runs the racks
// ---------------------------------------------------------------------------
export function shopFrame() {
  const sim = getSim();
  const S = sim.S;

  UI.forge.classList.toggle('show', S.phase === PHASE.FORGE);
  const vict = S.phase === PHASE.VICTORY;
  if (vict && !UI.victory.classList.contains('show')) fillVictory(S);
  UI.victory.classList.toggle('show', vict);

  // --- walkable racks (auto open by proximity, ESC to wave the keeper off).
  // Rev 1: the stalls stand in the MARKET, and you are only there on a live
  // shop break — mid-tide shopping died with the boardwalk, dead castaways
  // never see a counter. ---
  let near = null;
  if (S.phase === PHASE.BREAK && !S.hero.dead && S.zone === ZONE.MARKET) {
    let bd = STALL_REACH * STALL_REACH;
    for (const st of STALLS) {
      const dx = S.hero.x - st.x, dz = S.hero.z - st.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; near = st; }
    }
  }
  if (suppressStall && (!near || near.id !== suppressStall)) suppressStall = null;
  const want = near && near.id !== suppressStall ? near.id : null;
  if (want !== openStall) {
    openStall = want;
    lastKey = '';                       // force a rebuild
    UI.sheet.classList.toggle('show', !!openStall);
    sim.setHold(!!openStall);           // the tide waits while you haggle
  }

  // --- refresh open surfaces only when the state they show has moved ---
  const key = [S.gold, S.pearls, S.skillPts, S.level, tideNow(S),
    Object.keys(S.spells).map(id => id + S.spells[id].rank).join(''),
    S.slots.Q, S.slots.W, S.slots.E, S.slots.R,
    S.items.map(i => i.id).join(','), S.fruit.mango, S.fruit.starfruit, S.fruit.coconut].join('|');
  if (key !== lastKey) {
    lastKey = key;
    if (openStall) fillSheet(openStall, S);
    if (castawayOpen) fillCastaway(S);
    fillItems(S);
  }
}

export function anyShopOpen() { return !!openStall || castawayOpen; }

export function closeShops() {
  if (openStall) { suppressStall = openStall; openStall = null; UI.sheet.classList.remove('show'); getSim().setHold(false); }
  if (castawayOpen) toggleCastaway(false);
}

export function toggleCastaway(force) {
  castawayOpen = force !== undefined ? !!force : !castawayOpen;
  UI.castaway.classList.toggle('show', castawayOpen);
  if (castawayOpen) fillCastaway(getSim().S);
}

// ---------------------------------------------------------------------------
// the shop sheet: one container, three kinds of stock
// ---------------------------------------------------------------------------
function fillSheet(stallId, S) {
  const st = STALLS.find(s => s.id === stallId);
  UI['sheet-title'].textContent = st.ico + ' ' + TXT(st.name);
  UI['sheet-sub'].textContent = st.kind === 'rack'
    ? tf(TXT('PEARLS BUY BREADTH · TIDE %1'), tideNow(S))
    : tf(TXT('GOLD %1'), S.gold);
  UI['sheet-gold'].textContent = S.gold;
  UI['sheet-pearls'].textContent = S.pearls;

  const rows = UI['sheet-rows'];
  rows.textContent = '';
  if (st.kind === 'rack') {
    const cat = { strike: 'STRIKE', guard: 'GUARD', current: 'CURRENT', deep: 'DEEP' }[stallId];
    for (const sp of SPELLS.filter(s => s.cat === cat)) rows.appendChild(spellRow(sp, S));
  } else if (st.kind === 'fruit') {
    for (const f of FRUITS) rows.appendChild(fruitRow(f, S));
  } else {
    for (const it of ITEMS) rows.appendChild(itemRow(it, S));
  }

  const owned = Object.keys(S.spells).length;
  UI['sheet-respec'].textContent = tf(TXT('TIDE TABLET · RESPEC · %1 GOLD'), RULES.respecCost);
  UI['sheet-respec'].disabled = !owned || S.gold < RULES.respecCost;
}

function doRespec() {
  const r = getSim().respec();
  if (!r.ok) { announce(why(r.why), '#FF6B6B', 2); return; }
  announce(tf(TXT('THE TIDE TABLET REMEMBERS — %1 PEARLS AND %2 POINTS BACK'), r.pearlsBack, r.pointsBack), '#7AC8FF', 3.5);
}

function spellRow(sp, S) {
  const owned = S.spells[sp.id];
  const unlock = spellUnlockTide(sp);
  const locked = tideNow(S) < unlock;
  const price = spellPrice(sp);
  const cap = spellRankCap(sp);
  const rank = owned ? owned.rank : 1;

  const row = document.createElement('div');
  row.className = 'srow' + (locked && !owned ? ' locked' : '');
  const vals = sp.vals ? sp.vals(rank, S.hero.sp) : [];
  let desc = tf.apply(null, [TXT(sp.desc)].concat(vals));
  if (sp.kind === 'active') desc += '  ·  ' + tf(TXT('%1s COOLDOWN'), sp.cd);

  const meta = document.createElement('div');
  meta.className = 'smeta';
  const nameLine = document.createElement('div');
  nameLine.className = 'sname';
  nameLine.textContent = TXT(sp.name);
  const chip = document.createElement('span');
  chip.className = 'tchip' + (sp.tier === 'big' ? ' big' : '');
  chip.textContent = sp.tier === 'big' ? TXT('BIG · R SLOT') : (sp.tier === 2 ? TXT('TIER 2') : TXT('TIER 1'));
  nameLine.appendChild(chip);
  if (owned) {
    const rc = document.createElement('span');
    rc.className = 'tchip';
    rc.style.color = '#9CFF7A';
    rc.textContent = tf(TXT('RANK %1 / %2'), rank, cap);
    nameLine.appendChild(rc);
  }
  const descEl = document.createElement('div');
  descEl.className = 'sdesc';
  descEl.textContent = desc;
  meta.appendChild(nameLine);
  meta.appendChild(descEl);

  const ico = document.createElement('div');
  ico.className = 'sico';
  ico.textContent = sp.ico;

  row.appendChild(ico);
  row.appendChild(meta);

  if (!owned) {
    const btn = document.createElement('button');
    btn.className = 'sbtn';
    if (locked) {
      btn.disabled = true;
      btn.textContent = tf(TXT('TIDE %1'), unlock);
    } else {
      btn.textContent = tf(TXT('BUY · %1 ◉'), price);
      btn.disabled = S.pearls < price;
      btn.addEventListener('click', () => {
        const r = getSim().buySpell(sp.id);
        if (!r.ok) announce(why(r.why, unlock), '#FF6B6B', 2);
      });
    }
    row.appendChild(btn);
  } else {
    // slot chips: where does it sit?
    const chips = document.createElement('div');
    chips.className = 'slotchips';
    const keys = sp.tier === 'big' ? ['R'] : ['Q', 'W', 'E'];
    for (const k of keys) {
      const c = document.createElement('div');
      c.className = 'slotchip' + (S.slots[k] === sp.id ? ' on' : '');
      c.textContent = k;
      c.addEventListener('click', () => { getSim().equip(sp.id, k); });
      chips.appendChild(c);
    }
    row.appendChild(chips);
    if (S.skillPts > 0 && rank < cap) {
      const up = document.createElement('button');
      up.className = 'sbtn blue';
      up.textContent = tf(TXT('+RANK (%1)'), S.skillPts);
      up.addEventListener('click', () => {
        const r = getSim().rankUp(sp.id);
        if (!r.ok) announce(why(r.why), '#FF6B6B', 2);
      });
      row.appendChild(up);
    }
  }
  return row;
}

function fruitRow(f, S) {
  const rank = S.fruit[f.id];
  const row = document.createElement('div');
  row.className = 'srow';
  row.innerHTML = '<div class="sico" data-notr>' + f.ico + '</div>' +
    '<div class="smeta"><div class="sname" data-notr></div><div class="sdesc" data-notr></div></div>';
  const nm = row.querySelector('.sname');
  nm.textContent = TXT(f.name);
  const sc = document.createElement('span');
  sc.className = 'tchip';
  sc.textContent = TXT(f.stat);
  nm.appendChild(sc);
  const rc = document.createElement('span');
  rc.className = 'tchip';
  rc.style.color = '#9CFF7A';
  rc.textContent = tf(TXT('RANK %1 / %2'), rank, RULES.fruitCap);
  nm.appendChild(rc);
  row.querySelector('.sdesc').textContent = TXT(f.desc);

  const one = document.createElement('button');
  one.className = 'sbtn';
  one.textContent = tf(TXT('+1 · %1g'), RULES.fruitPrice);
  one.disabled = S.gold < RULES.fruitPrice || rank >= RULES.fruitCap;
  one.addEventListener('click', () => {
    const r = getSim().buyFruit(f.id, false);
    if (!r.ok) announce(why(r.why), '#FF6B6B', 2);
  });
  const five = document.createElement('button');
  five.className = 'sbtn';
  five.textContent = tf(TXT('+5 · %1g'), RULES.fruitPackPrice);
  five.disabled = S.gold < RULES.fruitPackPrice || rank + RULES.fruitPackSize > RULES.fruitCap;
  five.addEventListener('click', () => {
    const r = getSim().buyFruit(f.id, true);
    if (!r.ok) announce(why(r.why), '#FF6B6B', 2);
  });
  row.appendChild(one);
  row.appendChild(five);
  return row;
}

function itemRow(it, S) {
  const row = document.createElement('div');
  row.className = 'srow';
  row.innerHTML = '<div class="sico" data-notr>' + it.ico + '</div>' +
    '<div class="smeta"><div class="sname" data-notr></div><div class="sdesc" data-notr></div></div>';
  const nm = row.querySelector('.sname');
  nm.textContent = TXT(it.name);
  if (it.kind === 'potion') {
    const pc = document.createElement('span');
    pc.className = 'tchip';
    pc.style.color = '#7AC8FF';
    pc.textContent = TXT('1 USE');
    nm.appendChild(pc);
  }
  row.querySelector('.sdesc').textContent = TXT(it.desc);
  const btn = document.createElement('button');
  btn.className = 'sbtn';
  btn.textContent = tf(TXT('BUY · %1g'), it.price);
  btn.disabled = S.gold < it.price || S.items.length >= RULES.itemSlots;
  btn.addEventListener('click', () => {
    const r = getSim().buyItem(it.id);
    if (!r.ok) announce(why(r.why), '#FF6B6B', 2);
  });
  row.appendChild(btn);
  return row;
}

// ---------------------------------------------------------------------------
// item chips (bottom right): click a juice to drink it; keys 1-6 do the same
// ---------------------------------------------------------------------------
function fillItems(S) {
  const ikey = S.items.map(i => i.id).join(',');
  if (ikey === lastItemsKey) return;
  lastItemsKey = ikey;
  const box = UI.items;
  box.textContent = '';
  // WS2: occupied chips ONLY — no items, no phantom UI. S.items is dense
  // (buys push, drinks splice), so the loop index IS the honest 1-6 key.
  for (let i = 0; i < S.items.length; i++) {
    const it = ITEM[S.items[i].id];
    const chip = document.createElement('div');
    chip.className = 'itemchip' + (it.kind === 'potion' ? ' potion' : ' worn');
    chip.textContent = it.ico;
    chip.title = TXT(it.name) + ' — ' + TXT(it.desc);
    const key = document.createElement('b');
    key.textContent = String(i + 1);
    chip.appendChild(key);
    if (it.kind === 'potion') chip.addEventListener('click', () => useItemSlot(i));
    box.appendChild(chip);
  }
}

export function useItemSlot(i) {
  const sim = getSim();
  const inst = sim.S.items[i];
  if (!inst) return;
  const it = ITEM[inst.id];
  if (it.kind !== 'potion') { announce(TXT('THAT ONE WORKS BY BEING WORN'), '#8CF0E4', 1.6); return; }
  const r = sim.useItem(i);
  if (r.ok) announce(it.ico + ' ' + TXT(it.name), '#9CFF7A', 1.6);
}

// ---------------------------------------------------------------------------
// THE CASTAWAY sheet (C): who you have built so far
// ---------------------------------------------------------------------------
function fillCastaway(S) {
  const body = BODIES.find(b => b.id === S.bodyId);
  UI['castaway-title'].textContent = body ? body.ico + ' ' + TXT(body.name) : TXT('THE CASTAWAY');
  const box = UI['castaway-body'];
  box.textContent = '';

  if (body) {
    const inn = document.createElement('div');
    inn.className = 'sdesc';
    inn.textContent = TXT(body.innate.name) + ' — ' + TXT(body.innate.desc);
    box.appendChild(inn);
  }

  const sec1 = document.createElement('div');
  sec1.className = 'csec';
  sec1.textContent = tf(TXT('LEVEL %1 · %2 SKILL POINTS'), S.level, S.skillPts);
  box.appendChild(sec1);

  const grid = document.createElement('div');
  grid.className = 'cstats';
  const h = S.hero;
  const stats = [
    [TXT('HP'), Math.round(h.hp) + ' / ' + h.maxHp],
    [TXT('REGEN'), (Math.round(h.regen * 10) / 10) + '/s'],
    [TXT('DAMAGE'), h.dmg],
    [TXT('SWINGS'), (20 / h.atkTicks).toFixed(2) + '/s'],
    [TXT('MOVE'), h.ms.toFixed(1)],
    [TXT('SPELLPOWER'), h.sp],
    [TXT('CRIT'), h.crit + '%'],
    [TXT('LIFESTEAL'), h.lifesteal + '%'],
    [TXT('THORNS'), h.thorns],
    [TXT('SHIELD'), Math.round(h.shield)],
  ];
  for (const [l, v] of stats) {
    const d = document.createElement('div');
    const s1 = document.createElement('span'); s1.textContent = l;
    const s2 = document.createElement('b'); s2.textContent = String(v);
    d.appendChild(s1); d.appendChild(s2);
    grid.appendChild(d);
  }
  box.appendChild(grid);

  const sec2 = document.createElement('div');
  sec2.className = 'csec';
  sec2.textContent = TXT('SPELLS ON THE BELT');
  box.appendChild(sec2);
  const ids = Object.keys(S.spells);
  if (!ids.length) {
    const none = document.createElement('div');
    none.className = 'sdesc';
    none.textContent = TXT('NONE YET — THE RACKS ARE AT THE MARKET');
    box.appendChild(none);
  }
  for (const id of ids) {
    const sp = SPELL[id];
    box.appendChild(spellRow(sp, S));
  }

  const sec3 = document.createElement('div');
  sec3.className = 'csec';
  sec3.textContent = TXT('FRUIT EATEN');
  box.appendChild(sec3);
  const fr = document.createElement('div');
  fr.className = 'sdesc';
  fr.setAttribute('data-notr', '');
  fr.textContent = FRUITS.map(f => f.ico + ' ' + S.fruit[f.id]).join('   ');
  box.appendChild(fr);
}

// ---------------------------------------------------------------------------
// VICTORY — the P0 finale screen with the run's story on it
// ---------------------------------------------------------------------------
function fillVictory(S) {
  const v = S.victory;
  if (!v) return;
  const mins = Math.floor(v.ticks / 20 / 60);
  const secsN = Math.floor((v.ticks / 20) % 60);
  const time = mins + ':' + String(secsN).padStart(2, '0');
  const stats = [
    [v.tide, TXT('TIDES BROKEN')],
    [v.kills, TXT('KILLS')],
    [v.deaths, TXT('WASHOUTS')],
    [tf(TXT('LV %1'), v.level), TXT('FINAL LEVEL')],
    [v.goldEarned, TXT('GOLD EARNED')],
    [time, TXT('RUN TIME')],
  ];
  const box = UI['victory-stats'];
  box.textContent = '';
  for (const [val, label] of stats) {
    const d = document.createElement('div');
    d.className = 'vstat panel';
    const vv = document.createElement('div'); vv.className = 'vv'; vv.textContent = String(val);
    const vl = document.createElement('div'); vl.className = 'vl'; vl.textContent = label;
    d.appendChild(vv); d.appendChild(vl);
    box.appendChild(d);
  }
  const body = BODIES.find(b => b.id === v.body);
  UI['victory-build'].textContent = (body ? body.ico + ' ' + TXT(body.name) + '  ·  ' : '') +
    v.spells.map(s => SPELL[s.id].ico + '×' + s.rank).join('  ');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
