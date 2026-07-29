// SURVIVAL QUEST — THE CONTENT. Bodies, spells, items, fruit, modifiers, stalls.
//
// Everything here is DATA. The spell "engine" in sim.js is one interpreter over
// the fx descriptors below — thirty-eight spells, zero bespoke implementations
// (spec §2's content cheat code, restated as law in §6 and the P0 goal).
//
// Numbers come from spec §6 v0 and are all TUNE-in-graybox. Rank scaling is one
// rule everywhere: value = a + b × (rank - 1), written as [a, b].
//
// P0 SLICE ADAPTATION (logged in memory): §6 gates big spells at tide 10 for
// the 30-tide game. This 10-tide slice unlocks them at tide 8 so a run can
// actually contain one; tier-2 stays at tide 5 per the doc.

export const RULES = {
  tier1Price: 3,          // pearls (§6)
  tier2Price: 5,
  bigPrice: 8,
  tier2UnlockTide: 5,     // §6
  bigUnlockTide: 8,       // P0 slice adaptation (doc says t10 for the 30-tide game)
  spellRankCap: 5,        // §6: skill points rank owned spells to 5...
  bigRankCap: 3,          // ...bigs to 3
  levelCap: 30,           // §6 hero level cap
  respecCost: 100,        // gold. The Tide Tablet. CHEAP RESPEC IS SACRED (§2).
  itemSlots: 6,           // §6
  fruitCap: 50,           // §6: fruit ranks capped 50
  fruitPrice: 75,         // §6: 75g singles
  fruitPackPrice: 350,    // §6: 350g five-packs
  fruitPackSize: 5,
  finalTide: 10,          // the P0 slice finale (30 at P2)
  bossTides: [5, 10],     // §6 bosses at 5/15/25; 10 is the P0 finale boss
  bossQuotaDiv: 2,        // boss tides run a reduced quota (§6): ceil(quota / this)
  modFromTide: 6,         // modifier tides from tide 6, every ~3 (§6) -> 6 and 9 in P0
  modEvery: 3,
  maxPlayers: 16,         // hard cap on squares around the market (rev 1). Rooms
                          // can seat fewer; the shore never grows past sixteen.
  multiEdgeFromTide: 3,   // tides 1-2 break out of the sea only (the taught
                          // front); from here every surf-set rolls its own fence
};

// value = a + b × (rank-1)
export const rv = (spec, rank) => Array.isArray(spec) ? spec[0] + spec[1] * ((rank | 0) - 1) : spec;

// ---------------------------------------------------------------------------
// BODIES (§6: 3 at P0). Model + statline + ONE TINY INNATE. Bodies are chassis;
// identity comes from what you buy at the racks.
//   atkS is seconds per swing; sp is flat spellpower; range 7 = ranged basic.
// ---------------------------------------------------------------------------
export const BODIES = [
  {
    id: 'wrestler', name: 'THE WRESTLER', ico: '💪',
    arch: 'HEAVY', flavor: 'Went overboard mid-promo. The life ring stays ON.',
    base: { maxHp: 1050, regen: 8, dmg: 60, atkS: 0.62, range: 2.6, ms: 6.0, sp: 0, radius: 0.65 },
    innate: { id: 'suplex', name: 'SUPLEX TIMING', desc: 'Every 6th swing hits for double damage.' },
  },
  {
    id: 'diver', name: 'THE PEARL DIVER', ico: '🤿',
    arch: 'SWIFT', flavor: 'Knows every current in the cove. The crabs learned her name.',
    base: { maxHp: 760, regen: 6, dmg: 42, atkS: 0.40, range: 2.8, ms: 7.6, sp: 0, radius: 0.55 },
    innate: { id: 'riptide', name: 'RIPTIDE FEET', desc: 'Kills grant +45% move speed for 1.5s.' },
  },
  {
    id: 'magician', name: 'THE RETIRED CRUISE MAGICIAN', ico: '🎩',
    arch: 'CASTER', flavor: 'The final show ended in a shipwreck. The wand still works.',
    base: { maxHp: 660, regen: 5, dmg: 34, atkS: 0.55, range: 7.0, ms: 6.5, sp: 18, radius: 0.55 },
    innate: { id: 'encore', name: 'ENCORE', desc: 'Spell cooldowns run 15% faster.' },
  },
];

