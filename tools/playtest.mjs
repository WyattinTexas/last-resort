#!/usr/bin/env node
// SURVIVAL QUEST — the playtest battery (P0 goal, link 3): THREE complete 10-tide
// runs in a real browser, one per body, ghost-raced back to back, plus a perf
// probe at the 40-creep cap. Prints the pacing table a human tuner needs.
//
//   node tools/playtest.mjs [url]
//
// House law: --mute-audio; kills its browser on the way out.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ARG = process.argv.slice(2).find(a => !a.startsWith('-')) || 'http://127.0.0.1:8791/';
const PORT = 9231;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'survivalquest-pt-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--window-size=1440,860', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no debuggable page');
}
function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => res({ send });
    ws.onerror = () => rej(new Error('ws error'));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rj(new Error(JSON.stringify(m.error))) : p.rs(m.result); }
    };
    function send(method, params) {
      const mid = ++id;
      return new Promise((rs, rj) => {
        pending.set(mid, { rs, rj });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rj(new Error(method + ' timeout')); } }, 120000);
      });
    }
  });
}

const mmss = t => Math.floor(t / 20 / 60) + ':' + String(Math.floor(t / 20) % 60).padStart(2, '0');

const main = async () => {
  console.log(`\nSURVIVAL QUEST — playtest battery\n  url ${URL_ARG}\n`);
  const cdp = await connect(await findTarget());
  const evalJs = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: URL_ARG });
  for (let i = 0; i < 90; i++) { await sleep(500); try { if (await evalJs('!!(window.RESORT && window.RESORT.ready)')) break; } catch {} }
  console.log('  build ' + await evalJs('RESORT.version + " · " + RESORT.build'));
  const botSrc = readFileSync(join(ROOT, 'tools', 'bot.mjs'), 'utf8').replace(/^export /gm, '');
  await evalJs(botSrc + '; window.__makeShopper = makeShopper; RESORT.ghost.wipe(); RESORT.pause(true); 1');

  const RUNS = [
    { body: 'wrestler', seed: 'pt-alpha' },
    { body: 'diver', seed: 'pt-bravo' },
    { body: 'magician', seed: 'pt-charlie' },
  ];
  const results = [];
  let fails = 0;

  for (const run of RUNS) {
    const r = await evalJs(`(()=>{
      RESORT.setSeed('${run.seed}');
      RESORT.pickBody('${run.body}');
      RESORT.buySpell('fireball');
      const sim = RESORT.sim, S = RESORT.state;
      const bot = window.__makeShopper(sim, {kite:true});
      const deathsAt = [];
      let lastDeaths = 0, t = 0;
      const MAX = 20*60*40;
      while (S.phase !== 'VICTORY' && t < MAX) {
        bot.step(); sim.tick(); t++;
        if (S.deaths !== lastDeaths) { deathsAt.push(S.tide + 1); lastDeaths = S.deaths; }
      }
      return {phase:S.phase, cleared:S.cleared, deaths:S.deaths, deathsAt,
        level:S.level, kills:S.kills, gold:S.gold, worth:S.gold + S.ledger.spent,
        spells:Object.keys(S.spells).map(id=>id+':'+S.spells[id].rank),
        fruit:S.fruit, items:S.items.map(i=>i.id),
        tideLog:JSON.parse(JSON.stringify(S.tideLog)), ticks:S.tick,
        leader:RESORT.ghost.leader};
    })()`);
    await sleep(450);   // drain the victory event so the record folds
    const lead = await evalJs('RESORT.ghost.leader');
    results.push({ ...run, ...r, leader: lead });
    const okRun = r.phase === 'VICTORY' && r.cleared === 10;
    if (!okRun) fails++;
    console.log(`\nRUN ${results.length} — ${run.body.toUpperCase()} on '${run.seed}'  ${okRun ? 'VICTORY' : 'STALLED@' + r.cleared}`);
    console.log(`  time ${mmss(r.ticks)} · deaths ${r.deaths}${r.deathsAt.length ? ' (at tide ' + r.deathsAt.join(',') + ')' : ''} · LV ${r.level} · ${r.kills} kills · worth ${r.worth}`);
    console.log(`  build ${r.spells.join(' ')} · items ${r.items.join(',')}`);
    console.log(`  fruit M${r.fruit.mango}/S${r.fruit.starfruit}/C${r.fruit.coconut} · ghost race leader: ${lead || '(first run)'}`);
    let line = '  splits ';
    let prev = 0;
    for (let tide = 1; tide <= 10; tide++) {
      const e = r.tideLog[tide];
      if (!e) { line += ` t${tide}:—`; continue; }
      line += ` t${tide}:${Math.round((e.tick - prev) / 20)}s`;
      prev = e.tick;
    }
    console.log(line);
  }

  // --- perf probe at the cap: 40 creeps live on the wall clock ---
  console.log('\nPERF — 40 creeps at the cove cap, live clock');
  await evalJs(`(()=>{
    RESORT.setSeed('perf');
    RESORT.pickBody('wrestler');
    RESORT.state.hero.hp = 999999; RESORT.state.hero.maxHp = 999999;  // scenery survives the probe
    RESORT.skipTide(); RESORT.runTicks(30);
    RESORT.spawn(40);
    RESORT.resume();
    return RESORT.state.creeps.length;
  })()`);
  await sleep(800);   // let the loop settle
  const f0 = await evalJs('RESORT.frames');
  await sleep(5000);
  const f1 = await evalJs('RESORT.frames');
  const info = await evalJs('({calls:RESORT.renderInfo.calls, tris:RESORT.renderInfo.triangles})');
  const alive = await evalJs('RESORT.state.creeps.length');
  const fps = (f1 - f0) / 5;
  console.log(`  ${fps.toFixed(1)} fps over 5s with ${alive} creeps (SwiftShader software GL — real GPUs run far hotter)`);
  console.log(`  ${info.calls} draw calls · ${info.tris} triangles`);
  if (info.calls > 220) { console.log('  FAIL: draw calls blew the instancing budget'); fails++; }
  // instancing proof: emptying the cove must barely move the call count
  await evalJs('(RESORT.pause(true), RESORT.state.creeps.forEach(c=>{c.dead=true;c.receded=true;}), RESORT.runTicks(2), RESORT.resume(), 1)');
  await sleep(700);
  const info0 = await evalJs('RESORT.renderInfo.calls');
  console.log(`  ${info0} draw calls with the cove empty (delta ${info.calls - info0} for 40 creeps = instanced)`);
  if (info.calls - info0 > 12) { console.log('  FAIL: creeps are not riding the instanced batches'); fails++; }

  const clearedRuns = results.filter(r => r.phase === 'VICTORY' && r.cleared === 10).length;
  console.log(`\n${fails ? 'PLAYTEST FAILED' : 'PLAYTEST OK'} — ${clearedRuns}/${RUNS.length} runs cleared · ${fps.toFixed(0)}fps(sw) · ${info.calls} calls\n`);
  return fails;
};

main().then(f => { cleanup(); process.exit(f ? 1 : 0); })
  .catch(e => { console.error('\nPLAYTEST ERROR:', e.message, '\n'); cleanup(); process.exit(2); });
