# SURVIVAL QUEST

Sixteen castaways wash up on a low-poly tropical island. Each claims a fenced
square on the shore; the market in the middle belongs to everyone. During a tide
you fight your own wave in your own square — surf-sets break over any fence, not
just the sea. Between tides the island **ports you to the market**, where every
shop stands. Spend, then it ports you home for the next one. Build a hero out of
whatever the racks are selling and out-survive everyone else.

A zero-install browser game — one page, three.js, **no build step, no backend**.

**Play:** https://wyattintexas.github.io/last-resort/

---

## Status — P0 COMPLETE + REV 1 (the squares & the market) + REV 2 WS1 (combat feel) + WS2 (mobile layout) + WS3 (abilities)

**Rev 2 WS3 (v0.7.0)** filled the pool: **38 spells** on the same four racks,
executed by the same ONE engine. The racks grew every classic mechanic family,
island-spun — a stunning conch bolt and a sand-spout nova, a lane-tearing
ripcurrent, a life-drinking kiss, shell-cracking vulnerability, a damage-sapping
foghorn and a swing-blinding gull swarm, a heal-over-time salve, a **gold-burning
ward** (damage bites your purse — the ledger law holds by construction), squid-ink
stealth, venom / cleave / wave-break / pinch-stun on-hit riders, an ember ring, a
drum aura that feeds your summons, a cooldown-rate aura that stacks with ENCORE,
**corpse-raising** (kills leave six-second corpses; THE DROWNED TIDE eats up to
five of them and raises drowned crabs where the bodies lay), a boss-sized root,
and **SECOND SUNRISE** — an R-slot passive that takes your first death and then
sleeps. Stuns and roots always land at half strength on bosses. There is no
spell resource and never will be: costs are cooldowns, gold, corpses and
drawbacks. Same 15 pearls a run against 38 rows — breadth pressure IS the
design. Classic-build runs stay byte-identical.