// ---------------------------------------------------------------------------
// SPELLS — the 16 from §6 plus the rev-2 WS3 pool, sold on the boardwalk
// racks. ONE ENGINE reads these.
//
// fx types the sim implements ONCE each:
//   proj    projectiles toward the aim point (count/spread/speed/aoe/slow)
//   bolt    a homing missile at the nearest creep (stun/drain riders)
//   line    a travelling wave that tears down a lane, hits each creep once
//   nova    instant damage circle centred on the hero (debuff riders too)
//   aoe     instant damage circle at the aim point (slow/root/stun/debuffs)
//   chain   instant zap that jumps between nearby creeps
//   shield  absorb pool on the hero
//   goldshield  damage burns gold instead of HP (the purse soaks it)
//   heal    instant self-heal
//   hide    the tide loses you; swinging or casting blows the cover
//   dash    reposition toward the aim point
//   rain    delayed impacts scattered around the aim point (meteors)
//   buff    timed self-buff (mults + optional shield + heal-over-time)
//   summon  allied units that fight beside you (count/fromCorpses variants)
//   passive equipped-slot stat riders (crit/lifesteal/haste/thorns + the WS3
//           set: flat-DR, dodge, on-hit poison/cleave/proc/pinch, burn ring,
//           damage aura, cooldown-rate aura, cheat-death)
//
// spc = spellpower coefficient: damage/heal/shield gains sp × spc.
// Stuns and roots always land at HALF duration on bosses — one rule, stated
// in every tooltip that stuns or roots.
// ---------------------------------------------------------------------------
export const SPELLS = [
  // --- STRIKE (the damage rack) ---
  { id: 'fireball', name: 'FIREBALL', ico: '🔥', cat: 'STRIKE', tier: 1, kind: 'active', cd: 5,
    fx: { type: 'proj', count: [1, 0], spread: 0, speed: 24, aoe: 2.3, dmg: [75, 32], spc: 1.0 },
    desc: 'Hurl a fireball: %1 damage in a %2m burst.',
    vals: (r, sp) => [Math.round(rv([75, 32], r) + sp * 1.0), 2.3] },
  { id: 'spinslash', name: 'SPIN SLASH', ico: '🌀', cat: 'STRIKE', tier: 1, kind: 'active', cd: 7,
    fx: { type: 'nova', radius: [3.2, 0.15], dmg: [65, 26], spc: 0.8 },
    desc: 'Whirl in place: %1 damage to everything within %2m.',
    vals: (r, sp) => [Math.round(rv([65, 26], r) + sp * 0.8), rv([3.2, 0.15], r).toFixed(1)] },
  { id: 'frostsnap', name: 'FROST SNAP', ico: '❄️', cat: 'STRIKE', tier: 1, kind: 'active', cd: 8,
    fx: { type: 'aoe', radius: 2.6, dmg: [45, 18], spc: 0.7, slowPct: [35, 5], slowSec: 2.5 },
    desc: 'Snap-freeze a %2m circle: %1 damage, %3% slow for 2.5s.',
    vals: (r, sp) => [Math.round(rv([45, 18], r) + sp * 0.7), 2.6, rv([35, 5], r)] },
  { id: 'multishot', name: 'MULTISHOT', ico: '🏹', cat: 'STRIKE', tier: 2, kind: 'active', cd: 6,
    fx: { type: 'proj', count: [4, 1], spread: 44, speed: 26, aoe: 0, dmg: [42, 15], spc: 0.5 },
    desc: 'Fan of %1 bolts, %2 damage each.',
    vals: (r, sp) => [rv([4, 1], r), Math.round(rv([42, 15], r) + sp * 0.5)] },
  { id: 'chainspark', name: 'CHAIN SPARK', ico: '⚡', cat: 'STRIKE', tier: 2, kind: 'active', cd: 9,
    fx: { type: 'chain', jumps: [3, 1], dmg: [60, 24], spc: 0.7, falloff: 0.85, jumpRange: 5 },
    desc: 'A spark that arcs to %1 creeps for %2 damage, fading each jump.',
    vals: (r, sp) => [rv([3, 1], r), Math.round(rv([60, 24], r) + sp * 0.7)] },
  { id: 'conchcrack', name: 'CONCH CRACK', ico: '🐚⚡', cat: 'STRIKE', tier: 1, kind: 'active', cd: 8,
    fx: { type: 'bolt', speed: 26, dmg: [70, 26], spc: 0.8, stunSec: 1.3 },
    desc: 'Crack a conch bolt at the nearest creep: %1 damage and a %2s stun. (Bosses: half stun.)',
    vals: (r, sp) => [Math.round(rv([70, 26], r) + sp * 0.8), 1.3] },
  { id: 'sandspout', name: 'SANDSPOUT', ico: '🌪️', cat: 'STRIKE', tier: 1, kind: 'active', cd: 11,
    fx: { type: 'nova', radius: 2.6, dmg: [50, 20], spc: 0.6, stunSec: [0.8, 0.1] },
    desc: 'Whip the sand into a spout: %1 damage within %2m and a %3s stun. (Bosses: half stun.)',
    vals: (r, sp) => [Math.round(rv([50, 20], r) + sp * 0.6), 2.6, rv([0.8, 0.1], r).toFixed(1)] },
  { id: 'ripcurrent', name: 'RIPCURRENT', ico: '🌊', cat: 'STRIKE', tier: 2, kind: 'active', cd: 9,
    fx: { type: 'line', speed: 20, dist: 11, width: 1.3, dmg: [85, 30], spc: 0.9 },
    desc: 'Tear a %2m rip down the lane: %1 damage to every creep it crosses.',
    vals: (r, sp) => [Math.round(rv([85, 30], r) + sp * 0.9), 11] },
  { id: 'sirenskiss', name: "SIREN'S KISS", ico: '💋', cat: 'STRIKE', tier: 2, kind: 'active', cd: 9,
    fx: { type: 'bolt', speed: 26, dmg: [80, 30], spc: 0.9, drainPct: 60 },
    desc: "Blow a kiss that bites: %1 damage, and %2% of it comes home as healing.",
    vals: (r, sp) => [Math.round(rv([80, 30], r) + sp * 0.9), 60] },
  { id: 'crackedshell', name: 'CRACKED SHELL', ico: '🥚', cat: 'STRIKE', tier: 2, kind: 'active', cd: 12,
    fx: { type: 'aoe', radius: 3.0, dmg: [30, 12], spc: 0.4, vulnPct: [15, 5], vulnSec: 6 },
    desc: 'Crack every shell in a %2m circle: %1 damage, and they take +%3% damage for 6s.',
    vals: (r, sp) => [Math.round(rv([30, 12], r) + sp * 0.4), 3, rv([15, 5], r)] },

  // --- GUARD (keep the sea off you) ---
  { id: 'bulwark', name: 'BULWARK', ico: '🛡️', cat: 'GUARD', tier: 1, kind: 'active', cd: 14,
    fx: { type: 'shield', amount: [150, 75], spc: 1.2, sec: 6 },
    desc: 'Raise a %1-point shield for 6s.',
    vals: (r, sp) => [Math.round(rv([150, 75], r) + sp * 1.2)] },
  { id: 'lifebloom', name: 'LIFEBLOOM', ico: '🌺', cat: 'GUARD', tier: 1, kind: 'active', cd: 12,
    fx: { type: 'heal', amount: [130, 65], spc: 1.0 },
    desc: 'Bloom: restore %1 HP instantly.',
    vals: (r, sp) => [Math.round(rv([130, 65], r) + sp * 1.0)] },
  { id: 'rootvine', name: 'ROOT VINE', ico: '🌿', cat: 'GUARD', tier: 1, kind: 'active', cd: 10,
    fx: { type: 'aoe', radius: 2.4, dmg: [30, 14], spc: 0.4, rootSec: [1.2, 0.25] },
    desc: 'Vines erupt in a %2m circle: %1 damage and roots for %3s. (Bosses: half root.)',
    vals: (r, sp) => [Math.round(rv([30, 14], r) + sp * 0.4), 2.4, rv([1.2, 0.25], r).toFixed(1)] },
  { id: 'thornshell', name: 'THORN SHELL', ico: '🦔', cat: 'GUARD', tier: 2, kind: 'passive',
    fx: { type: 'passive', thorns: [14, 7] },
    desc: 'While slotted: attackers take %1 damage per hit.',
    vals: r => [rv([14, 7], r)] },
  { id: 'barnaclehide', name: 'BARNACLE HIDE', ico: '🪨', cat: 'GUARD', tier: 1, kind: 'passive',
    fx: { type: 'passive', flatDR: [6, 3] },
    desc: 'While slotted: swings against you hit for %1 less (they always land at least 1). Slams do not care.',
    vals: r => [rv([6, 3], r)] },
  { id: 'crabwalk', name: 'CRABWALK', ico: '🦀', cat: 'GUARD', tier: 1, kind: 'passive',
    fx: { type: 'passive', dodgePct: [10, 3] },
    desc: 'While slotted: sidestep %1% of swings outright. Never slams, never meteors.',
    vals: r => [rv([10, 3], r)] },
  { id: 'foghorn', name: 'FOGHORN BLAST', ico: '📯', cat: 'GUARD', tier: 1, kind: 'active', cd: 13,
    fx: { type: 'nova', radius: 3.2, dmg: 0, weakenPct: [20, 5], weakenSec: [5, 0.5] },
    desc: 'One long blast: creeps within %1m deal %2% less damage for %3s.',
    vals: r => [3.2, rv([20, 5], r), rv([5, 0.5], r).toFixed(1)] },
  { id: 'aloesalve', name: 'ALOE SALVE', ico: '🌱', cat: 'GUARD', tier: 1, kind: 'active', cd: 14,
    fx: { type: 'buff', sec: 8, hotAmount: [150, 70], spc: 1.0 },
    desc: 'Smear on the salve: restore %1 HP over 8s while you keep fighting.',
    vals: (r, sp) => [Math.round(rv([150, 70], r) + sp * 1.0)] },
  { id: 'gullswarm', name: 'GULL SWARM', ico: '🕊️', cat: 'GUARD', tier: 2, kind: 'active', cd: 13,
    fx: { type: 'aoe', radius: 3.0, dmg: 0, missPct: [25, 5], missSec: 6 },
    desc: 'Call the gulls down on a %1m circle: creeps there miss %2% of their swings for 6s.',
    vals: r => [3, rv([25, 5], r)] },
  { id: 'cowrieward', name: 'COWRIE WARD', ico: '🐚💰', cat: 'GUARD', tier: 2, kind: 'active', cd: 16,
    fx: { type: 'goldshield', sec: 8, rate: [3, 1] },
    desc: 'For 8s damage bites your purse, not you: 1 gold soaks %1 damage. Breaks when the purse runs dry.',
    vals: r => [rv([3, 1], r)] },
  { id: 'squidink', name: 'SQUID INK', ico: '🦑', cat: 'GUARD', tier: 2, kind: 'active', cd: 18,
    fx: { type: 'hide', sec: [2.5, 0.5] },
    desc: 'Vanish in a cloud of ink for %1s — the tide loses you. Swinging or casting blows the cover.',
    vals: r => [rv([2.5, 0.5], r).toFixed(1)] },

  // --- CURRENT (what carries you) ---
  { id: 'crit', name: 'CRIT', ico: '🎯', cat: 'CURRENT', tier: 1, kind: 'passive',
    fx: { type: 'passive', crit: [12, 4] },
    desc: 'While slotted: %1% chance your swings hit double.',
    vals: r => [rv([12, 4], r)] },
  { id: 'hasteaura', name: 'HASTE AURA', ico: '🌊', cat: 'CURRENT', tier: 1, kind: 'passive',
    fx: { type: 'passive', asPct: [10, 4], msPct: [6, 2] },
    desc: 'While slotted: +%1% attack speed, +%2% move speed.',
    vals: r => [rv([10, 4], r), rv([6, 2], r)] },
  { id: 'lifesteal', name: 'LIFESTEAL AURA', ico: '🩸', cat: 'CURRENT', tier: 2, kind: 'passive',
    fx: { type: 'passive', lifesteal: [12, 4] },
    desc: 'While slotted: swings heal you for %1% of the damage.',
    vals: r => [rv([12, 4], r)] },
  { id: 'blinkdash', name: 'BLINK-DASH', ico: '💨', cat: 'CURRENT', tier: 2, kind: 'active', cd: 9,
    fx: { type: 'dash', dist: [6, 1] },
    desc: 'Vanish %1m toward the cast point. Sheds roots and stuns.',
    vals: r => [rv([6, 1], r)] },
  { id: 'jellysting', name: 'JELLY STING', ico: '🪼', cat: 'CURRENT', tier: 1, kind: 'passive',
    fx: { type: 'passive', poisonPerSec: [7, 3], poisonSec: 2, poisonSlowPct: 20 },
    desc: 'While slotted: your hits smear venom — %1 damage a second and a 20% slow for 2s. Reapplying refreshes it.',
    vals: r => [rv([7, 3], r)] },
  { id: 'widewake', name: 'WIDE WAKE', ico: '🌊🪓', cat: 'CURRENT', tier: 1, kind: 'passive',
    fx: { type: 'passive', cleavePct: [25, 6], cleaveR: 1.7 },
    desc: 'While slotted: melee swings splash %1% of the damage to creeps within %2m of the victim. Swings only.',
    vals: r => [rv([25, 6], r), 1.7] },
  { id: 'emberskin', name: 'EMBER SKIN', ico: '🎇', cat: 'CURRENT', tier: 1, kind: 'passive',
    fx: { type: 'passive', burnPerSec: [12, 5], burnR: [1.9, 0.15] },
    desc: 'While slotted: your skin scorches the tide — %1 damage a second to creeps within %2m.',
    vals: r => [rv([12, 5], r), rv([1.9, 0.15], r).toFixed(1)] },
  { id: 'tikidrums', name: 'TIKI DRUMS', ico: '🥁', cat: 'CURRENT', tier: 1, kind: 'passive',
    fx: { type: 'passive', dmgPct: [8, 3] },
    desc: 'While slotted: the drums carry — +%1% damage for you AND anything you summon.',
    vals: r => [rv([8, 3], r)] },
  { id: 'shorebreak', name: 'SHOREBREAK', ico: '💥', cat: 'CURRENT', tier: 2, kind: 'passive',
    fx: { type: 'passive', procPct: [16, 3], procDmg: [45, 18], procSpc: 0.5, procR: 2.1 },
    desc: 'While slotted: swings have a %1% chance to break like a wave — %2 damage to everything within %3m of the victim.',
    vals: (r, sp) => [rv([16, 3], r), Math.round(rv([45, 18], r) + sp * 0.5), 2.1] },
  { id: 'pinchpoint', name: 'PINCH POINT', ico: '🦞', cat: 'CURRENT', tier: 2, kind: 'passive',
    fx: { type: 'passive', pinchPct: [10, 2], pinchDmg: [15, 10], pinchSec: 1 },
    desc: 'While slotted: swings have a %1% chance to pinch — +%2 bonus damage and a 1s stun. (Bosses: half stun.)',
    vals: r => [rv([10, 2], r), rv([15, 10], r)] },
  { id: 'tradewinds', name: 'TRADE WINDS', ico: '🍃', cat: 'CURRENT', tier: 2, kind: 'passive',
    fx: { type: 'passive', cdrPct: [8, 3] },
    desc: 'While slotted: your cooldowns run %1% faster.',
    vals: r => [rv([8, 3], r)] },

  // --- DEEP (the bigs; R slot; rank cap 3) ---
  { id: 'meteortide', name: 'METEOR TIDE', ico: '☄️', cat: 'DEEP', tier: 'big', kind: 'active', cd: 45,
    fx: { type: 'rain', count: [7, 3], dmg: [100, 55], spc: 0.8, spreadR: 6, hitR: 2.2, sec: 2.5 },
    desc: 'Call %1 burning stones out of the sky, %2 damage each.',
    vals: (r, sp) => [rv([7, 3], r), Math.round(rv([100, 55], r) + sp * 0.8)] },
  { id: 'avatar', name: 'AVATAR OF THE VOLCANO', ico: '🌋', cat: 'DEEP', tier: 'big', kind: 'active', cd: 60,
    fx: { type: 'buff', sec: 10, dmgMult: [1.5, 0.25], asMult: 1.35, shield: [300, 200], spc: 1.0 },
    desc: 'Become the mountain for 10s: +%1% damage, +35% attack speed, %2 shield.',
    vals: (r, sp) => [Math.round((rv([1.5, 0.25], r) - 1) * 100), Math.round(rv([300, 200], r) + sp * 1.0)] },
  { id: 'reefgolem', name: 'SUMMON REEF GOLEM', ico: '🗿', cat: 'DEEP', tier: 'big', kind: 'active', cd: 50,
    fx: { type: 'summon', hp: [700, 350], spc: 2.0, dmg: [50, 25], atkS: 0.7, range: 2.0, ms: 5.5, radius: 0.8, sec: 18 },
    desc: 'Raise a %1 HP coral golem that fights for 18s.',
    vals: (r, sp) => [Math.round(rv([700, 350], r) + sp * 2.0)] },
  { id: 'drownedtide', name: 'THE DROWNED TIDE', ico: '🧟🦀', cat: 'DEEP', tier: 'big', kind: 'active', cd: 50,
    fx: { type: 'summon', fromCorpses: true, unit: 'drowned', count: [3, 1], hp: [190, 90], spc: 1.2,
      dmg: [24, 9], atkS: 0.7, range: 1.1, ms: 6.0, radius: 0.5, sec: 15 },
    desc: 'Raise the drowned from up to %1 fresh corpses: %2 HP crabs that fight for 15s. The sand keeps its dead six seconds — kill first.',
    vals: (r, sp) => [rv([3, 1], r), Math.round(rv([190, 90], r) + sp * 1.2)] },
  { id: 'krakengrip', name: "KRAKEN'S GRIP", ico: '🐙', cat: 'DEEP', tier: 'big', kind: 'active', cd: 45,
    fx: { type: 'aoe', radius: 4.5, dmg: [130, 60], spc: 0.9, rootSec: [2.2, 0.6] },
    desc: 'The kraken reaches up through a %2m circle: %1 damage and a %3s root. (Bosses: half root.)',
    vals: (r, sp) => [Math.round(rv([130, 60], r) + sp * 0.9), 4.5, rv([2.2, 0.6], r).toFixed(1)] },
  { id: 'secondsunrise', name: 'SECOND SUNRISE', ico: '🌅', cat: 'DEEP', tier: 'big', kind: 'passive',
    fx: { type: 'passive', cheatPct: [30, 10], sleepSec: [90, -15] },
    desc: "While it sits in R, the first death doesn't take you: flash back to %1% HP, shed the stun, keep fighting. Then it sleeps %2s.",
    vals: r => [rv([30, 10], r), rv([90, -15], r)] },
];

