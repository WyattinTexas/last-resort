#!/usr/bin/env node
// LAST RESORT — the postcard rack. Drives a real headless Chrome through the
// game's moments and photographs each one: title, combat, boss, standings,
// washout vista, victory. Point it at the LIVE url for the shipping set.
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
const profile = mkdtempSync(join(tmpdir(), 'lastresort-shots-'));

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
  console.log(`\nLAST RESORT — postcard rack\n  url ${URL_ARG}\n  dir ${DIR}\n`);
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

  console.log('\ndone\n');
};

main().then(() => { cleanup(); process.exit(0); })
  .catch(e => { console.error('\nSHOTS ERROR:', e.message, '\n'); cleanup(); process.exit(2); });
