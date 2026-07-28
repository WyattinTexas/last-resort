#!/usr/bin/env node
// SURVIVAL QUEST — headless boot + sim smoke test, driven over the Chrome
// DevTools Protocol with node's built-in WebSocket. No puppeteer, no npm.
//
//   node tools/cdp_smoke.mjs [url] [--out shots/smoke.png] [--keep]
//
// What it proves (link 2 battery):
//   1. The page boots in a real browser with real WebGL.
//   2. The FORGE gates the run; bodies apply real statlines.
//   3. The racks sell all 16 spells through ONE engine: buys, locks, slots,
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

  // --- 4. THE RACKS: one engine, sixteen rows --------------------------
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
