# LAST RESORT

Eight castaways wash up on a low-poly tropical island. Each claims a cove. The sea
sends worse things ashore every tide. Build a hero out of whatever the boardwalk is
selling and out-survive everyone else.

A zero-install browser game — one page, three.js, **no build step, no backend**.

**Play:** https://wyattintexas.github.io/last-resort/

---

## Status — P0, link 1 of 3

This repo is the **foundation link**: the cove, the deterministic sim, the click-move
hero and the tide spawner. It is a playable graybox, not the game.

| | |
|---|---|
| ✅ shipped | island cove scene, 20Hz deterministic sim, click-to-move hero with auto-attack, tide/surf-set spawner, shop-break loop, gold + pearls, `RESORT.*` debug API, headless CDP smoke test, i18n rails, `?v=` cache-bust |
| 🔜 link 2 | 3 bodies, 16 spells on boardwalk racks, fruit stand, Surf Shack items, tides 1–10 + boss |
| 🔜 link 3 | ghost standings, UI pass, playtest, fun-gate report |

### Controls
- **Click** (either button) anywhere on the sand to move. Hold and drag to keep repathing.
- The hero auto-attacks whatever is nearest once it stops.
- **Space / Enter** — call the next tide in early.
- **Q W E R** — spell slots. Boarded up until link 2.

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
js/sim.js             THE SIM — pure, deterministic, testable in node
js/scene.js           the cove: geometry, palette, camera, draw
js/game.js            fixed-step loop, input, HUD, window.RESORT
tools/cdp_smoke.mjs   headless boot + sim smoke test over CDP
bump.sh               stamp a new ?v= before every push
```

## Running it

```bash
python3 -m http.server 8791     # no build step; it is just files
open http://127.0.0.1:8791/

node tools/cdp_smoke.mjs http://127.0.0.1:8791/      # 25 checks + a screenshot
```

The smoke test boots the page in real headless Chrome with real WebGL, pauses the wall
clock, runs two whole tides **through sim ticks**, and asserts the same seed reproduces
exactly. Compile-success and byte-checksums are necessary but not sufficient — only
running it catches a boot crash.

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

Numbers come from `js/sim.js` `TUNE` — one object, so a balance pass is one diff. The
tide curve (quota `12 + 2×tide`, the HP brackets, bounty `4 + tide`) is spec §6. The
hero is not spec'd at P0, so it was tuned against a headless probe over 8 seeds:

| policy | reaches |
|---|---|
| stands perfectly still | tide 3 |
| kites the pack | tide 5 |

Moving is worth **+2 tides** over standing — which is the point, since click-move is
the game. The hero is naked here: no spells, no items, no fruit. Link 2's purchases are
what carry a run to 10.

## Licence & IP

Code MIT (`LICENSE`). three.js is MIT, vendored under `vendor/`.

This game is an original work. It contains **zero** assets, names, or map code from any
other title — all art, all names, all code are new.
