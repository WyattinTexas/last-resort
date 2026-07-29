#!/usr/bin/env node
// SURVIVAL QUEST — the postcard rack. Drives a real headless Chrome through the
// game's moments and photographs each one: title, combat, boss, standings,
// washout vista, victory, the WS1 combat-feel five, and the two WS2 phone
// frames (844×390, touch). Point it at the LIVE url for the shipping set.
//
//   node tools/uishots.mjs [url] [--dir shots]
//
// House law: --mute-audio always; kills its browser on the way out.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const URL_ARG = args.find(a => !a.startsWith('-')) || 'http://127.0.0.1:8791/';
const DIR = (args.includes('--dir') && args[args.indexOf('--dir') + 1])
  ? resolve(args[args.indexOf('--dir') + 1]) : join(ROOT, 'shots');
const PORT = 9229;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'survivalquest-shots-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--window-size=1440,860', '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      const page = (await r.json()).find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome never opened a debuggable page');
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => res({ send });
    ws.onerror = e => rej(new Error('ws error'));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { rs, rj } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rj(new Error(JSON.stringify(m.error))) : rs(m.result);
      }
    };
    function send(method, params) {
      const mid = ++id;
      return new Promise((rs, rj) => {
        pending.set(mid, { rs, rj });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rj(new Error(method + ' timed out')); } }, 90000);
      });
    }
  });
}