export const SPELL = Object.fromEntries(SPELLS.map(s => [s.id, s]));

export function spellPrice(s) {
  return s.tier === 'big' ? RULES.bigPrice : (s.tier === 2 ? RULES.tier2Price : RULES.tier1Price);
}
export function spellRankCap(s) { return s.tier === 'big' ? RULES.bigRankCap : RULES.spellRankCap; }
// tideNow = the tide the player is on (running, or next if on break)
export function spellUnlockTide(s) {
  return s.tier === 'big' ? RULES.bigUnlockTide : (s.tier === 2 ? RULES.tier2UnlockTide : 1);
}

// ---------------------------------------------------------------------------
// SURF SHACK — the 8 tier-1 items (§6: 100-400g; Flippers, Reef Blade, Shell
// Plate, Pearl Pendant, juice potions). 6 slots. Potions are one slot, one use.
// ---------------------------------------------------------------------------
export const ITEMS = [
  { id: 'flippers', name: 'FLIPPERS', ico: '🐸', price: 150, kind: 'passive',
    mods: { msPct: 9 }, desc: '+9% move speed.' },
  { id: 'reefblade', name: 'REEF BLADE', ico: '🗡️', price: 250, kind: 'passive',
    mods: { dmg: 14 }, desc: '+14 damage.' },
  { id: 'shellplate', name: 'SHELL PLATE', ico: '🐚', price: 250, kind: 'passive',
    mods: { hp: 180, regen: 2 }, desc: '+180 HP, +2 regen.' },
  { id: 'pearlpendant', name: 'PEARL PENDANT', ico: '📿', price: 400, kind: 'passive',
    mods: { sp: 20 }, desc: '+20 spellpower.' },
  { id: 'guava', name: 'GUAVA JUICE', ico: '🧃', price: 100, kind: 'potion',
    use: { heal: 350 }, desc: 'Drink: restore 350 HP.' },
  { id: 'noni', name: 'NONI BOOST', ico: '🥤', price: 150, kind: 'potion',
    use: { buff: { sec: 8, asMult: 1.4, msMult: 1.4 } }, desc: 'Drink: +40% attack and move speed for 8s.' },
  { id: 'kava', name: 'KAVA CALM', ico: '🍹', price: 150, kind: 'potion',
    use: { shield: 300, sec: 10 }, desc: 'Drink: a 300-point shield for 10s.' },
  { id: 'chili', name: 'CHILI SQUEEZE', ico: '🌶️', price: 150, kind: 'potion',
    use: { buff: { sec: 10, dmgFlat: 20 } }, desc: 'Drink: +20 damage for 10s.' },

  // -------------------------------------------------------------------------
  // THE PIRATE TRADER (rev 2 WS5, §6 item arc) — docks at tide 6. A different
  // species of stock: build-around passives that feed the WS3 rider lanes, and
  // actives with CHARGES. Prices sit on the measured earned-by-break curve
  // (first buy is a deliberate save ~t7-8; a full kit is impossible by design).
  // Rows carry shop:'trader' (the shack filter skips them) + tide (buy gate).
  // NOTE: MESSAGE IN A BOTTLE is deliberately NOT a self-res — SECOND SUNRISE
  // owns cheat-death (the one-home law). The bottle cannot intercept a death.
  // -------------------------------------------------------------------------
  { id: 'cutlass', name: 'CUTLASS', ico: '⚔️', price: 900, kind: 'passive',
    shop: 'trader', tide: 6, mods: { dmg: 26, cleavePct: 20, cleaveR: 1.7 },
    desc: '+26 damage; melee swings splash 20% of the damage to creeps within 1.7m. Swings only.' },
  { id: 'krakenscale', name: 'KRAKEN SCALE', ico: '🐙🛡️', price: 850, kind: 'passive',
    shop: 'trader', tide: 6, mods: { hp: 220, flatDR: 6 },
    desc: '+220 HP; swings against you hit for 6 less (they always land at least 1). Slams do not care.' },
  { id: 'doubloon', name: 'LUCKY DOUBLOON', ico: '🪙', price: 800, kind: 'passive',
    shop: 'trader', tide: 6, mods: { crit: 10 },
    desc: '+10% chance your swings hit double.' },
  { id: 'figurehead', name: 'CARVED FIGUREHEAD', ico: '🚢', price: 950, kind: 'passive',
    shop: 'trader', tide: 6, mods: { dmgPct: 12 },
    desc: '+12% damage for you AND anything you summon.' },
  { id: 'powderkeg', name: 'POWDER KEG', ico: '🧨', price: 950, kind: 'active',
    shop: 'trader', tide: 6, charges: 3, use: { nova: { r: 3.2, dmg: 220 } },
    desc: 'Light it: 220 damage to everything within 3.2m of you. Refuses over empty sand. 3 charges.' },
  { id: 'blackspot', name: 'THE BLACK SPOT', ico: '⚫', price: 1050, kind: 'active',
    shop: 'trader', tide: 6, charges: 2, use: { nova: { r: 3.0, dmg: 0, vulnPct: 25, vulnSec: 6 } },
    desc: 'Mark everything within 3m: +25% damage taken for 6s. 2 charges.' },
  { id: 'ghostconch', name: 'GHOST CONCH', ico: '👻🐚', price: 1200, kind: 'active',
    shop: 'trader', tide: 6, charges: 2, use: { ward: { sec: 5 } },
    desc: 'Blow it: for 5s boss slams break harmless over you. 2 charges.' },
  { id: 'bottle', name: 'MESSAGE IN A BOTTLE', ico: '🍾', price: 700, kind: 'active',
    shop: 'trader', tide: 6, charges: 1, use: { healPct: 55, shedStun: true },
    desc: 'Read it when the sea has you beaten: restore 55% of max HP and shed the stun. Corpses cannot read — this will not save you from a death, only from the road to one.' },
];
export const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));

