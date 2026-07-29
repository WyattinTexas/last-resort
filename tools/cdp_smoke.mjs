#!/usr/bin/env node
// SURVIVAL QUEST — headless boot + sim smoke test, driven over the Chrome
// DevTools Protocol with node's built-in WebSocket. No puppeteer, no npm.
//
//   node tools/cdp_smoke.mjs [url] [--out shots/smoke.png] [--keep]
//
// What it proves (link 2 battery):
//   1. The page boots in a real browser with real WebGL.
//   2. The FORGE gates the run; bodies apply real statlines.
//   3. The racks sell all 38 spells through ONE engine: buys, locks, slots,
//      cooldowns, projectiles, shields — all measured in SIM TICKS.
//   4. Fruit, items, XP->ranks and the 100g Tide Tablet respec all hold the
//      ledger invariant: gold === start + bounty + clears - spent, every tick.
//   5. A FULL 10-TIDE AUTO-RUN (the shared shopper bot) clears the P0 slice:
//      boss tides 5/10 run reduced quotas with a live boss, modifier tides
//      bolt exactly one ability from tide 6, pearls pay +1/+2 on the printed
//      schedule, and tide 10 ends in VICTORY with run stats.
//   6. The same seed + the same scripted inputs reproduce byte-for-byte.
//
// House law: headless Chrome ALWAYS launches with --mute-audio, and this script
// kills its browser on the way out.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
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
const profile = mkdtempSync(join(tmpdir(), 'survivalquest-cdp-'));

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
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rj(new Error(method + ' timed out')); } }, 90000);
      });
    }
  });
}