const main = async () => {
  console.log(`\nSURVIVAL QUEST — postcard rack\n  url ${URL_ARG}\n  dir ${DIR}\n`);
  mkdirSync(DIR, { recursive: true });
  const cdp = await connect(await findTarget());
  const evalJs = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const snap = async name => {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(DIR, name), Buffer.from(shot.data, 'base64'));
    console.log('  📸 ' + name);
  };

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: URL_ARG });
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try { if (await evalJs('!!(window.RESORT && window.RESORT.ready)')) break; } catch {}
  }
  if (!await evalJs('!!(window.RESORT && window.RESORT.ready)')) throw new Error('never booted');
  console.log('  build ' + await evalJs('RESORT.version + " · " + RESORT.build'));

  const botSrc = readFileSync(join(ROOT, 'tools', 'bot.mjs'), 'utf8').replace(/^export /gm, '');
  await evalJs(botSrc + '; window.__makeShopper = makeShopper; 1');

  // 1. THE TITLE — wordmark over the vista, camera settled
  await sleep(2600);
  await snap('title.png');

  // 2. VICTORY (and the ghost record): full bot run on a paused clock
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.setSeed('postcard-run');
    RESORT.pickBody('diver');
    RESORT.buySpell('fireball');
    const sim = RESORT.sim, S = RESORT.state;
    const bot = window.__makeShopper(sim, {kite:true});
    let t = 0;
    while (S.phase !== 'VICTORY' && t < 20*60*35) { bot.step(); sim.tick(); t++; }
    return S.phase;
  })()`);
  await evalJs('RESORT.resume()');
  await sleep(1800);
  await snap('victory.png');

  // 3. STANDINGS AT THE BREAK — a new run racing the ghost, boardwalk open
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.setSeed('postcard-race');
    RESORT.pickBody('wrestler');
    RESORT.buySpell('spinslash');
    const sim = RESORT.sim, S = RESORT.state;
    const bot = window.__makeShopper(sim, {kite:true});
    let t = 0;
    while (S.cleared < 2 && t < 20*60*6) { bot.step(); sim.tick(); t++; }
    return S.cleared;
  })()`);
  await evalJs('RESORT.resume()');
  await sleep(1200);
  await snap('standings.png');

  // 3.5 THE MARKET (rev 1) — ported in on the break, standing at a rack with
  // the sheet open. The auto-hold keeps the tide waiting for the photo.
  await evalJs('RESORT.state.hero.x = -6.5; RESORT.state.hero.z = 6; 1');
  await sleep(1800);
  await snap('market.png');
  await evalJs('RESORT.state.hero.x = 0; RESORT.state.hero.z = -14; 1');
  await sleep(600);

  // 4. MID-TIDE COMBAT — tide 3, spells flying
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.skipTide();
    RESORT.runTicks(170);
    return RESORT.state.tide;
  })()`);
  await evalJs('RESORT.resume()');
  await sleep(1400);
  await evalJs('(()=>{const c=RESORT.state.creeps.find(c=>!c.dead); if(c){RESORT.cast("Q",c.x,c.z);RESORT.cast("W",c.x,c.z);} return 1;})()');
  await sleep(350);
  await snap('combat.png');

  // 5. THE BOSS UNDER GOLD HOUR — tide 5, KING SANDCLAW
  await evalJs(`(()=>{
    RESORT.pause(true);
    const S = RESORT.state;
    S.tide = 4; S.cleared = 4; S.phase = 'BREAK'; S.phaseTicks = 20;
    RESORT.runTicks(150);
    return S.tide;
  })()`);
  await evalJs('RESORT.resume()');
  await sleep(2200);
  await snap('boss.png');

  // 6. THE WASHOUT VISTA — death pulls to the postcard, countdown running
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.state.hero.hp = 1;
    let t = 0;
    while (RESORT.state.phase !== 'WASHOUT' && t < 20*90) { RESORT.runTicks(1); t++; }
    RESORT.runTicks(30);
    return RESORT.state.phase;
  })()`);
  await evalJs('RESORT.resume()');
  await sleep(2600);
  await snap('washout.png');

  // 7. WS1 COMBAT FEEL — the frames that prove the swing cycle shipped:
  // a held windup, an impact with sparks + a corpse mid-sink, the stun
  // stars, and a basic missile lobbed mid-flight.
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.setSeed('feel-windup');
    RESORT.pickBody('wrestler');
    RESORT.buySpell('fireball');   // WS2: unowned slots don't render — the stun
                                   // frame needs a bar on screen to gray out
    RESORT.skipTide();
    RESORT.runTicks(2);
    const S = RESORT.state;
    RESORT.spawn(6, 'crab');
    let k = 0;
    for (const c of S.creeps) {
      c.x = S.hero.x - 2.6 + (k % 3) * 2.6; c.z = S.hero.z - 2.3 - Math.floor(k / 3) * 1.2;
      c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 90000; k++;
    }
    let g = 0;
    while (g++ < 300 && !(S.hero.atkCd === 1 && S.hero.atkAnim === 0)) RESORT.runTicks(1);
    return { cd: S.hero.atkCd, anim: S.hero.atkAnim };
  })()`);
  await sleep(900);
  await snap('feel-windup.png');

  // FREEZE the presentation clock FIRST, then drive a real kill through
  // runTicks: the sparks and the fresh corpse are born under dt=0 and hold
  // at full brightness for the camera. (Live timing loses: one SwiftShader
  // frame can swallow a whole spark lifetime.)
  await evalJs(`(async()=>{
    const S = RESORT.state;
    S.hero.swingN = 5;                             // the 6th swing crits: gold burst
    for (const c of S.creeps) c.hp = 1;
    RESORT.fx.freeze(20000);
    const k0 = S.kills;
    let g = 0;
    while (S.kills === k0 && g++ < 80) RESORT.runTicks(1);
    for (let i = 0; i < 30; i++) {                 // the kill drains on a rAF
      if (RESORT.fx.sparks > 0) break;
      await new Promise(r => setTimeout(r, 40));
    }
    // The kill's own burst is born exactly under the damage float's text and
    // SwiftShader frame pacing eats any live spray window before the camera
    // fires — so stage the same production burst, same popSparks, same power,
    // at the impact's flanks where a 60fps player sees it mid-flight.
    const hx = S.hero.x, hz = S.hero.z;
    RESORT.sceneApi.popSparks(hx - 1.7, 1.25, hz - 0.9, 0xFFD24A, 6, 1.6);
    RESORT.sceneApi.popSparks(hx + 1.7, 1.2, hz - 1.2, 0xFFE9B0, 5, 1.15);
    return RESORT.fx.sparks; })()`);
  await snap('feel-impact.png');
  // let the corpse age into its sink, then hold it for its own frame
  await evalJs(`(async()=>{
    RESORT.fx.freeze(0);
    await new Promise(r => setTimeout(r, 420));
    RESORT.fx.freeze(4000);
    return true; })()`);
  await snap('feel-corpse.png');
  await evalJs('(RESORT.fx.freeze(0), RESORT.pause(true), 1)');

  await evalJs('(()=>{ RESORT.pause(true); RESORT.state.hero.stun = 60; return 1; })()');
  await sleep(600);
  await snap('feel-stun.png');

  await evalJs(`(()=>{
    RESORT.state.hero.stun = 0;
    RESORT.setSeed('feel-missile');
    RESORT.pickBody('magician');
    RESORT.skipTide();
    RESORT.runTicks(2);
    const S = RESORT.state;
    RESORT.spawn(3, 'crab');
    for (let i = 0; i < S.creeps.length; i++) {
      const c = S.creeps[i];
      c.x = S.hero.x - 1.5 + i * 1.5; c.z = S.hero.z - 5.2 - i * 0.6;
      c.px = c.x; c.pz = c.z;
    }
    let g = 0;
    while (g++ < 60) {
      RESORT.runTicks(1);
      const m = S.projs.find(p => p.kind === 'basic');
      if (m && m.traveled > 1.5 && m.traveled < m.maxDist * 0.75) break;
    }
    return S.projs.length;
  })()`);
  await sleep(800);
  await snap('feel-missile.png');

  // 7.5 WS3 ABILITIES — the pool's proof frames: a pack stunned pale-yellow
  // under a SANDSPOUT (the new stun grammar), THE DROWNED TIDE mid-raise,
  // and a scrolled 11-row rack (the "racks stay browsable" receipt).
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.setSeed('ws3-stun-shot');
    RESORT.pickBody('wrestler');
    RESORT.givePearls(10);
    RESORT.buySpell('conchcrack');
    RESORT.buySpell('sandspout');
    RESORT.skipTide();
    RESORT.runTicks(2);
    const S = RESORT.state;
    S.quota = 9999; S.spawned = 9999;
    RESORT.spawn(7, 'crab');
    let k = 0;
    for (const c of S.creeps) {
      c.x = S.hero.x - 2.2 + (k % 4) * 1.5; c.z = S.hero.z - 2.0 - Math.floor(k / 4) * 1.4;
      c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 90000; k++;
    }
    const slot = ['Q','W','E'].find(x => S.slots[x] === 'sandspout');
    RESORT.cast(slot, S.hero.x, S.hero.z);
    RESORT.runTicks(4);   // hitFlash (3 ticks) expires -> the PALE-YELLOW stun tint owns the pack
    return S.creeps.filter(c => c.stunTicks > 0).length;
  })()`);
  // wait for the event drain to land (rings + entrance records born) — a
  // stalled SwiftShader rAF can push it past any fixed sleep
  await evalJs(`(async()=>{
    for (let i = 0; i < 60 && RESORT.fx.entrances === 0; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.fx.entrances; })()`);
  await sleep(220);        // the yellow stun ring expands into frame...
  // WS4: drop the entrance records — the teleported pack must stand stunned
  // at the hero, not mid-burrow back at its spawn fence — then hold the clock
  // and PROVE a frame rendered the recomposed pack before shooting.
  await evalJs(`(async()=>{
    RESORT.sceneApi.clearFx();
    const f0 = RESORT.frames;
    RESORT.fx.freeze(20000);
    for (let i = 0; i < 80 && RESORT.frames <= f0 + 1; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.frames - f0; })()`);
  await snap('ws3-stun.png');
  await evalJs('(RESORT.fx.freeze(0), 1)');

  await evalJs(`(()=>{
    const S = RESORT.state;
    RESORT.setSeed('ws3-drowned-shot');
    RESORT.pickBody('wrestler');
    RESORT.givePearls(20);
    const S2 = RESORT.state;
    S2.tide = 7; S2.cleared = 7; S2.phase = 'BREAK'; S2.phaseTicks = 30;
    RESORT.buySpell('drownedtide');
    let g = 0;
    while (S2.phase !== 'TIDE' && g++ < 200) RESORT.runTicks(1);
    RESORT.runTicks(1);
    S2.quota = 9999; S2.spawned = 9999;
    RESORT.spawn(4, 'crab');
    for (const c of S2.creeps) if (!c.dead) {
      c.x = S2.hero.x + 1.2; c.z = S2.hero.z - 1.2; c.px = c.x; c.pz = c.z; c.hp = 1;
    }
    g = 0;
    while (S2.corpses.length < 3 && g++ < 120) RESORT.runTicks(1);
    RESORT.cast('R', S2.hero.x, S2.hero.z);
    RESORT.runTicks(2);
    return S2.allies.filter(a => a.kind === 'drowned').length;
  })()`);
  await sleep(900);
  await snap('ws3-drowned.png');

  await evalJs(`(()=>{
    RESORT.setSeed('ws3-rack-shot');
    RESORT.pickBody('diver');
    RESORT.givePearls(9);
    RESORT.buySpell('lifebloom');
    RESORT.buySpell('rootvine');
    RESORT.state.hero.x = -6.5; RESORT.state.hero.z = 6; 1;   // the GUARD rack counter
    return RESORT.state.phase;
  })()`);
  await evalJs(`(async()=>{
    for (let i = 0; i < 40; i++) {
      if (document.getElementById('sheet').classList.contains('show')
        && document.querySelectorAll('#sheet-rows .srow').length >= 11) break;
      await new Promise(r => setTimeout(r, 100));
    }
    document.getElementById('sheet-rows').scrollTop = 170;   // mid-rack: the wall of spells
    return document.querySelectorAll('#sheet-rows .srow').length; })()`);
  await sleep(600);
  await snap('ws3-rack.png');
  await evalJs('RESORT.state.hero.x = 0; RESORT.state.hero.z = -14; 1');
  await sleep(500);

  // 7.75 WS4 ENEMY THEATRICS — the frames that prove arrivals and deaths
  // PERFORM: an east-fence set mid-arrival (monkey mid-vault, crab half-
  // emerged), THE UNDERTOW rising inside its foam wall, and the graveyard —
  // a wiped pack as a husk field with the drowned already rising from it.
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.setSeed('ws4-entrance-shot');
    RESORT.pickBody('wrestler');
    RESORT.skipTide();
    RESORT.runTicks(3);
    const S = RESORT.state;
    S.quota = 9999; S.spawned = 9999;      // the lab owns the sand
    // stand the hero toward the east fence so the camera frames the arrival
    S.hero.x = 16; S.hero.z = 2; S.hero.px = 16; S.hero.pz = 2;
    S.hero.tx = 16; S.hero.tz = 2;
    return S.creeps.length;
  })()`);
  await sleep(900);        // the camera eases over to the fence side
  await evalJs(`(()=>{
    const S = RESORT.state;
    S.setEdge = 1;                          // the set breaks over the EAST fence
    RESORT.spawn(3, 'monkey');
    RESORT.spawn(3, 'crab');
    return S.creeps.length;
  })()`);
  // poll the drain in (records born), let the beats reach mid-arc, freeze,
  // then prove a frozen frame actually rendered before shooting
  await evalJs(`(async()=>{
    for (let i = 0; i < 60 && RESORT.fx.entrances === 0; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.fx.entrances; })()`);
  await sleep(300);        // arrivals reach mid-beat...
  await evalJs(`(async()=>{
    const f0 = RESORT.frames;
    RESORT.fx.freeze(20000);
    for (let i = 0; i < 80 && RESORT.frames <= f0 + 1; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.frames - f0; })()`);
  await snap('ws4-entrance.png');
  await evalJs('(RESORT.fx.freeze(0), 1)');
  await sleep(1600);       // the birth rings die before the next scene's camera

  await evalJs(`(()=>{
    RESORT.setSeed('ws4-w8');              // this seed rolls the SEA fence —
    RESORT.pickBody('wrestler');           // the wave breaks over the waterline
    const S = RESORT.state;
    S.tide = 9; S.cleared = 9; S.phase = 'BREAK'; S.phaseTicks = 20;
    let g = 0;
    while (S.phase !== 'TIDE' && g++ < 60) RESORT.runTicks(1);
    return S.creeps.filter(c => c.big).length;
  })()`);
  // SwiftShader frame pacing eats wall time (WS1 gotcha), so a fixed sleep
  // can catch the sweep barely begun — POLL the wall's own opacity until the
  // crest is mid-frame, then freeze.
  await evalJs(`(async()=>{
    let w = null;
    RESORT.sceneApi.scene.traverse(o => { if (o.geometry && o.geometry.parameters && o.geometry.parameters.width === 26) w = o; });
    for (let i = 0; i < 140; i++) {
      // z runs -29 -> -21 as the sweep lands; freeze past the halfway crest
      if (w && w.visible && w.position.z > -24.6) break;
      await new Promise(r => setTimeout(r, 60));
    }
    const f0 = RESORT.frames;
    RESORT.fx.freeze(20000);
    for (let i = 0; i < 80 && RESORT.frames <= f0 + 1; i++) await new Promise(r => setTimeout(r, 60));
    return w && +w.position.z.toFixed(1); })()`);
  await snap('ws4-boss-wave.png');
  await evalJs('(RESORT.fx.freeze(0), 1)');

  await evalJs(`(()=>{
    RESORT.setSeed('ws4-graveyard-shot');
    RESORT.pickBody('wrestler');
    RESORT.givePearls(60); RESORT.giveGold(9000);
    const S = RESORT.state;
    S.tide = 7; S.cleared = 7; S.phase = 'BREAK'; S.phaseTicks = 30;
    RESORT.buySpell('drownedtide');
    let g = 0;
    while (S.phase !== 'TIDE' && g++ < 200) RESORT.runTicks(1);
    RESORT.runTicks(1);
    S.quota = 9999; S.spawned = 9999;
    for (const c of S.creeps) { c.dead = true; c.receded = true; }
    RESORT.runTicks(1);
    RESORT.spawn(4, 'crab'); RESORT.spawn(4, 'jelly'); RESORT.spawn(4, 'monkey');
    let k = 0;
    for (const c of S.creeps) if (!c.dead) {
      c.x = S.hero.x - 5.4 + (k % 4) * 3.4; c.z = S.hero.z - 2.2 - Math.floor(k / 4) * 2.6;
      c.px = c.x; c.pz = c.z; k++;
    }
    for (const c of S.creeps) if (!c.dead) c.dead = true;
    RESORT.runTicks(1);
    return S.corpses.length;   // 12 records; the raise will eat the 3 freshest
  })()`);
  await sleep(1000);       // the spectacles play out: the husk field settles
  await evalJs(`(()=>{
    const S = RESORT.state;
    RESORT.cast('R', S.hero.x, S.hero.z);   // THE DROWNED TIDE eats the freshest
    RESORT.runTicks(2);
    return S.allies.filter(a => a.kind === 'drowned').length;
  })()`);
  await sleep(200);        // the drowned are mid-rise out of the sand...
  await evalJs(`(async()=>{
    const f0 = RESORT.frames;
    RESORT.fx.freeze(20000);
    for (let i = 0; i < 80 && RESORT.frames <= f0 + 1; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.frames - f0; })()`);
  await snap('ws4-graveyard.png');
  await evalJs('(RESORT.fx.freeze(0), 1)');

  // 7.9 WS5 ITEMS — the PIRATE TRADER open on a t7 break (unlocked rows
  // stating their numbers, charges chips in the bag), then the POWDER KEG
  // mid-pop in a t7 lab. Every freeze rides the frames-advance poll (WS4 law).
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.setSeed('ws5-trader-shot');
    RESORT.pickBody('wrestler');
    RESORT.giveGold(3200);
    const S = RESORT.state;
    S.tide = 6; S.cleared = 6; S.phase = 'BREAK'; S.phaseTicks = 600;
    RESORT.runTicks(1);
    RESORT.buyItem('ghostconch');       // ×2 chip — WS2: chrome exists because items do
    RESORT.buyItem('powderkeg');        // ×3 chip
    S.hero.x = 0; S.hero.z = 9.5; S.hero.px = 0; S.hero.pz = 9.5;
    S.hero.tx = 0; S.hero.tz = 9.5;     // at the trader counter, back-centre
    return S.items.length;
  })()`);
  await evalJs('RESORT.resume()');
  await evalJs(`(async()=>{
    for (let i = 0; i < 50; i++) {
      if (document.getElementById('sheet').classList.contains('show')
        && document.querySelectorAll('#sheet-rows .srow').length === 8
        && document.querySelectorAll('#items .itemchip.active').length === 2) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const f0 = RESORT.frames;
    for (let i = 0; i < 80 && RESORT.frames <= f0 + 1; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.frames - f0; })()`);
  await sleep(4200);       // the sheet settles AND the 4s forge announce expires
  await snap('ws5-trader.png');
  await evalJs('(RESORT.pause(true), RESORT.state.hero.x = 0, RESORT.state.hero.z = -14, RESORT.state.hero.px = 0, RESORT.state.hero.pz = -14, 1)');

  await evalJs(`(()=>{
    RESORT.setSeed('ws5-keg-shot');
    RESORT.pickBody('wrestler');
    RESORT.giveGold(1200);
    const S = RESORT.state;
    S.tide = 6; S.cleared = 6; S.phase = 'BREAK'; S.phaseTicks = 30;
    RESORT.buyItem('powderkeg');
    let g = 0;
    while (S.phase !== 'TIDE' && g++ < 200) RESORT.runTicks(1);
    RESORT.runTicks(1);
    S.quota = 9999; S.spawned = 9999;     // the lab owns the sand (t7: clean tide)
    for (const c of S.creeps) { c.dead = true; c.receded = true; }
    RESORT.runTicks(1);
    RESORT.spawn(7, 'crab');
    let k = 0;
    for (const c of S.creeps) if (!c.dead) {
      c.x = S.hero.x - 2.4 + (k % 4) * 1.6; c.z = S.hero.z - 1.6 - Math.floor(k / 4) * 1.4;
      c.px = c.x; c.pz = c.z; k++;
    }
    return S.creeps.filter(c => !c.dead).length;
  })()`);
  // the market->square port glide rides dt: let the CAMERA LAND first (a
  // freeze mid-glide shot one frame of empty sand — relearned in pixels),
  // and the teleported pack's stale entrance curves drop with it
  await sleep(1500);
  await evalJs('(RESORT.sceneApi.clearFx(), 1)');
  await evalJs(`(()=>{
    const u = RESORT.useItem(0);          // LIGHT IT — 220 to the whole ring
    RESORT.runTicks(4);                   // hitFlash (3t) passes; floats stay up
    return u.ok;
  })()`);
  await sleep(220);        // the gold ring expands into frame...
  await evalJs(`(async()=>{
    const f0 = RESORT.frames;
    RESORT.fx.freeze(20000);
    for (let i = 0; i < 80 && RESORT.frames <= f0 + 1; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.frames - f0; })()`);
  await snap('ws5-keg.png');
  await evalJs('(RESORT.fx.freeze(0), 1)');

  // 7.10 WS6 HEROES — the eight-card FORGE rack (the roster on one poster),
  // then the COCONUT SLINGER mid-lob in a t2 square: the missile frozen
  // mid-flight at LONG TOSS range. The forge frame is pre-announce for THIS
  // seed, but the PREVIOUS scene's tide announce is still fading — outwait
  // it (WS5 gotcha 5: a forge poster must not caption itself TIDE 7), then
  // frames-poll after setSeed per the WS4 shot law.
  await evalJs('(RESORT.pause(true), RESORT.setSeed("ws6-forge-shot"), 1)');
  await sleep(4200);
  await evalJs(`(async()=>{
    for (let i = 0; i < 50 && !document.getElementById('forge').classList.contains('show'); i++)
      await new Promise(r => setTimeout(r, 100));
    const f0 = RESORT.frames;
    for (let i = 0; i < 80 && RESORT.frames <= f0 + 1; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.frames - f0; })()`);
  await snap('ws6-forge.png');

  await evalJs(`(()=>{
    RESORT.setSeed('ws6-slinger-shot');
    RESORT.pickBody('slinger');
    const S = RESORT.state;
    S.tide = 1; S.cleared = 1; S.phase = 'BREAK'; S.phaseTicks = 30;   // tide-jump: t2 starts legitimately
    let g = 0;
    while (S.phase !== 'TIDE' && g++ < 200) RESORT.runTicks(1);
    RESORT.runTicks(1);
    S.quota = 9999; S.spawned = 9999;      // the lab owns the sand
    for (const c of S.creeps) { c.dead = true; c.receded = true; }
    RESORT.runTicks(1);
    return S.tide;
  })()`);
  // the market->square port glide rides dt (WS5 gotcha 3) AND the 4s forge
  // announce must expire before any captioned frame (WS5 gotcha 5)
  await sleep(4500);
  await evalJs(`(()=>{
    const S = RESORT.state;
    RESORT.spawn(3, 'crab');
    let i = 0;
    for (const c of S.creeps) if (!c.dead) {
      // ~6.5m out: past LONG TOSS's 4.5m line, inside the 7m acquire
      c.x = S.hero.x - 1.6 + i * 1.6; c.z = S.hero.z - 6.2 - (i % 2) * 0.6;
      c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 90000; i++;
    }
    return S.creeps.filter(c => !c.dead).length;
  })()`);
  // let the entrance records drain, then drop them — the staged pack must
  // STAND at 6.5m, not burrow at its spawn fence (the ws3-stun lesson)
  await evalJs(`(async()=>{
    for (let i = 0; i < 60 && RESORT.fx.entrances === 0; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.fx.entrances; })()`);
  await evalJs('(RESORT.sceneApi.clearFx(), 1)');
  await evalJs(`(()=>{
    const S = RESORT.state;
    let g = 0;
    while (g++ < 80) {
      RESORT.runTicks(1);
      const m = S.projs.find(p => p.kind === 'basic');
      if (m && m.traveled > 2.0 && m.traveled < m.maxDist * 0.7) break;
    }
    return S.projs.length;
  })()`);
  await evalJs(`(async()=>{
    const f0 = RESORT.frames;
    RESORT.fx.freeze(20000);
    for (let i = 0; i < 80 && RESORT.frames <= f0 + 1; i++) await new Promise(r => setTimeout(r, 60));
    return RESORT.frames - f0; })()`);
  await snap('ws6-slinger.png');
  await evalJs('(RESORT.fx.freeze(0), 1)');

  // 8. WS2 MOBILE — the phone frames at 844×390 under real touch emulation:
  // a built hero mid-tide with ZERO floating buttons (the workstream's
  // poster) and the compact market break. IS_TOUCH sniffs at boot, so the
  // page re-navigates under the emulation and drives a fresh run.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Page.navigate', { url: URL_ARG });
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try { if (await evalJs('!!(window.RESORT && window.RESORT.ready)')) break; } catch {}
  }
  await evalJs(`(()=>{
    RESORT.pause(true);
    RESORT.setSeed('mobile-postcard');
    RESORT.pickBody('wrestler');
    RESORT.givePearls(10); RESORT.giveGold(600);
    RESORT.buySpell('fireball'); RESORT.buySpell('spinslash');
    RESORT.buyItem('guava'); RESORT.buyItem('flippers');
    RESORT.skipTide();
    RESORT.runTicks(170);
    return RESORT.state.tide;
  })()`);
  await evalJs('RESORT.resume()');
  await sleep(1400);
  await snap('mobile-tide-clean.png');

  await evalJs(`(()=>{
    RESORT.pause(true);
    const S = RESORT.state;
    let g = 0;
    while (S.phase !== 'BREAK' && g++ < 20*60*3) RESORT.runTicks(1);
    return S.phase;
  })()`);
  await evalJs('RESORT.resume()');
  await sleep(1600);
  await snap('mobile-market.png');

  console.log('\ndone\n');
};

main().then(() => { cleanup(); process.exit(0); })
  .catch(e => { console.error('\nSHOTS ERROR:', e.message, '\n'); cleanup(); process.exit(2); });