// ---------------------------------------------------------------------------
// FRUIT STAND (§6): three stats, re-skinned tome economy. Per-rank gains.
// ---------------------------------------------------------------------------
export const FRUITS = [
  { id: 'mango', name: 'MANGO OF MIGHT', ico: '🥭', stat: 'POWER',
    per: { dmg: 2.5, sp: 2.5 }, desc: 'Each: +2.5 damage, +2.5 spellpower.' },
  { id: 'starfruit', name: 'STARFRUIT', ico: '✨', stat: 'SPEED',
    per: { asPct: 2, msPct: 1.5 }, desc: 'Each: +2% attack speed, +1.5% move speed.' },
  { id: 'coconut', name: 'COCONUT DE VIDA', ico: '🥥', stat: 'SPIRIT',
    per: { hp: 35, regen: 0.8 }, desc: 'Each: +35 HP, +0.8 regen.' },
];
export const FRUIT = Object.fromEntries(FRUITS.map(f => [f.id, f]));

// ---------------------------------------------------------------------------
// MODIFIER TIDES (§6, CHS's array trick verbatim): from tide 6, every ~3, that
// tide's creeps get ONE bolted ability. Which one is a seeded draw per tide.
// ---------------------------------------------------------------------------
export const MODS = [
  { id: 'bash', name: 'BASH CRABS', ico: '🔨', desc: 'Hits have a 20% chance to stun you.' },
  { id: 'evasive', name: 'EVASIVE MONKEYS', ico: '🙈', desc: 'They dodge 25% of swings. Spells never miss.' },
  { id: 'split', name: 'SPLITTING JELLIES', ico: '🫧', desc: 'Each one bursts into two smaller ones.' },
];
export const MOD = Object.fromEntries(MODS.map(m => [m.id, m]));

