#!/usr/bin/env node
// LAST RESORT — headless boot + sim smoke test, driven over the Chrome
// DevTools Protocol with node's built-in WebSocket. No puppeteer, no npm.
//
//   node tools/cdp_smoke.mjs [url] [--out shots/smoke.png] [--keep]
//
// What it proves:
//   1. The page boots in a real browser with real WebGL (compile + checksum are
//      necessary but NOT sufficient — only running it catches a boot crash).
//   2. Two whole tides run to completion THROUGH SIM TICKS, with the wall clock
//      paused. Every assertion below counts ticks; none of them counts seconds.
//   3. The same seed produces the same run, byte for byte, twice.
//
// House law: headless Chrome ALWAYS launches with --mute-audio, and this script
// kills its browser on the way out.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const URL_ARG = args.find(a => !a.startsWith('-')) || 'http://127.0.0.1:8791/';
const OUT = (args[args.indexOf('--out') + 1] && args.includes('--out'))
  ? resolve(args[args.indexOf('--out') + 1]) : join(ROOT, 'shots', 'smoke.png');
const KEEP = args.includes('--keep');
const PORT = 9227;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'lastresort-cdp-'));

let failures = 0, checks = 0;
const ok = (cond, msg, extra) => {
  checks++;
  if (cond) console.log(`  PASS  ${msg}${extra ? '  ' + extra : ''}`);
  else { failures++; console.log(`  FAIL  ${msg}${extra ? '  ' + extra : ''}`); }
};

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--mute-audio',                        // HOUSE LAW. Never launch without it.
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--window-size=1440,860',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch {}
  if (!KEEP) { try { rmSync(profile, { recursive: true, force: true }); } catch {} }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
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
    const logs = [], errors = [];
    ws.onopen = () => res({ send, logs, errors, ws });
    ws.onerror = e => rej(new Error('ws error: ' + (e.message || 'unknown')));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { resolve: rs, reject: rj } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rj(new Error(JSON.stringify(m.error))) : rs(m.result);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        logs.push(`[${m.params.type}] ` + m.params.args.map(a =>
          a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        errors.push(d.exception?.description || d.text || 'unknown exception');
      }
      if (m.method === 'Page.javascriptDialogOpening') {
        send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
    };
    function send(method, params) {
      const mid = ++id;
      return new Promise((rs, rj) => {
        pending.set(mid, { resolve: rs, reject: rj });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rj(new Error(method + ' timed out')); } }, 60000);
      });
    }
  });
}

