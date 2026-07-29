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
  await sleep(220);        // the yellow stun ring expands into frame...
  await evalJs('(RESORT.fx.freeze(20000), 1)');   // ...then the clock stops for the camera
  await sleep(500);
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