// ---------------------------------------------------------------------------
// XP — levels buy DEPTH (skill points -> ranks); pearls buy BREADTH (§6).
// Levels grant nothing else: naked stays naked, exactly like the source (§2).
// ---------------------------------------------------------------------------
export function killXp(tide) { return 8 + 2 * tide; }
export function clearXp(tide) { return 40 + 10 * tide; }
export function xpToNext(level) { return 60 + 50 * level; }   // level L -> L+1

// ---------------------------------------------------------------------------
// BOSSES (§6: hero-unit bosses, reduced quota). Stats ride the creep curve.
// ---------------------------------------------------------------------------
export const BOSSES = {
  5:  { id: 'kingclaw', name: 'KING SANDCLAW', skin: 'crab', hpMult: 9, dmgMult: 2.8,
        ms: 1.9, radius: 1.5, atkS: 1.4, scale: 2.6, bountyMult: 10, slamCd: 6, slamMult: 2.2, slamR: 2.6 },
  10: { id: 'undertow', name: 'THE UNDERTOW', skin: 'jelly', hpMult: 11, dmgMult: 3.2,
        ms: 1.7, radius: 1.7, atkS: 1.3, scale: 3.1, bountyMult: 10, slamCd: 5, slamMult: 2.0, slamR: 3.0,
        surgeAt: 0.5, surgeCount: 5 },
};