const main = async () => {
  console.log(`\nLAST RESORT — CDP smoke\n  url     ${URL_ARG}\n  profile ${profile}\n`);
  const cdp = await connect(await findTarget());
  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable').catch(() => {});
  await cdp.send('Page.navigate', { url: URL_ARG });

  // --- 1. BOOT ---------------------------------------------------------
  let booted = false;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try { if (await evalJs('!!(window.RESORT && window.RESORT.ready)')) { booted = true; break; } } catch {}
  }
  console.log('BOOT');
  ok(booted, 'window.RESORT is live and the first frame is drawn');
  if (!booted) {
    const detail = await evalJs('document.getElementById("boot-error-detail")?.textContent || ""').catch(() => '');
    console.log('  boot-error detail:', detail || '(none)');
    console.log('  console:', cdp.logs.slice(-10).join('\n            '));
    console.log('  errors :', cdp.errors.slice(-5).join('\n            '));
    throw new Error('page never booted');
  }
  ok(cdp.errors.length === 0, 'no uncaught exceptions during boot',
    cdp.errors.length ? cdp.errors[0].split('\n')[0] : '');
  ok(!(await evalJs('document.getElementById("boot-error").classList.contains("show")')),
    'the boot-error screen is not showing');

  const info = await evalJs('({v:RESORT.version, b:RESORT.build, seed:RESORT.seed, webgl2:!!RESORT.THREE && !!document.getElementById("gl").getContext})');
  ok(info.seed && info.seed.v === 1, 'the seed object carries its version field (v:1)', JSON.stringify(info.seed));
  console.log(`  build   v${info.v} · ${info.b}`);

  // --- 2. TWO TIDES, MEASURED IN TICKS ---------------------------------
  // Freeze the wall clock first. From here on, the ONLY thing that advances
  // the world is an explicit tick count.
  console.log('\nSIM — two tides on a paused wall clock');
  await evalJs('RESORT.pause(true)');
  await evalJs('RESORT.setSeed("smoke")');
  const t0 = await evalJs('RESORT.snapshot()');
  ok(t0.tick === 0, 'a fresh sim starts at tick 0', `tick=${t0.tick}`);

  const idleFrames = await evalJs('(async()=>{const a=RESORT.state.tick; await new Promise(r=>setTimeout(r,1200)); return {a, b:RESORT.state.tick, frames:RESORT.frames};})()');
  ok(idleFrames.a === idleFrames.b,
    'SIM TICKS ARE NOT WALL TIME — 1.2s of real time, 0 ticks while paused',
    `ticks ${idleFrames.a}->${idleFrames.b}, frames still rendering=${idleFrames.frames > 0}`);

  const run = await evalJs('RESORT.runTides(2, 20*60*8)');
  ok(run.ok && run.cleared >= 2, 'two whole tides CLEARED', `cleared=${run.cleared} in ${run.ticks} ticks`);
  const t2 = await evalJs('RESORT.snapshot()');
  ok(t2.tick === t0.tick + run.ticks, 'the tick counter is the only clock in the sim',
    `${t0.tick} + ${run.ticks} = ${t2.tick}`);
  ok(t2.deaths === 0, 'the hero survived both tides standing still', `deaths=${t2.deaths}`);
  ok(t2.kills >= 14 + 16, 'both tide quotas were actually killed',
    `kills=${t2.kills} (tide1 quota 14 + tide2 quota 16)`);
  ok(t2.gold > 100, 'bounty and clear gold landed in the purse', `gold=${t2.gold}`);
  ok(t2.pearls >= 3 + 2, 'a pearl per cleared tide', `pearls=${t2.pearls}`);
  ok(t2.phase === 'BREAK', 'the run parks in the shop break between tides', `phase=${t2.phase}`);

  // --- 3. DETERMINISM ---------------------------------------------------
  // Sampled MID-TIDE, with creeps on the sand: a snapshot of an empty beach
  // would match trivially and prove nothing.
  console.log('\nDETERMINISM — same seed, same ticks, same world');
  const mid = 'RESORT.skipTide(), RESORT.runTicks(320), RESORT.snapshot()';
  const A = await evalJs(`(RESORT.setSeed("besaid"), ${mid})`);
  const B = await evalJs(`(RESORT.setSeed("besaid"), ${mid})`);
  ok(A.alive > 0, 'the determinism sample is taken mid-tide, with creeps alive', `alive=${A.alive}`);
  ok(JSON.stringify(A) === JSON.stringify(B), 'seed "besaid" x 320 ticks reproduces exactly',
    `hpSum=${A.hpSum} posSum=${A.posSum} draws=${A.draws}`);
  const Cs = await evalJs(`(RESORT.setSeed("other-seed"), ${mid})`);
  ok(JSON.stringify(Cs) !== JSON.stringify(A), 'a different seed produces a different run',
    `hpSum=${Cs.hpSum} vs ${A.hpSum}`);

  // --- 4. THE REST OF THE DEBUG SURFACE ---------------------------------
  console.log('\nDEBUG API');
  const spawnRes = await evalJs('(RESORT.setSeed("api"), RESORT.runTicks(2), {ids:RESORT.spawn(5,"crab").length, alive:RESORT.state.creeps.length})');
  ok(spawnRes.ids === 5 && spawnRes.alive === 5, 'RESORT.spawn(5) puts five creeps on the sand', JSON.stringify(spawnRes));
  ok(await evalJs('RESORT.giveGold(250) >= 350'), 'RESORT.giveGold tops up the purse');
  ok(await evalJs('(RESORT.runUntil(s=>s.phase==="BREAK", 20*60).ok && RESORT.skipTide()===true)'), 'RESORT.skipTide calls the tide in early');
  const cap = await evalJs('(RESORT.setSeed("cap"), RESORT.spawn(60), {alive:RESORT.state.creeps.length, queued:RESORT.state.queue})');
  ok(cap.alive <= 40, 'the cove cap holds at 40 concurrent, the rest queue', JSON.stringify(cap));
  const curves = await evalJs('[1,5,6,10,15,20,25,30].map(t=>RESORT.curves.creepHp(t))');
  ok(curves[0] === 100 && curves[1] === 260 && curves[7] === 11000,
    'the creep HP curve hits every printed bracket anchor', curves.join(','));

  // --- 5. LIVE FRAME + SCREENSHOT ---------------------------------------
  console.log('\nRENDER');
  // Arm the i18n audit BEFORE the live frames, so it records the strings the
  // HUD and the announcement ticker actually emit while the game runs.
  await evalJs('RESORT.i18nAudit(true)');
  // Land the shot MID-TIDE with the hero in a fight, not on a break panel.
  await evalJs('(RESORT.setSeed("postcard"), RESORT.runTides(1, 20*60*4), RESORT.skipTide(), RESORT.runTicks(300), RESORT.spawn(9), RESORT.runTicks(60), RESORT.resume())');
  await sleep(2500);
  const framesNow = await evalJs('RESORT.frames');
  await sleep(1500);
  const framesLater = await evalJs('RESORT.frames');
  ok(framesLater > framesNow, 'the render loop is running', `${framesNow} -> ${framesLater} frames`);

  const audit = await evalJs('(RESORT.relocalize(), Object.keys(RESORT.i18nAudit()))');
  ok(audit.length >= 12, 'every live string walks through TXT() (i18n audit is recording)',
    `${audit.length} keys`);
  ok(!audit.some(k => /%\{\d\}/.test(k)),
    'tf() placeholders survive the number-tokeniser intact',
    audit.filter(k => k.includes('%')).slice(0, 1).join('') || '(no %N keys seen)');
  ok(cdp.errors.length === 0, 'still no uncaught exceptions after a full run',
    cdp.errors.length ? cdp.errors[0].split('\n')[0] : '');

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`  shot    ${OUT}`);

  if (cdp.logs.length) console.log('\nconsole:\n  ' + cdp.logs.slice(-12).join('\n  '));
  console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
  return failures;
};

main().then(f => { cleanup(); process.exit(f ? 1 : 0); })
  .catch(e => { console.error('\nSMOKE ERROR:', e.message, '\n'); cleanup(); process.exit(2); });