**Rev 2 WS2 (v0.6.0)** made the HUD **context-sensitive** — chrome earns its
pixels per phase, or it dies. A fresh run mid-tide shows **zero buttons**: the
cast bar is *born* at your first spell purchase (one slot per slotted spell —
the R slot's arrival is the "bigs are live" fanfare), item chips exist only
while items do, the tidebox lives only during tides, purse/HP only where you
can spend or bleed, and the seed stamp leaves the fight on glass. The floating
C/M buttons are gone: **your own HP panel opens the castaway sheet**, and the
mute rides the calm-phase panels (break, washout, title). At phone heights the
standings collapse to a one-line race strip (`T4 0:58 · YOU +0:12`) — tap for
the full board, it folds back at the next tide; desktop keeps the board always
up. Calm panels go compact at 390pt, every free-floating control is 60px+
under a thumb, and the Forge scrolls (ready for WS6's eight cards). Zero sim
edits — full-run times are byte-identical to v0.5.0.

**Rev 2 WS1 (v0.5.0)** made the fights *feel* like classic RTS hero combat:
every attacker now runs a full **windup → strike → backswing** swing cycle
(driven off the attack cooldown the sim already exposes — zero timing changes
for melee), landed hits pop **sparks + a victim squash**, kills leave a
**corpse that tips and sinks into the sand** plus a coin chime, big beats
(crits, boss slams, kill bursts) land a **selective hitstop**, stuns read
three ways at once (ring, orbiting stars, grayed cast bar), and a **13-cue
WebAudio combat kit** gives every swing, hit, kill and state change a voice —
still zero audio files. The one sim change: **the wand's ranged basic is now a
real homing missile** (it lobs, travels, retargets if its victim dies mid-flight,
or fizzles) — tuned so the measured full-run pace matches the old instant zap
to +0.3s. Ghost records from v0.4.x remain honest; magician timelines shift by
missile flight time.

**Rev 1 (v0.4.0, 7/28)** restructured the map to the TFT shape on Wyatt's call:
16 private squares (hard cap) around one central market plaza, teleport-to-shop
between rounds, edge-rolled spawns from tide 3, a beacon lighthouse marking the
market from every square, and seat pennants on the fifteen vacant squares that
multiplayer will fill at P1.

Link 1 built the cove, the deterministic sim and the tide spawner. Link 2 built the
game. **Link 3 finished it**: the ghost race, the title, the juice, the death
spectacle — the P0 slice is whole.

| | |
|---|---|
| ✅ link 1 | island cove scene, 20Hz deterministic sim, click-to-move hero with auto-attack, tide/surf-set spawner, shop-break loop, gold + pearls, `RESORT.*` debug API, headless CDP smoke test, i18n rails, `?v=` cache-bust |
| ✅ link 2 | **THE FORGE** (3 bodies, each a statline + one tiny innate) · **spells as shop items** (16 then; 38 since rev-2 WS3) on four walkable boardwalk racks (STRIKE / GUARD / CURRENT / DEEP), all driven by ONE data-driven engine · pearls buy breadth, XP → skill points → ranks buy depth · **100g Tide Tablet respec** (full pearl refund — sacred) · fruit stand (3 stats, rank 50) · Surf Shack (8 items, 6 slots) · QWER smart-cast at the hover point + cooldown HUD · **boss tides 5 & 10** with reduced quotas · **modifier tides** from 6 (Bash Crabs / Evasive Monkeys / Splitting Jellies) · tide 10 finale + victory screen |
| ✅ link 3 | **THE GHOST RACE** — your best run persists locally, the standings board is always on screen racing you tide-for-tide, lead changes get called in the ticker · **DAILY TIDE** (one fixed seed all day, apples-to-apples) · title screen wordmark over the vista · **death spectacle** (camera pulls to the postcard + a washed-up-next-tide countdown — death is never a logout) · WebAudio steel-pan idle + drum swells, all synthesized · gold-hour rim light on milestone tides · lifeguard hint ticker · static dressing baked to ~12 draw calls |

### Controls
- **Click** (either button) anywhere on the sand to move. Hold and drag to keep repathing.
- The hero auto-attacks whatever is nearest once it stops.
- **Q W E R** — smart-cast at the mouse point, no click-confirm. R is the big slot.
- **Walk to a stall** — its rack opens; walk away and it closes. The break countdown
  holds while a rack is open: the tide waits while you haggle.
- **C** — the castaway sheet (stats, ranks, respec). **1–6** — drink a slotted juice.
- **Space / Enter** — call the next tide in early. **Esc** — wave the shopkeeper off.
- **M** — sound on/off (everything is synthesized in WebAudio; there are no audio files).

### Try it
```
?seed=besaid      run a named seed
?lang=en          force a language
?l10n=audit       record every string that walks through TXT()
```

---

## The four laws the sim obeys

`js/sim.js` is pure: no three.js, no DOM, no clock. Give it a seed and call `tick()`
and it produces the same run on every machine.

1. **Fixed 20Hz tick — sim ticks are never wall time.** Nothing in the sim asks what
   time it is. "4 seconds" is 80 ticks and only ever 80 ticks. If the tab stalls for a
   second, the sim gets exactly 20 ticks, not one big one.
2. **Seeded PRNG only, and the seed object carries `v: 1`.** A seed without a version
   field is a bug waiting for the day the generator changes and old runs stop
   reproducing.
3. **Never splice a unit array mid-tick.** Dead units are *marked*, then swept in one
   pass at the end of the tick.
4. **Render interpolates.** Every unit keeps `px/pz` — where it stood when the tick
   began — so the renderer draws the in-between and never stutters.

Two more that earned their place the hard way:

- **Bodies occupy space.** `resolveBodies()` is not an anti-stacking nicety. Without it
  a surf-set collapses onto one point and *eleven* creeps swing from inside a metre;
  with it they form a ring and about six can reach. Measured, both ways.
- **Every player-facing string goes through `TXT()` from line 1** — the English string
  *is* the key, so an English build is byte-for-byte the game that shipped before any
  translator touched it. `?l10n=audit` proves coverage by measurement.

## Layout

```
index.html            shell, FFX-era UI skin, ?v= stamped import map
js/rng.js             mulberry32 + the versioned seed object
js/data.js            THE CONTENT — bodies, 38 spell rows, items, fruit, mods, stalls
js/sim.js             THE SIM — pure, deterministic, testable in node
js/scene.js           the island: squares, market, palette, zone camera, draw
js/shop.js            the market UI: forge, racks, castaway sheet, victory
js/game.js            fixed-step loop, input, HUD, window.RESORT
tools/cdp_smoke.mjs   headless 131-check battery over CDP (incl. a full 10-tide run)
tools/touch_probe.mjs 62 real-touch checks at 844×390 (dispatched taps, thumb audit)
tools/bot.mjs         the shopper bot — shared by node balance tools and the battery
tools/shopper.mjs     balance matrix: STAND (run-1 proxy) vs KITE (run-3 proxy)
bump.sh               stamp a new ?v= before every push
```

**One spell engine, thirty-eight data rows.** Every spell in `js/data.js` is a
descriptor (`proj` / `bolt` / `line` / `nova` / `aoe` / `chain` / `shield` /
`goldshield` / `heal` / `hide` / `dash` / `rain` / `buff` / `summon` / `passive`)
interpreted by one function in the sim — the CHS content cheat code, kept as law.
Rank scaling is one rule everywhere: `value = a + b × (rank-1)`. Passive riders
cover crit/lifesteal/haste/thorns plus the WS3 set: flat damage reduction, dodge,
on-hit poison/cleave/proc/pinch, a burn ring, damage + cooldown auras, and
cheat-death. Status verbs on creeps: slow, root, stun, vulnerability, weaken,
miss — bosses always take stuns and roots at half duration.

## Running it

```bash
python3 -m http.server 8791     # no build step; it is just files
open http://127.0.0.1:8791/

node tools/cdp_smoke.mjs http://127.0.0.1:8791/      # 131 checks + a screenshot
node tools/touch_probe.mjs http://127.0.0.1:8791/    # 62 touch checks at 844×390
node tools/shopper.mjs                               # the balance matrix
```

The battery boots the page in real headless Chrome with real WebGL, pauses the wall
clock, and asserts everything **through sim ticks**: the Forge gate, rack buys and
tier locks, cooldowns, the ledger law (`gold === start + bounty + clears − spent`,
every tick), and a **full 10-tide auto-run** by the shared shopper bot — reduced boss
quotas at 5/10, one bolted modifier at 6/9, the exact pearl schedule, and a VICTORY
with run stats at the end. Same seed + same scripted inputs must reproduce
byte-for-byte. Compile-success and byte-checksums are necessary but not sufficient —
only running it catches a boot crash.

## `window.RESORT`

```js
RESORT.pause(true)              // freeze the wall clock; you own the tick budget
RESORT.runTicks(600)            // advance exactly 600 ticks
RESORT.runTides(2)              // advance until 2 more tides are CLEARED
RESORT.runUntil(s => ..., cap)  // advance until a predicate holds, bounded by ticks
RESORT.setSeed('besaid')        // rebuild the run; returns the seed object
RESORT.snapshot()               // JSON fingerprint — the determinism assertion
RESORT.spawn(8, 'crab')         // put creeps on the sand
RESORT.skipTide()               // call the tide in early
RESORT.giveGold(500)            // top up the purse
RESORT.state                    // the live sim state

// link 2 — the build API (the shop UI drives these same calls)
RESORT.pickBody('diver')        // step off the Forge
RESORT.buySpell('fireball')     // pearls -> breadth; auto-racks to a free slot
RESORT.equip('crit', 'W')       // re-rack a spell
RESORT.cast('Q', x, z)          // smart-cast at a world point
RESORT.rankUp('fireball')       // skill point -> depth
RESORT.buyFruit('mango', true)  // true = the five-pack
RESORT.buyItem('flippers')      // Surf Shack, 6 slots
RESORT.useItem(0)               // drink the juice in slot 0
RESORT.respec()                 // the 100g Tide Tablet: every pearl comes back
RESORT.giveXp(500)              // levels for tests
RESORT.setHold(true)            // hold the break countdown (a rack is open)
```

Tests assert on `RESORT.snapshot().tick`. Never on seconds.

## Art

Spec §5: early-2000s low-poly tropical. Proudly low-poly, flat-shaded, **no PBR and no
normal maps**; one directional sun plus hemisphere ambient; **blob shadows only**, no
shadow maps; painted gradient sky dome; water is a plane with scrolling UVs and a
vertex bob; distance fog tinted the colour of the sky; oversaturated postcard palette.

**Everything you see is built from primitives.** The plan was to unify CC0 packs
(KayKit / Quaternius / Kenney) through one shared gradient-palette texture, but their
downloads sit behind JS/CDN gates with no direct archive URL, so P0 ships a handmade
graybox instead — which sidesteps the "mixed packs look mixed" risk entirely. The
shared palette texture and the single `PAL` colour list are already in place, so
dropping real meshes in later is a swap, not a rewrite.

## Balance, as measured

Numbers come from `js/data.js` + `js/sim.js` `TUNE` — a balance pass is one diff. The
tide curve (quota `12 + 2×tide`, the HP brackets, bounty `4 + tide`, pearl prices
3/5/8) is spec §6 verbatim. The balance target — *a fresh player buying sensibly dies
around tide 6–8 on run one, clears 10 by run three* — is proxied by the shopper bot
in `tools/shopper.mjs` and measured over 8 seeds × 3 bodies:

| policy (sensible buys in both) | result |
|---|---|
| STAND — casts but never moves (run-one proxy) | dies tide 6–9, avg ≈ 7 |
| KITE — has learned that feet are a stat (run-three proxy) | clears 10 on 24/24 body×seed runs |

The creep damage exponent (0.58) is the knob that opened the run-one death window —
at the old 0.42 a sensible statue cleared tide 10, measured, so it was raised, measured
again, and kept.

## Licence & IP

Code MIT (`LICENSE`). three.js is MIT, vendored under `vendor/`.

This game is an original work. It contains **zero** assets, names, or map code from any
other title — all art, all names, all code are new.