// ---------------------------------------------------------------------------
// THE MARKET STALLS (rev 1) — all six shops stand together in the central
// market plaza now, TFT-carousel style: between tides every castaway is ported
// to the middle of the island to spend, then ported home when the next tide
// rolls. Coordinates are MARKET-LOCAL metres (plaza centre = 0,0; the port-in
// point is on the south/sea side): four racks fan across the back arc, the
// fruit stand and surf shack flank the entrance. Shopping is still walkable
// and proximity-opened (§4) — the ritual moved, it did not die.
// ---------------------------------------------------------------------------
export const STALLS = [
  { id: 'strike',  name: 'STRIKE RACK',  ico: '🔥', x: -18,  z: 3,   color: 0xF06A3C, kind: 'rack' },
  { id: 'guard',   name: 'GUARD RACK',   ico: '🛡️', x: -6.5, z: 9,   color: 0x4FA8E8, kind: 'rack' },
  { id: 'current', name: 'CURRENT RACK', ico: '🌊', x: 6.5,  z: 9,   color: 0x59DCD2, kind: 'rack' },
  { id: 'deep',    name: 'DEEP RACK',    ico: '☄️', x: 18,   z: 3,   color: 0xE7C25C, kind: 'rack' },
  { id: 'fruit',   name: 'FRUIT STAND',  ico: '🥭', x: -15,  z: -11, color: 0xF0455C, kind: 'fruit' },
  { id: 'shack',   name: 'SURF SHACK',   ico: '🐚', x: 15,   z: -11, color: 0x9A6B3F, kind: 'shack' },
  // WS5: the trader anchors the back-centre, behind the rack arc — the market
  // camera faces it, so the new shop is the marquee. Clears the port-in point
  // (0,-14) by 26m and both centre racks by ~7.4m (no STALL_REACH contention).
  { id: 'trader',  name: 'PIRATE TRADER', ico: '⚓', x: 0,   z: 12.5, color: 0x2E3A46, kind: 'trader' },
];
export const STALL_REACH = 6.0;   // metres from stall centre that counts as "at the counter"

export const CAT_COLOR = { STRIKE: '#FF8C5A', GUARD: '#7AC8FF', CURRENT: '#7FE7D8', DEEP: '#E7C25C', ITEM: '#E7C25C' };