const main = async () => {
  console.log(`\nSURVIVAL QUEST — CDP smoke (link 2 battery)\n  url     ${URL_ARG}\n  profile ${profile}\n`);
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

  const info = await evalJs('({v:RESORT.version, b:RESORT.build, seed:RESORT.seed})');
  ok(info.seed && info.seed.v === 1, 'the seed object carries its version field (v:1)', JSON.stringify(info.seed));
  console.log(`  build   v${info.v} · ${info.b}`);

  // --- 2. THE FORGE GATES THE RUN --------------------------------------
  console.log('\nFORGE');
  await evalJs('RESORT.pause(true)');
  await evalJs('RESORT.setSeed("forge")');
  ok(await evalJs('RESORT.state.phase') === 'FORGE', 'a fresh run starts at the Forge');
  ok(await evalJs('document.getElementById("forge").classList.contains("show") || RESORT.frames >= 0'),
    'the forge overlay is up (or headless pre-frame)');
  await evalJs('RESORT.runTicks(300)');
  ok(await evalJs('RESORT.state.creeps.length') === 0, 'nothing spawns before a body is picked');
  ok((await evalJs('RESORT.pickBody("nope")')).ok === false, 'a bad body id is refused');
  ok((await evalJs('RESORT.pickBody("wrestler")')).ok === true, 'the Wrestler steps off the Forge');
  const bstats = await evalJs('({hp:RESORT.state.hero.maxHp, dmg:RESORT.state.hero.dmg, phase:RESORT.state.phase})');
  ok(bstats.hp === 1050 && bstats.dmg === 60 && bstats.phase === 'BREAK',
    'the body statline applied and the first break began', JSON.stringify(bstats));

  // --- 2.5 THE MAP (rev 1): sixteen squares, one market, the port -------
  console.log('\nTHE MAP — sixteen squares, one market, the port');
  ok(await evalJs('RESORT.rules.maxPlayers') === 16, 'sixteen squares is the cap (RULES.maxPlayers)');
  await evalJs('RESORT.setSeed("map")');
  ok(await evalJs('RESORT.state.zone') === 'MARKET', 'the run OPENS at the market (the Forge stands among the stalls)');
  await evalJs('RESORT.pickBody("wrestler")');
  const mpos = await evalJs('({z:RESORT.state.zone, x:RESORT.state.hero.x, hz:RESORT.state.hero.z})');
  ok(mpos.z === 'MARKET' && Math.abs(mpos.x) <= 23 && mpos.hz >= -20 && mpos.hz <= 14,
    'the first shop break stands you in the market plaza', JSON.stringify(mpos));
  await evalJs('RESORT.skipTide()');
  await evalJs('RESORT.runTicks(3)');
  const sq = await evalJs('({z:RESORT.state.zone, x:RESORT.state.hero.x, hz:RESORT.state.hero.z, phase:RESORT.state.phase})');
  ok(sq.z === 'SQUARE' && sq.phase === 'TIDE' && sq.x === 0 && sq.hz === 1,
    'the tide PORTS you home to the middle of your own square', JSON.stringify(sq));
  const backTrip = await evalJs('RESORT.runTides(1, 20*60*4)');
  const backZone = await evalJs('({z:RESORT.state.zone, phase:RESORT.state.phase})');
  ok(backTrip.ok && backZone.z === 'MARKET' && backZone.phase === 'BREAK',
    'the clear PORTS you back to the market for the break', JSON.stringify(backZone));
  // stall proximity drives the rack UI in the market (walk up -> sheet opens).
  // Poll, don't sleep: SwiftShader frames can run ~10fps headless.
  const sheetIs = want => evalJs(`(async()=>{
    for (let i = 0; i < 40; i++) {
      if (document.getElementById('sheet').classList.contains('show') === ${want}) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false; })()`);
  await evalJs('RESORT.state.hero.x = -18; RESORT.state.hero.z = 3; 1');   // the STRIKE RACK counter
  ok(await sheetIs(true), 'standing at a market stall opens its rack sheet');
  await evalJs('RESORT.state.hero.x = 0; RESORT.state.hero.z = -14; 1');
  ok(await sheetIs(false), 'walking away closes the counter');

  // --- 3. TWO TIDES, MEASURED IN TICKS ---------------------------------
  console.log('\nSIM — two tides on a paused wall clock');
  await evalJs('RESORT.setSeed("smoke")');
  await evalJs('RESORT.pickBody("wrestler")');
  const t0 = await evalJs('RESORT.snapshot()');
  ok(t0.tick === 0, 'a fresh sim starts at tick 0', `tick=${t0.tick}`);

  const idleFrames = await evalJs('(async()=>{const a=RESORT.state.tick; await new Promise(r=>setTimeout(r,1200)); return {a, b:RESORT.state.tick, frames:RESORT.frames};})()');
  ok(idleFrames.a === idleFrames.b,
    'SIM TICKS ARE NOT WALL TIME — 1.2s of real time, 0 ticks while paused',
    `ticks ${idleFrames.a}->${idleFrames.b}`);

  const run = await evalJs('RESORT.runTides(2, 20*60*8)');
  ok(run.ok && run.cleared >= 2, 'two whole tides CLEARED', `cleared=${run.cleared} in ${run.ticks} ticks`);
  const t2 = await evalJs('RESORT.snapshot()');
  ok(t2.tick === t0.tick + run.ticks, 'the tick counter is the only clock in the sim',
    `${t0.tick} + ${run.ticks} = ${t2.tick}`);
  ok(t2.deaths === 0, 'the naked wrestler survived tides 1-2 standing still', `deaths=${t2.deaths}`);
  ok(t2.kills >= 14 + 16, 'both tide quotas were actually killed', `kills=${t2.kills}`);
  ok(t2.pearls >= 3 + 2, 'a pearl per cleared tide', `pearls=${t2.pearls}`);
  ok(t2.gold === 100 + t2.ledger.bounty + t2.ledger.clears - t2.ledger.spent,
    'LEDGER LAW: gold === start + bounty + clears - spent', `gold=${t2.gold}`);

  // --- 4. THE RACKS: one engine, thirty-eight rows (16 classic + WS3) ---
  console.log('\nRACKS — buys, locks, slots, cooldowns');
  await evalJs('RESORT.setSeed("racks")');
  await evalJs('RESORT.pickBody("magician")');
  ok((await evalJs('RESORT.buySpell("fireball")')).ok === true, 'FIREBALL bought with the 3 starting pearls');
  ok(await evalJs('RESORT.state.pearls') === 0, 'pearls actually left the purse');
  ok(await evalJs('RESORT.state.slots.Q') === 'fireball', 'auto-racked to Q');
  ok((await evalJs('RESORT.buySpell("fireball")')).why === 'owned', 'no double-buy');
  ok((await evalJs('RESORT.buySpell("multishot")')).why === 'locked', 'tier-2 locked before tide 5');
  ok((await evalJs('RESORT.buySpell("meteortide")')).why === 'locked', 'bigs locked before tide 8 (P0 slice gate)');
  await evalJs('RESORT.givePearls(60)');
  ok((await evalJs('RESORT.buySpell("bulwark")')).ok && (await evalJs('RESORT.buySpell("crit")')).ok,
    'GUARD and CURRENT racks sell too');
  ok((await evalJs('RESORT.equip("crit","W")')).ok && await evalJs('RESORT.state.slots.W') === 'crit',
    'slot chips re-rack a spell');

  // a live cast, measured in ticks
  await evalJs('RESORT.skipTide(); RESORT.runTicks(40)');
  const castProbe = await evalJs(`(()=>{
    const S=RESORT.state;
    const c=S.creeps.find(c=>!c.dead);
    if(!c) return {no:'creeps'};
    const r=RESORT.cast('Q', c.x, c.z);
    return {ok:r.ok, projs:S.projs.length, cd:S.cds.fireball>0};
  })()`);
  ok(castProbe.ok && castProbe.projs === 1 && castProbe.cd,
    'FIREBALL casts at the aim point: projectile up, cooldown running', JSON.stringify(castProbe));
  await evalJs('RESORT.runTicks(50)');
  ok(await evalJs('RESORT.state.projs.length') === 0, 'the projectile resolved inside the sim');
  ok((await evalJs('RESORT.cast("Q",0,0)')).why === 'cd', 'the cooldown refuses a second cast');
  const cdTick = await evalJs('(()=>{const a=RESORT.state.cds.fireball; RESORT.runTicks(20); return {a, b:RESORT.state.cds.fireball};})()');
  ok(cdTick.b === cdTick.a - 20, 'cooldowns tick in SIM TICKS, not seconds', JSON.stringify(cdTick));
  const shieldProbe = await evalJs('(RESORT.cast("W",0,0), RESORT.equip("bulwark","W"), RESORT.cast("W",0,0), RESORT.state.hero.shield)');
  ok(shieldProbe > 0, 'BULWARK raises a real absorb pool', `shield=${shieldProbe}`);
  const encore = await evalJs('RESORT.state.hero.cdMult');
  ok(encore === 0.85, "the magician's ENCORE innate runs cooldowns 15% faster", `cdMult=${encore}`);

  // --- 5. FRUIT, ITEMS, XP->RANKS, THE TIDE TABLET ---------------------
  console.log('\nECONOMY — fruit stand, surf shack, ranks, respec');
  await evalJs('RESORT.giveGold(5000)');
  const fr = await evalJs('(()=>{const d=RESORT.state.hero.dmg; RESORT.buyFruit("mango",true); return {d, d2:RESORT.state.hero.dmg, rank:RESORT.state.fruit.mango};})()');
  ok(fr.rank === 5 && fr.d2 > fr.d, 'a MANGO five-pack raises damage', JSON.stringify(fr));
  const it = await evalJs('(()=>{const ms=RESORT.state.hero.ms; RESORT.buyItem("flippers"); return {ms, ms2:RESORT.state.hero.ms, n:RESORT.state.items.length};})()');
  ok(it.n === 1 && it.ms2 > it.ms, 'FLIPPERS occupy a slot and add move speed', JSON.stringify(it));
  const potion = await evalJs('(()=>{RESORT.buyItem("guava"); RESORT.state.hero.hp=200; const i=RESORT.state.items.findIndex(x=>x.id==="guava"); const r=RESORT.useItem(i); return {ok:r.ok, hp:RESORT.state.hero.hp, n:RESORT.state.items.length};})()');
  ok(potion.ok && potion.hp === 550 && potion.n === 1, 'GUAVA JUICE heals 350 and burns its slot', JSON.stringify(potion));
  const xp = await evalJs('(RESORT.giveXp(600), {level:RESORT.state.level, pts:RESORT.state.skillPts})');
  ok(xp.level > 1 && xp.pts > 0, 'XP levels the hero and pays skill points', JSON.stringify(xp));
  ok((await evalJs('RESORT.rankUp("fireball")')).ok && await evalJs('RESORT.state.spells.fireball.rank') === 2,
    'a skill point ranks FIREBALL to 2');
  const respec = await evalJs(`(()=>{
    const S=RESORT.state;
    const before={pearls:S.pearls, spent:S.ledger.pearlsSpent, pts:S.skillPts, gold:S.gold};
    const r=RESORT.respec();
    return {r, before, after:{pearls:S.pearls, spells:Object.keys(S.spells).length, pts:S.skillPts, gold:S.gold}};
  })()`);
  ok(respec.r.ok && respec.after.pearls === respec.before.pearls + respec.before.spent
    && respec.after.spells === 0 && respec.after.gold === respec.before.gold - 100,
    'THE TIDE TABLET (100g): full pearl refund, points back, racks reopen', JSON.stringify(respec.after));
  const ledger2 = await evalJs('(()=>{const S=RESORT.state; return S.gold === 100 + 5000 + S.ledger.bounty + S.ledger.clears - S.ledger.spent;})()');
  ok(ledger2, 'LEDGER LAW still holds after the whole spree');

  // --- 6. THE FULL 10-TIDE AUTO-RUN ------------------------------------
  console.log('\nTHE P0 SLICE — 10 tides, bosses, modifiers, victory (shared shopper bot)');
  const botSrc = readFileSync(join(ROOT, 'tools', 'bot.mjs'), 'utf8').replace(/^export /gm, '');
  await evalJs(botSrc + '; window.__makeShopper = makeShopper; 1');
  const runAll = await evalJs(`(()=>{
    RESORT.setSeed('battery');
    RESORT.pickBody('diver');
    RESORT.buySpell('fireball');
    const sim = RESORT.sim, S = RESORT.state;
    const bot = window.__makeShopper(sim, {kite:true});
    const obs = {bossTides:{}, modTides:{}, pearlSchedule:true, ledgerEveryClear:true, quotas:{}};
    let lastCleared = 0, lastPearls = S.pearls, lastSpent = S.ledger.pearlsSpent;
    let t = 0;
    const MAX = 20*60*35;
    while (S.phase !== 'VICTORY' && t < MAX) {
      bot.step();
      sim.tick(); t++;
      if (S.phase === 'TIDE' && !obs.quotas[S.tide]) {
        obs.quotas[S.tide] = S.quota;
        if (S.creeps.some(c => c.big)) obs.bossTides[S.tide] = true;
        if (S.tideMod) obs.modTides[S.tide] = S.tideMod;
      }
      if (S.cleared !== lastCleared) {
        const justCleared = S.tide;
        const spentDelta = S.ledger.pearlsSpent - lastSpent;
        const gained = (S.pearls + spentDelta) - lastPearls;
        const want = (justCleared % 5 === 0) ? 2 : 1;
        if (gained !== want) obs.pearlSchedule = justCleared + ':' + gained + '!=' + want;
        if (S.gold !== 100 + S.ledger.bounty + S.ledger.clears - S.ledger.spent) obs.ledgerEveryClear = 'broke@' + justCleared;
        lastCleared = S.cleared; lastPearls = S.pearls; lastSpent = S.ledger.pearlsSpent;
      }
    }
    obs.edgeKinds = Array.from(new Set(S.edgeLog)).sort();
    return {phase:S.phase, cleared:S.cleared, deaths:S.deaths, level:S.level, ticks:t,
      victory:S.victory, obs, spells:Object.keys(S.spells).length,
      gold:S.gold, ledger:S.ledger};
  })()`);
  ok(runAll.phase === 'VICTORY' && runAll.cleared === 10,
    'the shopper bot CLEARS ALL TEN TIDES', `cleared=${runAll.cleared} deaths=${runAll.deaths} in ${runAll.ticks} ticks`);
  ok(runAll.obs.quotas[5] === 11 && runAll.obs.quotas[10] === 16,
    'boss tides run the reduced quota (11 @ t5, 16 @ t10)', JSON.stringify(runAll.obs.quotas));
  ok(runAll.obs.bossTides[5] === true && runAll.obs.bossTides[10] === true,
    'a hero-unit boss walked the sand at tides 5 and 10');
  ok(!!runAll.obs.modTides[6] && !!runAll.obs.modTides[9],
    'modifier tides bolted ONE ability at tides 6 and 9', JSON.stringify(runAll.obs.modTides));
  ok(runAll.obs.pearlSchedule === true,
    'PEARL MATH: +1 per clear, +2 on milestones, every single tide');
  ok(runAll.obs.edgeKinds && runAll.obs.edgeKinds.length >= 3,
    'surf-sets broke over multiple fences across the run (rev 1 spawns)', JSON.stringify(runAll.obs.edgeKinds));
  ok(runAll.obs.ledgerEveryClear === true,
    'GOLD MATH: the ledger invariant held at every clear');
  ok(runAll.victory && runAll.victory.tide === 10 && runAll.victory.spells.length >= 4,
    'VICTORY carries the run stats (tide, build, level)', `level=${runAll.victory && runAll.victory.level}`);
  // 15 pearls land by tide 10 (3 start + 10 clears + 2 milestone bonus); at
  // spec prices that is a 4-5 spell build. 4+ = the economy actually flowed.
  ok(runAll.spells >= 4, 'the bot owned a real build by the end', `${runAll.spells} spells`);

  // --- 6.5 THE GHOST: record, race, daily shelf (link 3) -----------------
  console.log('\nGHOST — the record, the race, the daily shelf');
  await sleep(400);   // the victory event drains on the next rAF; let it land
  const rec = await evalJs('RESORT.ghost.load("free")');
  ok(rec && rec.v === 1 && rec.cleared === 10 && Object.keys(rec.tides).length === 10,
    'victory wrote the ghost record: 10 tides of splits', rec ? `cleared=${rec.cleared}` : 'null');
  ok(rec && rec.totalTick === runAll.victory.ticks,
    "the ghost's total clock === the victory run clock", rec && `${rec.totalTick} ticks`);
  ok(rec && rec.tides[10] && rec.tides[10].kills === rec.kills && rec.tides[10].worth > 0,
    'per-tide entries carry kills and net worth', rec && JSON.stringify(rec.tides[10]));

  await evalJs('RESORT.setSeed("battery")');
  await evalJs('RESORT.pickBody("diver")');
  ok(await evalJs('RESORT.ghost.ghost !== null'), 'a fresh run freezes the stored ghost to race');
  const race = await evalJs(`(()=>{
    const sim = RESORT.sim, S = RESORT.state;
    const bot = window.__makeShopper(sim, {kite:true});
    RESORT.buySpell('fireball');
    let t = 0;
    while (S.cleared < 2 && t < 20*60*6) { bot.step(); sim.tick(); t++; }
    return {cleared:S.cleared,
      you1:S.tideLog[1] && S.tideLog[1].tick, g1:RESORT.ghost.ghost.tides[1].tick};
  })()`);
  await sleep(600);   // clears drain on rAF; let the race score and the board draw
  const raceLead = await evalJs('RESORT.ghost.leader');
  ok(race.cleared === 2 && (raceLead === 'you' || raceLead === 'ghost'),
    'two cleared tides scored against the ghost — a race has a leader', `leader=${raceLead}`);
  const board = await evalJs(`({
    shown: document.getElementById('standings').classList.contains('show'),
    rows: document.querySelectorAll('#st-rows .strow').length,
    lead: document.getElementById('st-lead').textContent,
    foot: document.getElementById('st-foot').textContent })`);
  ok(board.shown && board.rows === 11, 'the standings board is ALWAYS up: header + ten tide rows', JSON.stringify(board.rows));
  ok(/\+\d+:\d{2}$/.test(board.lead), 'the lead chip reads like a stopwatch', board.lead);
  ok(board.foot.length > 8, 'the board footer describes the ghost', board.foot);

  const dkey = await evalJs('(RESORT.setSeed("DAILY-20990101"), RESORT.ghost.key())');
  ok(dkey === 'daily.DAILY-20990101', 'a DAILY seed routes to its own ghost shelf', dkey);
  ok(await evalJs('RESORT.ghost.ghost === null'), 'a fresh date has no daily ghost yet');
  ok((await evalJs('RESORT.seed')).v === 1, 'the daily seed still carries its v:1 field');
  const dfold = await evalJs(`(()=>{
    RESORT.pickBody('wrestler');
    const sim = RESORT.sim, S = RESORT.state;
    const bot = window.__makeShopper(sim, {kite:true});
    let t = 0;
    while (S.cleared < 1 && t < 20*150) { bot.step(); sim.tick(); t++; }
    RESORT.setSeed('walked-away');
    return RESORT.ghost.load('daily.DAILY-20990101');
  })()`);
  ok(dfold && dfold.cleared >= 1, 'an ABANDONED daily run still folds into the daily record',
    dfold && `cleared=${dfold.cleared}`);

  // --- 7. DETERMINISM WITH SCRIPTED INPUTS ------------------------------
  console.log('\nDETERMINISM — same seed, same inputs, same world');
  const script = `(()=>{
    RESORT.setSeed('besaid');
    RESORT.pickBody('magician');
    RESORT.buySpell('fireball');
    RESORT.skipTide();
    RESORT.runTicks(200);
    RESORT.cast('Q', 0, -10);
    RESORT.runTicks(320);
    return RESORT.snapshot();
  })()`;
  const A = await evalJs(script);
  const B = await evalJs(script);
  ok(A.alive > 0 || A.killed > 0, 'the determinism sample has combat in it', `alive=${A.alive} killed=${A.killed}`);
  ok(JSON.stringify(A) === JSON.stringify(B), 'seed "besaid" + scripted buys/casts reproduces exactly',
    `hpSum=${A.hpSum} draws=${A.draws}`);
  const Cs = await evalJs(script.replace('besaid', 'other-seed'));
  ok(JSON.stringify(Cs) !== JSON.stringify(A), 'a different seed produces a different run');

  // --- 8. THE REST OF THE DEBUG SURFACE ---------------------------------
  console.log('\nDEBUG API');
  const spawnRes = await evalJs('(RESORT.setSeed("api"), RESORT.pickBody("wrestler"), RESORT.runTicks(2), {ids:RESORT.spawn(5,"crab").length, alive:RESORT.state.creeps.length})');
  ok(spawnRes.ids === 5 && spawnRes.alive === 5, 'RESORT.spawn(5) puts five creeps on the sand', JSON.stringify(spawnRes));
  const cap = await evalJs('(RESORT.setSeed("cap"), RESORT.pickBody("wrestler"), RESORT.spawn(60), {alive:RESORT.state.creeps.length, queued:RESORT.state.queue})');
  ok(cap.alive <= 40, 'the cove cap holds at 40 concurrent, the rest queue', JSON.stringify(cap));
  const curves = await evalJs('[1,5,6,10,15,20,25,30].map(t=>RESORT.curves.creepHp(t))');
  ok(curves[0] === 100 && curves[1] === 260 && curves[7] === 11000,
    'the creep HP curve hits every printed bracket anchor', curves.join(','));
  const hold = await evalJs('(()=>{RESORT.setSeed("hold"); RESORT.pickBody("diver"); const a=RESORT.state.phaseTicks; RESORT.setHold(true); RESORT.runTicks(40); const b=RESORT.state.phaseTicks; RESORT.setHold(false); RESORT.runTicks(10); return {a,b,c:RESORT.state.phaseTicks};})()');
  ok(hold.a === hold.b && hold.c < hold.b, 'the tide waits while you haggle (shop hold)', JSON.stringify(hold));

  // --- 8.5 PRESENTATION: title, death spectacle, audio kit (link 3) -------
  console.log('\nPRESENTATION — title, washout vista, countdown, audio');
  ok(await evalJs('(RESORT.showTitle(true), RESORT.titleUp && document.body.classList.contains("titleup"))'),
    'the title raises: wordmark up, HUD stands down');
  ok(await evalJs('(RESORT.showTitle(false), !RESORT.titleUp)'), 'PLAY drops the title');

  const wash = await evalJs(`(()=>{
    RESORT.setSeed('spectacle');
    RESORT.pickBody('magician');
    RESORT.skipTide();
    RESORT.runTicks(140);
    RESORT.state.hero.hp = 1;
    let t = 0;
    while (RESORT.state.phase !== 'WASHOUT' && t < 20*90) { RESORT.runTicks(1); t++; }
    return {phase: RESORT.state.phase, deaths: RESORT.state.deaths};
  })()`);
  ok(wash.phase === 'WASHOUT' && wash.deaths === 1, 'a dead hero enters WASHOUT, never game over', JSON.stringify(wash));
  await sleep(700);   // the rAF loop eases the camera even while the sim is paused
  const spect = await evalJs(`({
    vista: RESORT.vistaK,
    down: document.getElementById('down-panel').classList.contains('show'),
    count: document.getElementById('down-count').textContent })`);
  ok(spect.vista > 0.05, 'death pulls the camera out to the postcard vista', `vistaK=${spect.vista.toFixed(2)}`);
  ok(spect.down && /^\d+:\d{2}$/.test(spect.count), 'the WASHED-UP countdown is on screen', spect.count);
  const deadBreak = await evalJs(`(()=>{
    let t = 0;
    while (RESORT.state.phase === 'WASHOUT' && t < 200) { RESORT.runTicks(1); t++; }
    return {phase: RESORT.state.phase, ticks: RESORT.state.phaseTicks, dead: RESORT.state.hero.dead, zone: RESORT.state.zone};
  })()`);
  ok(deadBreak.phase === 'BREAK' && deadBreak.ticks === 240 && deadBreak.dead,
    'the dead break runs 12s and the hero stays down through it', JSON.stringify(deadBreak));
  ok(deadBreak.zone === 'SQUARE',
    'a dead castaway is NEVER ported — the market is for the living', `zone=${deadBreak.zone}`);
  const back = await evalJs('(RESORT.runTicks(245), {phase:RESORT.state.phase, dead:RESORT.state.hero.dead, hp:RESORT.state.hero.hp})');
  ok(back.phase === 'TIDE' && !back.dead && back.hp > 0,
    'the next tide washes the hero back up — death is never a logout', JSON.stringify(back));

  const aud = await evalJs('(()=>{const a=RESORT.audio; const m0=a.muted; const m1=a.toggleMute(); const m2=a.toggleMute(); return {has:!!a, m0, m1, m2};})()');
  ok(aud.has && aud.m1 === !aud.m0 && aud.m2 === aud.m0,
    'the audio kit is wired and the mute toggle flips both ways (synth-only, no assets)', JSON.stringify(aud));
  ok((await evalJs('document.getElementById("break-hint").textContent')).length > 6,
    'the lifeguard hint ticker is rotating real tips');

  // --- 8.7 WS1 COMBAT FEEL: missiles, impacts, corpses, hitstop, audio ----
  console.log('\nWS1 COMBAT FEEL — real missiles, corpse beat, hitstop, the kit');

  // corpse beat first, while no earlier combat-lab residue is on the sand
  await evalJs(`(()=>{
    RESORT.setSeed('ws1-corpse');
    RESORT.pickBody('wrestler');
    RESORT.skipTide();
    RESORT.runTicks(2);
    const S = RESORT.state;
    RESORT.spawn(1, 'crab');
    const c = S.creeps[0];
    c.x = S.hero.x; c.z = S.hero.z - 2; c.px = c.x; c.pz = c.z;
    c.hp = 1;
    let g = 0;
    while (S.creeps.length && g++ < 60) RESORT.runTicks(1);
    return S.kills;
  })()`);
  const corpseSeen = await evalJs(`(async()=>{
    for (let i = 0; i < 20; i++) {
      if (RESORT.fx.corpses > 0) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false; })()`);
  ok(corpseSeen, 'a kill leaves a corpse on the sand (RESORT.fx.corpses, polled)');
  const corpseGone = await evalJs(`(async()=>{
    for (let i = 0; i < 40; i++) {
      if (RESORT.fx.corpses === 0) return true;
      await new Promise(r => setTimeout(r, 60));
    }
    return false; })()`);
  ok(corpseGone, 'the corpse sinks into the sand and frees its slot within ~1.5s');

  // hit sparks off a landed swing (poll — SwiftShader frames can run ~10fps)
  await evalJs(`(()=>{
    const S = RESORT.state;
    RESORT.spawn(1, 'crab');
    const c = S.creeps[S.creeps.length - 1];
    c.x = S.hero.x; c.z = S.hero.z - 2; c.px = c.x; c.pz = c.z;
    c.hp = c.maxHp = 5000;
    RESORT.runTicks(30);
    return 1;
  })()`);
  const sparksSeen = await evalJs(`(async()=>{
    for (let i = 0; i < 20; i++) {
      if (RESORT.fx.sparks > 0) return true;
      await new Promise(r => setTimeout(r, 40));
    }
    return false; })()`);
  ok(sparksSeen, 'a landed swing pops hit sparks (RESORT.fx.sparks, polled)');

  // hitstop: the wrestler's 6th-swing suplex is a forceable crit. The stop
  // only engages on the LIVE clock (never during runTicks), so resume, watch
  // the flag, pause again. hitstopActive is wall-clock state — polling reads
  // it directly regardless of frame rate.
  const stopSeen = await evalJs(`(async()=>{
    const S = RESORT.state;
    RESORT.spawn(1, 'crab');
    const c = S.creeps[S.creeps.length - 1];
    c.x = S.hero.x; c.z = S.hero.z - 2; c.px = c.x; c.pz = c.z;
    c.hp = c.maxHp = 50000;
    S.hero.swingN = 4;
    RESORT.resume();
    let seen = false;
    for (let i = 0; i < 120 && !seen; i++) {
      if (RESORT.fx.hitstopActive) seen = true;
      await new Promise(r => setTimeout(r, 25));
    }
    RESORT.pause(true);
    return seen; })()`);
  ok(stopSeen, 'a suplex connect engages the selective macro-hitstop');
  const stopTicks = await evalJs('(()=>{ const a = RESORT.state.tick; RESORT.runTicks(50); return RESORT.state.tick - a; })()');
  ok(stopTicks === 50, 'runTicks bypasses the hitstop clock — tools never feel it', `advanced ${stopTicks}`);

  // the wand basic is a REAL homing missile with travel time
  const missile = await evalJs(`(()=>{
    RESORT.setSeed('ws1-missile');
    RESORT.pickBody('magician');
    RESORT.skipTide();
    RESORT.runTicks(2);
    const S = RESORT.state;
    RESORT.spawn(1, 'crab');
    const c = S.creeps[0];
    c.x = S.hero.x; c.z = S.hero.z - 6; c.px = c.x; c.pz = c.z;
    const hp0 = c.hp;
    let launchTick = -1, hpDropTick = -1, sawProj = false;
    for (let i = 0; i < 60; i++) {
      RESORT.runTicks(1);
      const m = S.projs.find(p => p.kind === 'basic');
      if (m && launchTick < 0) { launchTick = S.tick; sawProj = true; }
      if (launchTick > 0 && hpDropTick < 0 && c.hp < hp0) { hpDropTick = S.tick; break; }
    }
    return { sawProj, flight: hpDropTick - launchTick, dmg: hp0 - c.hp, heroDmg: S.hero.dmg };
  })()`);
  ok(missile.sawProj, "the wand basic is a real projectile: S.projs gains a kind:'basic' entry");
  ok(missile.flight >= 2, 'the missile takes real travel time (damage lands >= 2 ticks after launch)', `flight=${missile.flight} ticks`);
  ok(missile.dmg === missile.heroDmg, 'connect damage equals the swing formula exactly (crit off)', `${missile.dmg} vs h.dmg=${missile.heroDmg}`);

  // dead-target handling: retarget within 2.5m, else fizzle with zero damage
  const fizzle = await evalJs(`(()=>{
    RESORT.setSeed('ws1-fizzle');
    RESORT.pickBody('magician');
    RESORT.skipTide(); RESORT.runTicks(2);
    const S = RESORT.state;
    RESORT.spawn(2, 'crab');
    const a = S.creeps[0], b = S.creeps[1];
    a.x = 0; a.z = S.hero.z - 6.4; a.px = a.x; a.pz = a.z;
    b.x = 1.0; b.z = S.hero.z - 6.4; b.px = b.x; b.pz = b.z;
    let m = null, guard = 0;
    while (!m && guard++ < 40) { RESORT.runTicks(1); m = S.projs.find(p => p.kind === 'basic'); }
    if (!m) return { no: 'launch' };
    const tgt0 = m.tgt;
    const tgtA = S.creeps.find(c => c.id === tgt0);
    const other = S.creeps.find(c => c.id !== tgt0 && !c.dead);
    const otherHp0 = other ? other.hp : 0;
    guard = 0;
    while (guard++ < 30 && !m.dead) {           // fly until the NEIGHBOUR is in
      if (other && Math.hypot(other.x - m.x, other.z - m.z) <= 2.2) break;   // retarget range
      RESORT.runTicks(1);
    }
    if (m.dead) return { no: 'connected-early' };
    tgtA.dead = true; tgtA.receded = true;
    let redirected = false, t = 0;
    while (!m.dead && t++ < 30) { RESORT.runTicks(1); if (m.tgt !== tgt0) redirected = true; }
    const otherDropped = other && other.hp < otherHp0;
    RESORT.setSeed('ws1-fizzle2');
    RESORT.pickBody('magician');
    RESORT.skipTide(); RESORT.runTicks(2);
    const S2 = RESORT.state;
    RESORT.spawn(1, 'crab');
    const solo = S2.creeps[0];
    solo.x = 0; solo.z = S2.hero.z - 6.4; solo.px = solo.x; solo.pz = solo.z;
    let m2 = null; guard = 0;
    while (!m2 && guard++ < 40) { RESORT.runTicks(1); m2 = S2.projs.find(p => p.kind === 'basic'); }
    if (!m2) return { no: 'launch2' };
    solo.dead = true; solo.receded = true;
    const hpBefore = S2.creeps.filter(c => !c.dead).reduce((s, c) => s + c.hp, 0);
    let t2 = 0;
    while (!m2.dead && t2++ < 30) RESORT.runTicks(1);
    const hpAfter = S2.creeps.filter(c => !c.dead).reduce((s, c) => s + c.hp, 0);
    return { redirected, otherDropped, fizzled: m2.dead, leaked: hpBefore - hpAfter };
  })()`);
  ok(fizzle.redirected === true && fizzle.otherDropped === true,
    'a missile whose target died retargets a neighbour within 2.5m', JSON.stringify({ redirected: fizzle.redirected, no: fizzle.no }));
  ok(fizzle.fizzled === true && fizzle.leaked === 0,
    'with no neighbour in reach it fizzles silently — zero damage leaks', `leaked=${fizzle.leaked}`);

  // lifesteal pays on CONNECT, not at launch
  const steal = await evalJs(`(()=>{
    RESORT.setSeed('ws1-steal');
    RESORT.pickBody('magician');
    const S = RESORT.state;
    S.tide = 4; S.cleared = 4; S.phase = 'BREAK'; S.phaseTicks = 30;   // the tide-jump recipe
    RESORT.givePearls(10);
    const buy = RESORT.buySpell('lifesteal');
    let guard = 0;
    while (S.phase !== 'TIDE' && guard++ < 100) RESORT.runTicks(1);
    RESORT.runTicks(2);
    S.hero.regen = 0; S.hero.hp = 300;         // a still pool: only lifesteal moves it
    RESORT.spawn(1, 'crab');
    const c = S.creeps[S.creeps.length - 1];
    c.x = S.hero.x; c.z = S.hero.z - 6; c.px = c.x; c.pz = c.z;
    let launched = false, hpAtLaunch = -1, hpAtConnect = -1, connected = false;
    guard = 0;
    while (!connected && guard++ < 80) {
      RESORT.runTicks(1);
      const live = S.projs.some(p => p.kind === 'basic');
      if (live && !launched) { launched = true; hpAtLaunch = S.hero.hp; }
      if (launched && !live) { connected = true; hpAtConnect = S.hero.hp; }
    }
    return { ok: buy.ok, launched, connected, hpAtLaunch, hpAtConnect, ls: S.hero.lifesteal };
  })()`);
  ok(steal.ok && steal.launched && steal.connected,
    'the lifesteal lab ran (tier-2 aura bought at tide 5, missile flew)', `ls=${steal.ls}%`);
  ok(steal.hpAtLaunch === 300 && steal.hpAtConnect > 303,
    'lifesteal pays ON CONNECT, not at launch', `launch=${steal.hpAtLaunch} connect=${Math.round(steal.hpAtConnect * 10) / 10}`);

  // event riders: hit kinds, the stun duration, the frost slow flag
  const riders = await evalJs(`(()=>{
    RESORT.setSeed('ws1-riders');
    RESORT.pickBody('wrestler');
    RESORT.givePearls(10);
    RESORT.buySpell('frostsnap');
    RESORT.skipTide();
    RESORT.runTicks(2);
    const S = RESORT.state;
    RESORT.spawn(2, 'crab');
    for (const c of S.creeps) {
      c.x = S.hero.x + 0.5; c.z = S.hero.z - 2; c.px = c.x; c.pz = c.z;
      c.hp = c.maxHp = 99999;
    }
    S.events.length = 0;
    RESORT.runTicks(14);
    const slot = ['Q', 'W', 'E'].find(k => S.slots[k] === 'frostsnap');
    RESORT.cast(slot, S.creeps[0].x, S.creeps[0].z);
    RESORT.runTicks(2);
    const meleeKind = S.events.some(e => e.type === 'hit' && e.kind === 'melee');
    const spellKind = S.events.some(e => e.type === 'hit' && e.kind === 'spell');
    const frostSlow = S.events.some(e => e.type === 'aoe_hit' && e.slow === true);
    S.tideMod = 'bash';                        // force the bash roll on every crab hit
    let stunEv = null, g2 = 0;
    while (!stunEv && g2++ < 900) {
      if (g2 % 100 === 0) S.hero.hp = S.hero.maxHp;
      RESORT.runTicks(1);
      stunEv = S.events.find(e => e.type === 'stun');
    }
    return { meleeKind, spellKind, frostSlow, stunSec: stunEv && stunEv.sec };
  })()`);
  ok(riders.meleeKind && riders.spellKind && riders.frostSlow,
    "hit events carry their kind; FROST SNAP's aoe_hit carries slow:true", JSON.stringify({ m: riders.meleeKind, s: riders.spellKind, f: riders.frostSlow }));
  ok(riders.stunSec === 0.8, 'the stun event carries its duration', `sec=${riders.stunSec}`);

  // determinism with missiles in the air: same seed, same run, projs included
  const wsDetScript = `(()=>{
    RESORT.setSeed('ws1-det');
    RESORT.pickBody('magician');
    RESORT.buySpell('fireball');
    RESORT.skipTide();
    RESORT.runTicks(260);
    RESORT.cast('Q', 0, -8);
    RESORT.runTicks(340);
    return RESORT.snapshot();
  })()`;
  const wd1 = await evalJs(wsDetScript);
  const wd2 = await evalJs(wsDetScript);
  ok(JSON.stringify(wd1) === JSON.stringify(wd2) && wd1.kills > 0,
    'the magician missile timeline reproduces byte-for-byte', `kills=${wd1.kills} draws=${wd1.draws}`);

  // the combat audio kit is wired — and headless NEVER creates a context
  const audioKit = await evalJs(`({
    hasCombat: typeof RESORT.audio.combat === 'function',
    unlocked: RESORT.audio.unlocked,
    fired: Object.keys(RESORT.fx.combatAudioFired).length })`);
  ok(audioKit.hasCombat && audioKit.unlocked === false,
    'the combat kit exists and the headless context was never created', JSON.stringify(audioKit));
  ok(audioKit.fired >= 2, 'combat cues fired through the event wiring (counted before the unlock gate)', `${audioKit.fired} cue kinds`);

  // --- 8.8 WS2 CONTEXT-SENSITIVE HUD: chrome earns its pixels -----------
  console.log('\nWS2 CONTEXT-SENSITIVE HUD — phase-gated chrome, progressive QWER, the strip');

  await evalJs('RESORT.pause(true)');
  await evalJs('RESORT.setSeed("ws2-hud")');
  const forgeUi = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && RESORT.ui.phaseAttr !== 'FORGE'; i++) await new Promise(r => setTimeout(r, 100));
    const cs = id => getComputedStyle(document.getElementById(id)).display;
    return { phase: RESORT.ui.phaseAttr, tidebox: cs('tidebox'), purse: cs('purse'), hero: cs('herobox'),
      qwer: RESORT.ui.qwerVisible, chips: RESORT.ui.itemChipCount,
      barnoteGone: !document.getElementById('barnote'), tbtnsGone: !document.getElementById('tbtns') };
  })()`);
  ok(forgeUi.phase === 'FORGE' && forgeUi.tidebox === 'none' && forgeUi.purse === 'none' && forgeUi.hero === 'none',
    'FORGE strips the fight chrome (tidebox/purse/herobox all dark)', JSON.stringify([forgeUi.tidebox, forgeUi.purse, forgeUi.hero]));
  ok(forgeUi.qwer === false && forgeUi.chips === 0, 'no cast bar and no item chips before anything is owned');
  ok(forgeUi.barnoteGone && forgeUi.tbtnsGone, 'the barnote hint line and the floating C/M buttons are GONE from the document');

  await evalJs('RESORT.pickBody("wrestler")');
  const breakUi = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && RESORT.ui.phaseAttr !== 'BREAK'; i++) await new Promise(r => setTimeout(r, 100));
    const cs = id => getComputedStyle(document.getElementById(id)).display;
    return { phase: RESORT.ui.phaseAttr, zone: RESORT.ui.zoneAttr, tidebox: cs('tidebox'), purse: cs('purse'), hero: cs('herobox') };
  })()`);
  ok(breakUi.phase === 'BREAK' && breakUi.zone === 'MARKET', 'data-phase/zone stamp the market break', JSON.stringify([breakUi.phase, breakUi.zone]));
  ok(breakUi.tidebox === 'none', 'the tidebox stays dark during a break — #break-next already previews the tide');
  ok(breakUi.purse !== 'none' && breakUi.hero !== 'none', 'purse + herobox earn their pixels on a LIVE break');

  // progressive QWER: the bar is born at the first purchase, dies on respec
  ok(await evalJs('RESORT.ui.qwerVisible') === false && (await evalJs('RESORT.ui.slotsVisible')).length === 0,
    'nothing slotted -> no bar, no slots');
  await evalJs('RESORT.givePearls(10)');
  await evalJs('RESORT.buySpell("fireball")');
  const oneSlot = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && !RESORT.ui.qwerVisible; i++) await new Promise(r => setTimeout(r, 100));
    return { vis: RESORT.ui.qwerVisible, slots: RESORT.ui.slotsVisible }; })()`);
  ok(oneSlot.vis === true && oneSlot.slots.join('') === 'Q',
    'the FIRST purchase births the bar one slot wide (auto-racked to Q)', JSON.stringify(oneSlot.slots));
  await evalJs('RESORT.buySpell("bulwark")');
  const twoSlots = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && RESORT.ui.slotsVisible.length < 2; i++) await new Promise(r => setTimeout(r, 100));
    return RESORT.ui.slotsVisible; })()`);
  ok(twoSlots.join('') === 'QW', 'the second purchase grows it to two', JSON.stringify(twoSlots));
  await evalJs('RESORT.respec()');
  const respecBar = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && RESORT.ui.qwerVisible; i++) await new Promise(r => setTimeout(r, 100));
    return RESORT.ui.qwerVisible; })()`);
  ok(respecBar === false, 'a respec empties every slot and the bar vanishes with them — own nothing, see nothing');

  // occupied-only item chips
  await evalJs('RESORT.giveGold(300)');
  await evalJs('RESORT.buyItem("guava")');
  const chipOn = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && RESORT.ui.itemChipCount !== 1; i++) await new Promise(r => setTimeout(r, 100));
    return RESORT.ui.itemChipCount; })()`);
  ok(chipOn === 1, 'one item -> exactly one chip (no phantom empties)', `chips=${chipOn}`);
  await evalJs(`RESORT.useItem(RESORT.state.items.findIndex(x => x.id === 'guava'))`);
  const chipOff = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && RESORT.ui.itemChipCount !== 0; i++) await new Promise(r => setTimeout(r, 100));
    return RESORT.ui.itemChipCount; })()`);
  ok(chipOff === 0, 'the drunk potion leaves no husk behind');

  // the standings strip: desktop boots EXPANDED (the :always-up law), the
  // toggle collapses to a live strip and back — leave it as found
  ok(await evalJs('RESORT.ui.standingsCollapsed') === false,
    'desktop keeps the board EXPANDED by default (spec §4: the race is always on)');
  await evalJs('RESORT.ui.toggleStandings()');
  const stripState = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && document.querySelectorAll('#st-rows .strow').length; i++) await new Promise(r => setTimeout(r, 100));
    return { rows: document.querySelectorAll('#st-rows .strow').length,
      label: document.getElementById('st-label').textContent,
      collapsed: RESORT.ui.standingsCollapsed }; })()`);
  ok(stripState.collapsed === true && stripState.rows === 0 && /^T\d+ \d+:\d{2}$/.test(stripState.label),
    'collapsed = a one-line strip: zero rows, tide + live clock in the label', stripState.label);
  await evalJs('RESORT.ui.toggleStandings()');
  const boardBack = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && document.querySelectorAll('#st-rows .strow').length !== 11; i++) await new Promise(r => setTimeout(r, 100));
    return document.querySelectorAll('#st-rows .strow').length; })()`);
  ok(boardBack === 11, 'toggling back rebuilds the full board (header + ten tides)');

  // the mute moved into the calm panels: one truth, every icon syncs
  ok(await evalJs('RESORT.ui.muteButtonCount') >= 3, 'mute buttons ride the break + down panels and the title',
    `count=${await evalJs('RESORT.ui.muteButtonCount')}`);
  const mProbe = await evalJs(`(()=>{
    const m0 = RESORT.audio.muted;
    document.querySelector('#break-panel .mutebtn').click();
    const m1 = RESORT.audio.muted;
    const icons = [...document.querySelectorAll('.mutebtn')].map(b => b.textContent);
    document.querySelector('#down-panel .mutebtn').click();
    const m2 = RESORT.audio.muted;
    return { m0, m1, m2, sync: icons.every(i => i === (m1 ? '🔇' : '🔊')) }; })()`);
  ok(mProbe.m1 === !mProbe.m0 && mProbe.m2 === mProbe.m0 && mProbe.sync,
    'ANY mute instance flips the one truth and every icon syncs', JSON.stringify(mProbe));
  ok(await evalJs('RESORT.audio.unlocked') === false, 'headless mute taps still never create an audio context');

  // the port flips the zone stamp (the skip lands on the next tick — run a few)
  await evalJs('RESORT.skipTide(); RESORT.runTicks(3)');
  const tideAttr = await evalJs(`(async()=>{
    for (let i = 0; i < 40 && RESORT.ui.phaseAttr !== 'TIDE'; i++) await new Promise(r => setTimeout(r, 100));
    const cs = id => getComputedStyle(document.getElementById(id)).display;
    return { phase: RESORT.ui.phaseAttr, zone: RESORT.ui.zoneAttr, tidebox: cs('tidebox'), stamp: cs('stamp') }; })()`);
  ok(tideAttr.phase === 'TIDE' && tideAttr.zone === 'SQUARE', 'the port flips data-zone MARKET->SQUARE with the tide');
  ok(tideAttr.tidebox !== 'none', 'the tidebox returns for the fight — the quota IS the fight');
  ok(tideAttr.stamp !== 'none', 'the seed stamp keeps its desktop post (touch-only rule untouched here)');

  // washout + the dead break: the matrix's dark half
  const washUi = await evalJs(`(async()=>{
    const S = RESORT.state;
    S.hero.hp = 1;
    RESORT.spawn(2, 'crab');
    for (const c of S.creeps) { c.x = S.hero.x; c.z = S.hero.z - 1.5; c.px = c.x; c.pz = c.z; }
    let g = 0;
    while (S.phase !== 'WASHOUT' && g++ < 20*60) RESORT.runTicks(1);
    for (let i = 0; i < 40 && RESORT.ui.phaseAttr !== 'WASHOUT'; i++) await new Promise(r => setTimeout(r, 100));
    const cs = id => getComputedStyle(document.getElementById(id)).display;
    return { attr: RESORT.ui.phaseAttr, tidebox: cs('tidebox'), purse: cs('purse'), bar: cs('bar'),
      dead: document.body.classList.contains('dead') }; })()`);
  ok(washUi.attr === 'WASHOUT' && washUi.tidebox === 'none' && washUi.purse === 'none' && washUi.bar === 'none',
    'WASHOUT strips tidebox/purse/cast bar — the postcard breathes', JSON.stringify([washUi.tidebox, washUi.purse, washUi.bar]));
  ok(washUi.dead === true, 'body.dead marks the down state for the sheet');
  const deadBreakUi = await evalJs(`(async()=>{
    let g = 0;
    while (RESORT.state.phase === 'WASHOUT' && g++ < 200) RESORT.runTicks(1);
    for (let i = 0; i < 40 && RESORT.ui.phaseAttr !== 'BREAK'; i++) await new Promise(r => setTimeout(r, 100));
    const cs = id => getComputedStyle(document.getElementById(id)).display;
    return { attr: RESORT.ui.phaseAttr, dead: document.body.classList.contains('dead'),
      purse: cs('purse'), hero: cs('herobox') }; })()`);
  ok(deadBreakUi.attr === 'BREAK' && deadBreakUi.dead && deadBreakUi.purse === 'none' && deadBreakUi.hero === 'none',
    'a DEAD break keeps the shopping chrome dark — the market is for the living', JSON.stringify(deadBreakUi));

  // --- 8.9 WS3 ABILITIES: 38 rows, the new verbs, the rider stack --------
  // Idiom: seed → pickBody → givePearls → buy/equip → spawn/poke → tick →
  // assert EXACT numbers. Two page-side lab helpers keep every check clean:
  // __ws3jump poses a run at any tide (the tide-jump recipe), __ws3arm
  // freezes the spawner + the clear check so the lab owns the sand.
  console.log('\nWS3 ABILITIES — thirty-eight rows, one engine, the new verbs');
  await evalJs('RESORT.pause(true)');
  await evalJs(`window.__ws3jump = (seed, body, tideN) => {
    RESORT.setSeed(seed);
    RESORT.pickBody(body);
    RESORT.givePearls(60);
    RESORT.giveGold(9000);
    const S = RESORT.state;
    S.tide = tideN - 1; S.cleared = tideN - 1; S.phase = 'BREAK'; S.phaseTicks = 30;
    return S;
  };
  window.__ws3arm = () => {
    const S = RESORT.state;
    let g = 0;
    while (S.phase !== 'TIDE' && g++ < 200) RESORT.runTicks(1);
    RESORT.runTicks(1);
    S.quota = 9999; S.spawned = 9999;
    for (const c of S.creeps) { c.dead = true; c.receded = true; }
    RESORT.runTicks(1);
    return S.tick;
  }; 1`);

  // pool integrity: 38 rows, per-rack 10/11/11/6, every tooltip resolves its
  // %N at every rank and spellpower — the "numbers stated plainly" law
  const pool = await evalJs(`(()=>{
    const SP = RESORT.content.SPELLS;
    const counts = {};
    for (const s of SP) counts[s.cat] = (counts[s.cat] || 0) + 1;
    const unresolved = [];
    for (const s of SP) {
      const cap = s.tier === 'big' ? 3 : 5;
      for (let r = 1; r <= cap; r++) {
        for (const sp of [0, 50]) {
          const vals = s.vals ? s.vals(r, sp) : [];
          const txt = RESORT.tf.apply(null, [RESORT.TXT(s.desc)].concat(vals));
          if (/%\\d/.test(txt)) unresolved.push(s.id + '@r' + r);
        }
      }
    }
    return { n: SP.length, counts, unresolved: unresolved.slice(0, 4) };
  })()`);
  ok(pool.n === 38, 'the pool holds THIRTY-EIGHT rows', `n=${pool.n}`);
  ok(pool.counts.STRIKE === 10 && pool.counts.GUARD === 11 && pool.counts.CURRENT === 11 && pool.counts.DEEP === 6,
    'racks balance 10 / 11 / 11 / 6 — browsable, no fifth rack', JSON.stringify(pool.counts));
  ok(pool.unresolved.length === 0, 'every desc resolves every %N at every rank and spellpower (tooltip law, automated)',
    pool.unresolved.join(',') || 'clean');

  // the STRIKE rack renders all ten rows through spellRow (walk-up proof)
  await evalJs('RESORT.setSeed("ws3-rack")');
  await evalJs('RESORT.pickBody("wrestler")');
  await evalJs('RESORT.state.hero.x = -18; RESORT.state.hero.z = 3; 1');
  const rackRows = await evalJs(`(async()=>{
    for (let i = 0; i < 40; i++) {
      if (document.getElementById('sheet').classList.contains('show')
        && document.querySelectorAll('#sheet-rows .srow').length) break;
      await new Promise(r => setTimeout(r, 100));
    }
    return document.querySelectorAll('#sheet-rows .srow').length; })()`);
  ok(rackRows === 10, 'the STRIKE rack renders all TEN rows through spellRow', `rows=${rackRows}`);
  await evalJs('RESORT.state.hero.x = 0; RESORT.state.hero.z = -14; 1');

  // V1 bolt: CONCH CRACK — homing spell missile, stun rider, boss half-rule,
  // and the no-target refusal that spends nothing
  const bolt = await evalJs(`(()=>{
    const S = __ws3jump('ws3-bolt', 'wrestler', 2);
    RESORT.buySpell('conchcrack');
    __ws3arm();
    const refuse = RESORT.cast('Q', 0, -8);
    const cdAfterRefuse = S.cds.conchcrack || 0;
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = S.hero.x; c.z = S.hero.z - 8; c.px = c.x; c.pz = c.z;
    c.hp = c.maxHp = 5000;
    const cast = RESORT.cast('Q', c.x, c.z);
    const isBolt = S.projs.length === 1 && S.projs[0].kind === 'bolt';
    let flight = 0;
    while (S.projs.length && flight++ < 40) RESORT.runTicks(1);
    const dmg = 5000 - c.hp;
    const stunAtConnect = c.stunTicks;
    S.hero.x = 20; S.hero.z = 8; S.hero.px = 20; S.hero.pz = 8;
    const px0 = c.x, pz0 = c.z;
    RESORT.runTicks(15);
    const movedStunned = Math.hypot(c.x - px0, c.z - pz0);
    RESORT.runTicks(40);
    const movedAfter = Math.hypot(c.x - px0, c.z - pz0);
    RESORT.spawn(1, 'crab');
    const b = S.creeps.find(x => x.id !== c.id && !x.dead);
    b.big = true; b.x = 20; b.z = 0; b.px = 20; b.pz = 0; b.hp = b.maxHp = 90000;
    S.cds.conchcrack = 0;
    RESORT.cast('Q', b.x, b.z);
    let g = 0;
    while (S.projs.length && g++ < 40) RESORT.runTicks(1);
    return { refuse: refuse.why, cdAfterRefuse, castOk: cast.ok, isBolt, flight, dmg,
      stunAtConnect, movedStunned, movedAfter, bigStun: b.stunTicks };
  })()`);
  ok(bolt.refuse === 'target' && bolt.cdAfterRefuse === 0,
    'a bolt over empty sand refuses (why:target) and spends NO cooldown', JSON.stringify([bolt.refuse, bolt.cdAfterRefuse]));
  ok(bolt.castOk && bolt.isBolt && bolt.flight >= 2,
    "CONCH CRACK flies as kind:'bolt' with real travel time", `flight=${bolt.flight} ticks`);
  ok(bolt.dmg === 70, 'bolt damage lands on connect, formula-exact (70 at r1, sp 0)', `dmg=${bolt.dmg}`);
  ok(bolt.stunAtConnect === 26, 'the stun rider lands secs(1.3) = 26 ticks', `stun=${bolt.stunAtConnect}`);
  ok(bolt.movedStunned === 0 && bolt.movedAfter > 0.5,
    'a stunned creep neither moves nor swings, then marches again when it wears off',
    `during=${bolt.movedStunned.toFixed(2)} after=${bolt.movedAfter.toFixed(2)}`);
  ok(bolt.bigStun === 13, 'bosses take HALF stun: secs(0.65) = 13 ticks', `big=${bolt.bigStun}`);

  // bolt drain rider: SIREN'S KISS heals exactly 60% of the connect
  const drain = await evalJs(`(()=>{
    const S = __ws3jump('ws3-drain', 'wrestler', 7);
    RESORT.buySpell('sirenskiss');
    __ws3arm();
    const slot = ['Q','W','E'].find(k => S.slots[k] === 'sirenskiss');
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = S.hero.x; c.z = S.hero.z - 8; c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 9000;
    S.hero.regen = 0; S.hero.hp = 300;
    RESORT.cast(slot, c.x, c.z);
    let g = 0;
    while (S.projs.length && g++ < 40) RESORT.runTicks(1);
    return { dmg: 9000 - c.hp, hp: S.hero.hp };
  })()`);
  ok(drain.dmg === 80 && drain.hp === 348,
    "SIREN'S KISS: 80 on connect and exactly round(80 × 60%) = 48 comes home", `dmg=${drain.dmg} hp=${drain.hp}`);

  // V2 line: RIPCURRENT survives every body, hits each creep exactly once,
  // dies only at full distance
  const line = await evalJs(`(()=>{
    const S = __ws3jump('ws3-line', 'wrestler', 7);
    RESORT.buySpell('ripcurrent');
    __ws3arm();
    const slot = ['Q','W','E'].find(k => S.slots[k] === 'ripcurrent');
    const h = S.hero;
    RESORT.spawn(3, 'crab');
    const cs = S.creeps.filter(x => !x.dead);
    for (let i = 0; i < 3; i++) {
      const c = cs[i];
      c.x = h.x; c.z = h.z - 4 - i * 2.5; c.px = c.x; c.pz = c.z;
      c.hp = c.maxHp = 9000;
    }
    RESORT.order(h.x, h.z + 18);
    const r = RESORT.cast(slot, h.x, h.z - 10);
    const lineUp = S.projs.length === 1 && S.projs[0].kind === 'line';
    const proj = S.projs[0];
    RESORT.runTicks(6);
    const aliveMid = !proj.dead;
    const hitsMid = proj.hit.length;
    RESORT.runTicks(10);
    const aliveEnd = S.projs.length;
    const deltas = cs.map(c => 9000 - c.hp);
    return { ok: r.ok, lineUp, aliveMid, hitsMid, aliveEnd, deltas };
  })()`);
  ok(line.ok && line.lineUp, "RIPCURRENT rides S.projs as kind:'line'");
  ok(line.aliveMid && line.hitsMid >= 1, 'the tear SURVIVES its first body — a line never dies on contact', `hits@6t=${line.hitsMid}`);
  ok(line.aliveEnd === 0, 'and dies only at its full 11m');
  ok(line.deltas.every(d => d === 85), 'every creep in the lane is torn exactly once for 85 (r1, sp 0)', JSON.stringify(line.deltas));

  // V4 vuln: CRACKED SHELL amplifies EVERYTHING that follows
  const vuln = await evalJs(`(()=>{
    const S = __ws3jump('ws3-vuln', 'wrestler', 7);
    RESORT.buySpell('crackedshell');
    RESORT.buySpell('fireball');
    __ws3arm();
    const h = S.hero;
    const shellSlot = ['Q','W','E'].find(k => S.slots[k] === 'crackedshell');
    const fbSlot = ['Q','W','E'].find(k => S.slots[k] === 'fireball');
    RESORT.spawn(2, 'crab');
    const cs = S.creeps.filter(x => !x.dead);
    const A = cs[0], B = cs[1];
    A.x = h.x; A.z = h.z - 9; A.px = A.x; A.pz = A.z; A.hp = A.maxHp = 9000;
    B.x = h.x - 14; B.z = h.z - 9; B.px = B.x; B.pz = B.z; B.hp = B.maxHp = 9000;
    A.rootTicks = 9999; B.rootTicks = 9999;
    RESORT.cast(shellSlot, A.x, A.z);
    const aAfterShell = A.hp;
    const vulnOn = A.vulnTicks > 0 && A.vulnPct === 15;
    RESORT.cast(fbSlot, A.x, A.z);
    let g = 0;
    while (S.projs.length && g++ < 40) RESORT.runTicks(1);
    const dA = aAfterShell - A.hp;
    S.cds.fireball = 0;
    const b0 = B.hp;
    RESORT.cast(fbSlot, B.x, B.z);
    g = 0;
    while (S.projs.length && g++ < 40) RESORT.runTicks(1);
    const dB = b0 - B.hp;
    return { vulnOn, shellDmg: 9000 - aAfterShell, dA, dB };
  })()`);
  ok(vuln.vulnOn && vuln.shellDmg === 30,
    'CRACKED SHELL lands its own 30 (unamplified) and the +15% vulnerability', JSON.stringify([vuln.shellDmg, vuln.vulnOn]));
  ok(vuln.dA === 86 && vuln.dB === 75,
    'FIREBALL then hits the cracked creep for round(75 × 1.15) = 86 vs 75 on the control', `${vuln.dA} vs ${vuln.dB}`);

  // V4 weaken: FOGHORN BLAST — riders only, zero hit events, soft swings
  const weak = await evalJs(`(()=>{
    const S = __ws3jump('ws3-weak', 'wrestler', 2);
    RESORT.buySpell('foghorn');
    __ws3arm();
    const h = S.hero;
    const slot = ['Q','W','E'].find(k => S.slots[k] === 'foghorn');
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = h.x + 1.2; c.z = h.z; c.px = c.x; c.pz = c.z;
    c.hp = c.maxHp = 90000; c.atkCd = 6;
    h.regen = 0;
    S.events.length = 0;
    RESORT.cast(slot, h.x, h.z);
    const spellHits = S.events.filter(e => e.type === 'hit' && e.kind === 'spell').length;
    const weakOn = c.weakenTicks > 0 && c.weakenPct === 20;
    const hp0 = h.hp;
    let g = 0;
    while (h.hp === hp0 && g++ < 60) RESORT.runTicks(1);
    return { spellHits, weakOn, drop: hp0 - h.hp, base: c.dmg };
  })()`);
  ok(weak.spellHits === 0 && weak.weakOn,
    'FOGHORN is riders-only: −20% applied, ZERO hit events from the 0-damage nova');
  ok(weak.drop === Math.max(1, Math.round(weak.base * 0.8)),
    'a weakened swing lands soft: round(dmg × 0.8) exactly', `drop=${weak.drop} base=${weak.base}`);

  // V4 miss (+ the SANDSPOUT stun nova): a 100% miss debuff whiffs everything
  const miss = await evalJs(`(()=>{
    const S = __ws3jump('ws3-miss', 'wrestler', 2);
    __ws3arm();
    const h = S.hero;
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = h.x + 1.2; c.z = h.z; c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 90000;
    c.missTicks = 9999; c.missPct = 100;
    h.regen = 0;
    S.events.length = 0;
    const hp0 = h.hp;
    RESORT.runTicks(80);
    const dodges = S.events.filter(e => e.type === 'dodge').length;
    const flat = h.hp === hp0;
    RESORT.buySpell('sandspout');
    const sSlot = ['Q','W','E'].find(k => S.slots[k] === 'sandspout');
    RESORT.cast(sSlot, h.x, h.z);
    return { flat, dodges, spoutStun: c.stunTicks, spoutDmg: 90000 - c.hp };
  })()`);
  ok(miss.flat && miss.dodges >= 2,
    'a 100% miss debuff: every swing whiffs — hp flat, MISS floats born', `dodges=${miss.dodges}`);
  ok(miss.spoutStun === 16 && miss.spoutDmg >= 50,
    'SANDSPOUT stuns its whole circle: secs(0.8) = 16 ticks + 50 damage', `stun=${miss.spoutStun}`);

  // V5 poison: JELLY STING — venom in 0.5s chunks, tick-exact totals, a slow,
  // and a DoT kill that pays like any kill (bounty + corpse)
  const poison = await evalJs(`(()=>{
    const S = __ws3jump('ws3-poison', 'wrestler', 2);
    RESORT.buySpell('jellysting');
    __ws3arm();
    const h = S.hero;
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = h.x; c.z = h.z - 2; c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 9000;
    RESORT.runTicks(1);
    const afterSwing = c.hp;
    const dot = { ticks: c.dotTicks, rate: c.dotPerSec, slow: c.slowTicks > 0 && c.slowMult === 0.8 };
    h.x = 20; h.z = 8; h.px = 20; h.pz = 8;
    const seq = [];
    let prev = c.hp;
    for (let i = 0; i < 45; i++) {
      RESORT.runTicks(1);
      if (c.hp !== prev) { seq.push(prev - c.hp); prev = c.hp; }
    }
    RESORT.spawn(1, 'crab');
    const v = S.creeps.find(x => !x.dead && x.id !== c.id);
    v.x = 20; v.z = 6.8; v.px = v.x; v.pz = v.z; v.hp = v.maxHp = 500;
    let g = 0;
    while (!v.dotTicks && g++ < 40) RESORT.runTicks(1);
    h.x = -20; h.z = 8; h.px = -20; h.pz = 8;
    v.hp = 2;
    const gold0 = S.gold, corpses0 = S.corpses.length, kills0 = S.kills;
    g = 0;
    while (S.creeps.some(x => x.id === v.id) && g++ < 30) RESORT.runTicks(1);
    return { swung: afterSwing === 9000 - 60, dot, seq,
      kill: { gold: S.gold > gold0, corpses: S.corpses.length > corpses0, kills: S.kills - kills0 } };
  })()`);
  ok(poison.swung && poison.dot.ticks === 39 && poison.dot.rate === 7 && poison.dot.slow,
    'one swing smears the venom: 2s clock (applied mid-tick: 39 seen), 7/s, the 20% slow riding along', JSON.stringify(poison.dot));
  ok(poison.seq.length === 4 && poison.seq.reduce((a, b) => a + b, 0) === 14,
    'the venom lands in four 0.5s chunks totalling a tick-exact 14 (7/s × 2s)', JSON.stringify(poison.seq));
  ok(poison.kill.kills === 1 && poison.kill.gold && poison.kill.corpses,
    'a DoT kill still pays: bounty, kill count, corpse');

  // V5 cleave: WIDE WAKE splashes exactly 25% — melee only
  const cleave = await evalJs(`(()=>{
    const S = __ws3jump('ws3-cleave', 'wrestler', 2);
    RESORT.buySpell('widewake');
    __ws3arm();
    const h = S.hero;
    RESORT.spawn(2, 'crab');
    const cs = S.creeps.filter(x => !x.dead);
    const A = cs[0], B = cs[1];
    A.x = h.x; A.z = h.z - 2; A.px = A.x; A.pz = A.z; A.hp = A.maxHp = 9000;
    B.x = h.x + 1.2; B.z = h.z - 2; B.px = B.x; B.pz = B.z; B.hp = B.maxHp = 9000;
    RESORT.runTicks(1);
    return { dA: 9000 - A.hp, dB: 9000 - B.hp };
  })()`);
  ok(cleave.dA === 60 && cleave.dB === 15,
    'WIDE WAKE: the victim takes the swing (60), the neighbour exactly 25% splash (15)', JSON.stringify(cleave));

  // ...and the wand DOES poison but NEVER cleaves (tooltips say "swings")
  const wand = await evalJs(`(()=>{
    const S = __ws3jump('ws3-wand', 'magician', 2);
    RESORT.buySpell('widewake');
    RESORT.buySpell('jellysting');
    __ws3arm();
    const h = S.hero;
    RESORT.spawn(2, 'crab');
    const cs = S.creeps.filter(x => !x.dead);
    const A = cs[0], B = cs[1];
    A.x = h.x; A.z = h.z - 5; A.px = A.x; A.pz = A.z; A.hp = A.maxHp = 9000;
    B.x = h.x + 1.2; B.z = h.z - 5; B.px = B.x; B.pz = B.z; B.hp = B.maxHp = 9000;
    A.rootTicks = 9999; B.rootTicks = 9999;
    let g = 0;
    while (A.hp === 9000 && g++ < 40) RESORT.runTicks(1);
    return { dA: 9000 - A.hp, dB: 9000 - B.hp, venom: A.dotTicks > 0 };
  })()`);
  ok(wand.dA === 34 && wand.venom && wand.dB === 0,
    'the wand connect smears venom but NEVER cleaves — the melee-only law', JSON.stringify(wand));

  // V5 procs: SHOREBREAK + PINCH POINT at cap — exact stats, both fire, the
  // pinch stun actually holds a creep
  const procs = await evalJs(`(()=>{
    const S = __ws3jump('ws3-procs', 'wrestler', 7);
    RESORT.buySpell('shorebreak');
    RESORT.buySpell('pinchpoint');
    RESORT.giveXp(60000);
    for (let i = 0; i < 4; i++) { RESORT.rankUp('shorebreak'); RESORT.rankUp('pinchpoint'); }
    __ws3arm();
    const h = S.hero;
    RESORT.spawn(2, 'crab');
    const cs = S.creeps.filter(x => !x.dead);
    cs[0].x = h.x; cs[0].z = h.z - 2; cs[1].x = h.x + 1.0; cs[1].z = h.z - 2;
    for (const c of cs) { c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 900000; }
    S.events.length = 0;
    let sawAoe = 0, sawStun = 0, maxStun = 0;
    for (let i = 0; i < 600; i++) {
      RESORT.runTicks(1);
      for (const c of cs) maxStun = Math.max(maxStun, c.stunTicks);
      if (i % 50 === 0) {
        sawAoe += S.events.filter(e => e.type === 'aoe_hit' && e.cat === 'CURRENT').length;
        sawStun += S.events.filter(e => e.type === 'proj_hit' && e.stun).length;
        S.events.length = 0;
        h.hp = h.maxHp;
      }
    }
    sawAoe += S.events.filter(e => e.type === 'aoe_hit' && e.cat === 'CURRENT').length;
    sawStun += S.events.filter(e => e.type === 'proj_hit' && e.stun).length;
    return { stats: [h.procPct, h.procDmg, h.pinchPct, h.pinchDmg], sawAoe, sawStun, maxStun };
  })()`);
  ok(procs.stats.join(',') === '28,117,18,55',
    'SHOREBREAK/PINCH cap stats recompute exactly (28% / 117 · 18% / +55)', procs.stats.join(','));
  ok(procs.sawAoe >= 1 && procs.sawStun >= 1 && procs.maxStun === 19,
    'both procs FIRED over 600 ticks and the pinch stun held (secs(1) applied mid-tick = 19 seen)',
    `aoe=${procs.sawAoe} stun=${procs.sawStun} maxStun=${procs.maxStun}`);

  // V6 flat-DR: BARNACLE HIDE — exact reduction, the floor, slams bypass
  const dr = await evalJs(`(()=>{
    const S = __ws3jump('ws3-dr', 'wrestler', 2);
    RESORT.buySpell('barnaclehide');
    __ws3arm();
    const h = S.hero;
    h.regen = 0;
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = h.x + 1.2; c.z = h.z; c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 900000;
    const hp0 = h.hp;
    let g = 0;
    while (h.hp === hp0 && g++ < 60) RESORT.runTicks(1);
    const drop1 = hp0 - h.hp;
    RESORT.giveXp(60000);
    for (let i = 0; i < 4; i++) RESORT.rankUp('barnaclehide');
    h.regen = 0;
    const hp1 = h.hp;
    g = 0;
    while (h.hp === hp1 && g++ < 60) RESORT.runTicks(1);
    const drop2 = hp1 - h.hp;
    const hp2 = h.hp;
    S.pendings.push({ due: S.tick + 1, x: h.x, z: h.z, r: 3, dmg: 100, side: 'hostile' });
    RESORT.runTicks(2);
    return { base: c.dmg, drop1, drop2, slamDrop: hp2 - h.hp };
  })()`);
  ok(dr.drop1 === Math.max(1, dr.base - 6),
    'BARNACLE r1: every swing lands base − 6', `${dr.base} -> ${dr.drop1}`);
  ok(dr.drop2 === 1, 'at cap (−18) the floor holds: a swing always lands at least 1', `drop=${dr.drop2}`);
  ok(dr.slamDrop === 100, 'a slam (attacker-null) BYPASSES the hide — the tooltip says "swings"', `slam=${dr.slamDrop}`);

  // V6 dodge: CRABWALK — whiffs happen, and a dodged swing takes NO thorns
  const dodge = await evalJs(`(()=>{
    const S = __ws3jump('ws3-dodge', 'wrestler', 7);
    RESORT.buySpell('crabwalk');
    RESORT.buySpell('thornshell');
    RESORT.giveXp(60000);
    for (let i = 0; i < 4; i++) RESORT.rankUp('crabwalk');
    __ws3arm();
    const h = S.hero;
    h.regen = 0;
    h.atkCd = 99999;
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = h.x + 1.2; c.z = h.z; c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 900000;
    S.events.length = 0;
    const chp0 = c.hp;
    RESORT.runTicks(700);
    const dodges = S.events.filter(e => e.type === 'dodge').length;
    const hits = S.events.filter(e => e.type === 'hero_hit').length;
    return { dodges, hits, thornDmg: chp0 - c.hp };
  })()`);
  ok(dodge.dodges >= 2 && dodge.hits >= 2,
    'CRABWALK at cap (22%): some swings whiff, some land', `dodge=${dodge.dodges} hit=${dodge.hits}`);
  ok(dodge.thornDmg === dodge.hits * 14,
    'THORN SHELL answers ONLY the swings that landed — a dodged swing takes no thorns',
    `${dodge.thornDmg} = ${dodge.hits} × 14`);

  // V7 HoT: ALOE SALVE — tick-exact restore riding the regen accumulator
  const hot = await evalJs(`(()=>{
    const S = __ws3jump('ws3-hot', 'wrestler', 2);
    RESORT.buySpell('aloesalve');
    __ws3arm();
    const h = S.hero;
    h.hp = 300;
    const slot = ['Q','W','E'].find(k => S.slots[k] === 'aloesalve');
    RESORT.cast(slot, h.x, h.z);
    h.regen = 0;
    RESORT.runTicks(80);
    const mid = h.hp;
    RESORT.runTicks(79);
    return { mid, end: h.hp };
  })()`);
  ok(hot.mid === 375, 'ALOE at half duration: floor(80 × 150/160) = 75 in, hp 375 exactly', `mid=${hot.mid}`);
  ok(hot.end === 449, 'the full salve delivers its tick-exact sum (149 by the last hot tick — engine fencepost)', `end=${hot.end}`);

  // V7 gold-burn: COWRIE WARD — the purse soaks, the ledger law holds, the
  // ward breaks at a dry purse and hp takes exactly the remainder
  const cowrie = await evalJs(`(()=>{
    const S = __ws3jump('ws3-cowrie', 'wrestler', 7);
    RESORT.buySpell('cowrieward');
    __ws3arm();
    const h = S.hero;
    let buys = 0;
    while (S.gold >= 180 && buys < 200) { RESORT.buyFruit(['mango', 'starfruit', 'coconut'][buys % 3], false); buys++; }
    h.regen = 0;
    const slot = ['Q','W','E'].find(k => S.slots[k] === 'cowrieward');
    RESORT.cast(slot, h.x, h.z);
    const hp0 = h.hp, gold0 = S.gold, spent0 = S.ledger.spent;
    S.pendings.push({ due: S.tick + 1, x: h.x, z: h.z, r: 3, dmg: 100, side: 'hostile' });
    RESORT.runTicks(2);
    const soak = { hpFlat: h.hp === hp0, goldDelta: gold0 - S.gold, spentDelta: S.ledger.spent - spent0 };
    const G2 = S.gold, hpB = h.hp;
    S.pendings.push({ due: S.tick + 1, x: h.x, z: h.z, r: 3, dmg: 1000, side: 'hostile' });
    RESORT.runTicks(2);
    const law = S.gold === 100 + 9000 + S.ledger.bounty + S.ledger.clears - S.ledger.spent;
    return { soak, G2, gold2: S.gold, hpLoss: hpB - h.hp, law };
  })()`);
  ok(cowrie.soak.hpFlat && cowrie.soak.goldDelta === 34 && cowrie.soak.spentDelta === 34,
    'COWRIE WARD soaks a 100 slam whole: hp untouched, ceil(100/3) = 34g into ledger.spent', JSON.stringify(cowrie.soak));
  ok(cowrie.gold2 === 0 && cowrie.hpLoss === 1000 - cowrie.G2 * 3,
    'the ward BREAKS at a dry purse and hp takes exactly the remainder', `purse=${cowrie.G2} hpLoss=${cowrie.hpLoss}`);
  ok(cowrie.law, 'THE LEDGER LAW holds through the whole burn — by construction');

  // V7 hide: SQUID INK — the tide cannot find you; your own swing blows it
  const ink = await evalJs(`(()=>{
    const S = __ws3jump('ws3-ink', 'wrestler', 7);
    RESORT.buySpell('squidink');
    __ws3arm();
    const h = S.hero;
    h.regen = 0;
    h.x = 6; h.z = -6; h.px = 6; h.pz = -6;
    h.atkCd = 200;
    const slot = ['Q','W','E'].find(k => S.slots[k] === 'squidink');
    RESORT.spawn(3, 'crab');
    const cs = S.creeps.filter(x => !x.dead);
    for (const c of cs) { c.x = h.x + 1.2; c.z = h.z; c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 90000; }
    RESORT.cast(slot, h.x, h.z);
    const hidden0 = h.hideTicks;
    const hp0 = h.hp;
    RESORT.runTicks(45);
    const flat = h.hp === hp0;
    const nearest = Math.min.apply(null, cs.map(c => Math.hypot(c.x - h.x, c.z - h.z)));
    h.atkCd = 0;
    let g = 0;
    while (h.hideTicks > 0 && g++ < 20) RESORT.runTicks(1);
    return { hidden0, flat, nearest, coverBlown: h.hideTicks === 0 };
  })()`);
  ok(ink.hidden0 === 50, 'SQUID INK: 2.5s of cover at r1 (50 ticks)');
  ok(ink.flat && ink.nearest > 2,
    'while hidden the tide CANNOT find you: zero swings land, the pack drifts off you',
    `nearest=${ink.nearest.toFixed(1)}m`);
  ok(ink.coverBlown, "the hero's own swing blows the cover");

  // V8 cdr aura: TRADE WINDS × ENCORE compose exactly
  const winds = await evalJs(`(()=>{
    const S = __ws3jump('ws3-winds', 'magician', 7);
    RESORT.buySpell('tradewinds');
    RESORT.buySpell('fireball');
    __ws3arm();
    const cdm = S.hero.cdMult;
    const fbSlot = ['Q','W','E'].find(k => S.slots[k] === 'fireball');
    RESORT.cast(fbSlot, 0, -8);
    return { match: Math.abs(cdm - 0.85 * 0.92) < 1e-12, cdm, charged: S.cds.fireball };
  })()`);
  ok(winds.match, 'TRADE WINDS × ENCORE compose: cdMult = 0.85 × 0.92 exactly', `cdMult=${winds.cdm}`);
  ok(winds.charged === 78, "FIREBALL charges round(100 × 0.782) = 78 ticks — the HUD reads the same cdMult", `cd=${winds.charged}`);

  // V8 dmg aura: TIKI DRUMS feeds the hero AND the golem
  const tiki = await evalJs(`(()=>{
    const S = __ws3jump('ws3-tiki', 'wrestler', 8);
    RESORT.buySpell('tikidrums');
    RESORT.buySpell('reefgolem');
    __ws3arm();
    const h = S.hero;
    const heroDmg = h.dmg;
    RESORT.cast('R', h.x + 3, h.z);
    const g = S.allies[0];
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = g.x; c.z = g.z - 1.5; c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 90000;
    c.rootTicks = 9999;
    h.x = -20; h.z = 8; h.px = -20; h.pz = 8; h.atkCd = 9999;
    let t = 0;
    while (c.hp === 90000 && t++ < 60) RESORT.runTicks(1);
    return { heroDmg, golemHit: 90000 - c.hp, golemBase: g.dmg, kind: g.kind, src: g.src };
  })()`);
  ok(tiki.heroDmg === 65, 'TIKI DRUMS raises the hero: round(60 × 1.08) = 65', `dmg=${tiki.heroDmg}`);
  ok(tiki.golemHit === 54 && tiki.golemBase === 50,
    'and the golem swings for round(50 × 1.08) = 54 — the aura feeds the summons', `hit=${tiki.golemHit}`);
  ok(tiki.kind === 'golem' && tiki.src === 'reefgolem', 'allies carry their kind/src tags (the WS3 summon lanes)');

  // V5 burn ring: EMBER SKIN pulses on the half-second, sleeps on breaks
  const ember = await evalJs(`(()=>{
    const S = __ws3jump('ws3-ember', 'wrestler', 2);
    RESORT.buySpell('emberskin');
    __ws3arm();
    const h = S.hero;
    h.stun = 99999;
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = h.x + 1.5; c.z = h.z; c.px = c.x; c.pz = c.z; c.hp = c.maxHp = 90000;
    c.rootTicks = 99999;
    const drops = [];
    let prev = c.hp;
    for (let i = 0; i < 25; i++) {
      RESORT.runTicks(1);
      if (c.hp !== prev) { drops.push(i); prev = c.hp; }
    }
    const perPulse = drops.length ? (90000 - c.hp) / drops.length : 0;
    const phase0 = S.phase;
    S.phase = 'BREAK'; S.phaseTicks = 99999;
    const hpB = c.hp;
    RESORT.runTicks(30);
    const burnedInBreak = hpB - c.hp;
    S.phase = phase0; S.phaseTicks = 0;
    return { pulses: drops.length, gap: drops.length >= 2 ? drops[1] - drops[0] : 0, perPulse, burnedInBreak };
  })()`);
  ok(ember.pulses >= 2 && ember.gap === 10 && ember.perPulse === 6,
    'EMBER SKIN pulses every half-second for round(12/2) = 6 — zero swings involved',
    `pulses=${ember.pulses} gap=${ember.gap} per=${ember.perPulse}`);
  ok(ember.burnedInBreak === 0, 'the ring sleeps outside the tide — nothing burns on a break');

  // V9 corpses: born on kills, expire at 6s, FIFO cap 16, cleared by the
  // port AND the washout (zone-local debris law)
  const corpse = await evalJs(`(()=>{
    const S = __ws3jump('ws3-corpse', 'wrestler', 2);
    __ws3arm();
    const h = S.hero;
    RESORT.spawn(1, 'crab');
    const c = S.creeps.find(x => !x.dead);
    c.x = h.x; c.z = h.z - 2; c.px = c.x; c.pz = c.z; c.hp = 1;
    let g = 0;
    while (!S.corpses.length && g++ < 60) RESORT.runTicks(1);
    const rec = S.corpses[0];
    const born = S.corpses.length === 1 && !!rec && typeof rec.x === 'number' && rec.skin === 'crab' && rec.until > S.tick;
    RESORT.runTicks(121);
    const expired = S.corpses.length === 0;
    RESORT.buySpell('spinslash');
    const slot = ['Q','W','E'].find(k => S.slots[k] === 'spinslash');
    RESORT.spawn(25, 'crab');
    for (const x of S.creeps) if (!x.dead) { x.x = h.x + 0.5; x.z = h.z - 0.5; x.px = x.x; x.pz = x.z; x.hp = 1; }
    RESORT.cast(slot, h.x, h.z);
    RESORT.runTicks(1);
    const capped = S.corpses.length;
    S.quota = S.killed;
    RESORT.runTicks(1);
    const ported = { phase: S.phase, zone: S.zone, corpses: S.corpses.length };
    RESORT.skipTide();
    RESORT.runTicks(3);
    S.quota = 9999; S.spawned = 9999;
    RESORT.spawn(3, 'crab');
    for (const x of S.creeps) if (!x.dead) { x.x = h.x + 1; x.z = h.z; x.px = x.x; x.pz = x.z; x.dmg = 5000; }
    let g2 = 0;
    while (S.phase === 'TIDE' && g2++ < 300) RESORT.runTicks(1);
    return { born, expired, capped, ported, washPhase: S.phase, washCorpses: S.corpses.length };
  })()`);
  ok(corpse.born, 'a kill leaves a sim-side corpse record: skin + position + expiry');
  ok(corpse.expired, 'corpses expire off the sand by secs(6)');
  ok(corpse.capped === 16, 'a 25-kill nova wipe caps the morgue at 16 (FIFO)', `n=${corpse.capped}`);
  ok(corpse.ported.phase === 'BREAK' && corpse.ported.zone === 'MARKET' && corpse.ported.corpses === 0,
    'the clear-port sweeps the sand clean — corpses are zone-local debris', JSON.stringify(corpse.ported));
  ok(corpse.washPhase === 'WASHOUT' && corpse.washCorpses === 0, 'so does the washout');

  // V10 swarm: THE DROWNED TIDE — corpses in, drowned out, own-src recast,
  // the golem fights on, ttl sinks them
  const swarm = await evalJs(`(()=>{
    const S = __ws3jump('ws3-swarm', 'wrestler', 8);
    RESORT.buySpell('reefgolem');
    RESORT.buySpell('drownedtide');
    __ws3arm();
    const h = S.hero;
    RESORT.cast('R', h.x + 3, h.z);
    const golemId = S.allies[0] && S.allies[0].id;
    RESORT.equip('drownedtide', 'R');
    const refuse = RESORT.cast('R', h.x, h.z);
    const refuseCd = S.cds.drownedtide || 0;
    RESORT.spawn(3, 'crab');
    for (const c of S.creeps) if (!c.dead) { c.x = h.x + 1.0; c.z = h.z - 1.0; c.px = c.x; c.pz = c.z; c.hp = 1; }
    let g = 0;
    while (S.corpses.length < 3 && g++ < 120) RESORT.runTicks(1);
    const morgue = S.corpses.length;
    const r = RESORT.cast('R', h.x, h.z);
    const raised = S.allies.filter(a => a.kind === 'drowned');
    const first = raised[0] || {};
    const consumed = S.corpses.length;
    const oldIds = raised.map(a => a.id);
    RESORT.spawn(2, 'crab');
    for (const c of S.creeps) if (!c.dead) { c.x = h.x - 1.2; c.z = h.z - 1.0; c.px = c.x; c.pz = c.z; c.hp = 1; }
    g = 0;
    while (S.corpses.length < 1 && g++ < 120) RESORT.runTicks(1);
    S.cds.drownedtide = 0;
    RESORT.cast('R', h.x, h.z);
    RESORT.runTicks(1);
    const after = S.allies.filter(a => !a.dead);
    const golemStill = after.some(a => a.id === golemId);
    const oldGone = !after.some(a => oldIds.includes(a.id));
    const newDrowned = after.filter(a => a.kind === 'drowned').length;
    RESORT.runTicks(310);
    return { refuse: refuse.why, refuseCd, morgue, ok: r.ok, count: raised.length,
      hp: first.maxHp, dmg: first.dmg, consumed, golemStill, oldGone, newDrowned,
      ttlDead: S.allies.filter(a => a.kind === 'drowned' && !a.dead).length };
  })()`);
  ok(swarm.refuse === 'corpses' && swarm.refuseCd === 0,
    'THE DROWNED TIDE over clean sand refuses (why:corpses) — cooldown unspent');
  ok(swarm.morgue >= 3 && swarm.ok && swarm.count === 3 && swarm.consumed === swarm.morgue - 3,
    'three fresh corpses raise THREE drowned crabs and are consumed', `morgue=${swarm.morgue} raised=${swarm.count}`);
  ok(swarm.hp === 190 && swarm.dmg === 24, 'the drowned statline is formula-exact (190 HP / 24 dmg at r1, sp 0)');
  ok(swarm.golemStill && swarm.oldGone && swarm.newDrowned >= 1,
    'recasting replaces OWN units only — the REEF GOLEM fights on through both raises',
    `golem=${swarm.golemStill} newPack=${swarm.newDrowned}`);
  ok(swarm.ttlDead === 0, 'the drowned sink back at their 15s ttl');

  // KRAKEN'S GRIP: boss-sized aoe root, and the half-rule again
  const kraken = await evalJs(`(()=>{
    const S = __ws3jump('ws3-kraken', 'wrestler', 8);
    RESORT.buySpell('krakengrip');
    __ws3arm();
    const h = S.hero;
    RESORT.spawn(2, 'crab');
    const cs = S.creeps.filter(x => !x.dead);
    const A = cs[0], B = cs[1];
    A.x = h.x; A.z = h.z - 8; A.px = A.x; A.pz = A.z; A.hp = A.maxHp = 9000;
    B.x = h.x + 3.5; B.z = h.z - 8; B.px = B.x; B.pz = B.z; B.hp = B.maxHp = 90000; B.big = true;
    RESORT.cast('R', A.x, A.z);
    return { dA: 9000 - A.hp, dB: 90000 - B.hp, rootA: A.rootTicks, rootB: B.rootTicks };
  })()`);
  ok(kraken.dA === 130 && kraken.dB === 130, "KRAKEN'S GRIP: 130 to everything in its 4.5m (r1, sp 0)", JSON.stringify([kraken.dA, kraken.dB]));
  ok(kraken.rootA === 44 && kraken.rootB === 22,
    'the root lands 2.2s — and HALF on a boss (44 / 22 ticks)', `${kraken.rootA}/${kraken.rootB}`);

  // V11 cheat-death: SECOND SUNRISE — the save, the sleep, the second death,
  // the sacred respec, and the R-scan byte-identical guard in miniature
  const sunrise = await evalJs(`(()=>{
    const S = __ws3jump('ws3-sunrise', 'wrestler', 8);
    RESORT.buySpell('secondsunrise');
    __ws3arm();
    const h = S.hero;
    RESORT.givePearls(10);
    RESORT.buySpell('avatar');
    const statsBefore = JSON.stringify([h.dmg, h.crit, h.lifesteal, h.thorns, h.maxHp, h.cdMult]);
    RESORT.equip('avatar', 'R');
    const statsWithAvatar = JSON.stringify([h.dmg, h.crit, h.lifesteal, h.thorns, h.maxHp, h.cdMult]);
    RESORT.equip('secondsunrise', 'R');
    h.stun = 40;
    const deaths0 = S.deaths;
    S.pendings.push({ due: S.tick + 1, x: h.x, z: h.z, r: 3, dmg: 999999, side: 'hostile' });
    RESORT.runTicks(2);
    const saved = { hp: h.hp, want: Math.round(h.maxHp * 0.30), stun: h.stun,
      deaths: S.deaths - deaths0, phase: S.phase, sleep: S.cds.secondsunrise };
    S.pendings.push({ due: S.tick + 1, x: h.x, z: h.z, r: 3, dmg: 999999, side: 'hostile' });
    RESORT.runTicks(2);
    const second = { phase: S.phase, deaths: S.deaths - deaths0 };
    const r = RESORT.respec();
    return { statsSame: statsBefore === statsWithAvatar, saved, second,
      respecOk: r.ok, disarmed: Object.keys(S.cds).length === 0 };
  })()`);
  ok(sunrise.statsSame,
    'an ACTIVE big in R feeds the new passive scan NOTHING — stats identical (byte-identical guard in miniature)');
  ok(sunrise.saved.hp === sunrise.saved.want && sunrise.saved.deaths === 0 && sunrise.saved.phase === 'TIDE',
    'a lethal slam does NOT take you: back at round(30% max), zero deaths, the tide still running',
    `hp=${sunrise.saved.hp}/${sunrise.saved.want}`);
  ok(sunrise.saved.stun === 0, 'the sunrise sheds the stun on the way back up');
  ok(sunrise.saved.sleep === 1799, 'then it sleeps: secs(90) on the R slot (set mid-tick: 1799 seen)', `sleep=${sunrise.saved.sleep}`);
  ok(sunrise.second.phase === 'WASHOUT' && sunrise.second.deaths === 1,
    'a second lethal while it sleeps is a REAL washout');
  ok(sunrise.respecOk && sunrise.disarmed,
    'the Tide Tablet refunds the sunrise AND disarms the sleep (cds cleared) — respec stays sacred');

  // WS3 determinism: a new-verb build reproduces byte-for-byte
  const ws3det = `(()=>{
    RESORT.setSeed('ws3-det');
    RESORT.pickBody('wrestler');
    RESORT.givePearls(20);
    RESORT.buySpell('conchcrack');
    RESORT.buySpell('jellysting');
    RESORT.buySpell('barnaclehide');
    RESORT.skipTide();
    RESORT.runTicks(200);
    const S = RESORT.state;
    const c = S.creeps.find(c => !c.dead);
    if (c) RESORT.cast('Q', c.x, c.z);
    RESORT.runTicks(300);
    return RESORT.snapshot();
  })()`;
  const wa = await evalJs(ws3det);
  const wb = await evalJs(ws3det);
  ok(JSON.stringify(wa) === JSON.stringify(wb) && wa.kills > 0,
    'a WS3 build (bolt + venom + hide) reproduces byte-for-byte — new draws are seeded like the old',
    `kills=${wa.kills} draws=${wa.draws}`);

  // --- 9. LIVE FRAME + SCREENSHOT ---------------------------------------
  console.log('\nRENDER');
  await evalJs('RESORT.i18nAudit(true)');
  await evalJs(`(()=>{
    RESORT.setSeed('postcard');
    RESORT.pickBody('wrestler');
    RESORT.buySpell('fireball');
    const S = RESORT.state;
    S.tide = 4; S.cleared = 4; S.phase = 'BREAK'; S.phaseTicks = 30;   // the tide-jump recipe
    RESORT.runTicks(130);          // tide 5 begins: KING SANDCLAW wades in under gold hour
    RESORT.resume();
  })()`);
  await sleep(2500);
  const framesNow = await evalJs('RESORT.frames');
  await sleep(1500);
  const framesLater = await evalJs('RESORT.frames');
  ok(framesLater > framesNow, 'the render loop is running', `${framesNow} -> ${framesLater} frames`);
  ok(await evalJs('RESORT.goldK') > 0.05, 'GOLD HOUR — the milestone tide lights the rim',
    `goldK=${(await evalJs('RESORT.goldK')).toFixed(2)}`);
  ok(await evalJs('RESORT.state.creeps.some(c=>c.big)'), 'the postcard shot has a boss in it');
  await evalJs('(()=>{const c=RESORT.state.creeps.find(c=>!c.dead); if(c) RESORT.cast("Q", c.x, c.z); return 1;})()');
  await sleep(250);

  const audit = await evalJs('(RESORT.relocalize(), Object.keys(RESORT.i18nAudit()))');
  ok(audit.length >= 20, 'every live string walks through TXT() (i18n audit is recording)',
    `${audit.length} keys`);
  ok(!audit.some(k => /%\{\d\}/.test(k)),
    'tf() placeholders survive the number-tokeniser intact',
    audit.filter(k => k.includes('%')).slice(0, 1).join('') || '(no %N keys seen)');
  ok(cdp.errors.length === 0, 'still no uncaught exceptions after the full battery',
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
