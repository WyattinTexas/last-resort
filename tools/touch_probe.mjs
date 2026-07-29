#!/usr/bin/env node
// SURVIVAL QUEST — touch-layer probe at an iPhone-class viewport (844x390).
// Real dispatched touch taps (Input.dispatchTouchEvent), not element.click():
// this proves hit-testing, z-order and pointer-events, not just handlers.
//
//   node tools/touch_probe.mjs [url] [shotDir]
//
// WS2 charter — the context-sensitive HUD on glass:
//   zero-buttons law (fresh run mid-tide shows NO buttons), the collapsed
//   race strip + its tap-through tripwire, progressive QWER (slot count =
//   slotted spells), occupied-only item chips, the herobox as the castaway
//   door, compact calm panels with their mute buttons, the 60px thumb audit,
//   safe areas, and the SwiftShader perf floor.
//
// House law: --mute-audio always; kills its browser on the way out.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ARG = process.argv[2] || 'http://127.0.0.1:8791/';
const SHOT_DIR = process.argv[3] ? resolve(process.argv[3]) : join(ROOT, 'shots');
const PORT = 9231;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'survivalquest-touch-'));

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
  '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--window-size=844,390',
  '--hide-scrollbars',
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
    const errors = [];
    ws.onopen = () => res({ send, errors });
    ws.onerror = () => rej(new Error('ws error'));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { rs, rj } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rj(new Error(JSON.stringify(m.error))) : rs(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        errors.push(d.exception?.description || d.text || 'unknown exception');
      }
    };
    function send(method, params) {
      const mid = ++id;
      return new Promise((rs, rj) => {
        pending.set(mid, { rs, rj });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rj(new Error(method + ' timed out')); } }, 60000);
      });
    }
  });
}

const main = async () => {
  console.log(`\nSURVIVAL QUEST — touch probe (WS2 context-sensitive HUD)\n  url ${URL_ARG}\n  dir ${SHOT_DIR}\n`);
  mkdirSync(SHOT_DIR, { recursive: true });
  const cdp = await connect(await findTarget());
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  // iPhone-class: mobile metrics + touch. pointer:coarse and ontouchstart
  // both come from these two, which is exactly what IS_TOUCH sniffs.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 844, height: 390, deviceScaleFactor: 2, mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const tap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const rectOf = async (sel) => evalJs(`(() => { const e = document.querySelector('${sel}');
    if (!e) return null; const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
  const tapEl = async (sel) => {
    const c = await rectOf(sel);
    if (!c) throw new Error('no element ' + sel);
    await tap(c.cx, c.cy);
    return c;
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOT_DIR, name), Buffer.from(r.data, 'base64'));
    console.log('  shot  ' + name);
  };
  // UI state settles on a rAF, and SwiftShader frames can run ~10fps headless:
  // POLL, never sleep-assert (rev-1 gotcha 7).
  const poll = async (expr, tries = 40, gap = 100) => {
    for (let i = 0; i < tries; i++) {
      if (await evalJs(expr).catch(() => false)) return true;
      await sleep(gap);
    }
    return false;
  };
  const hidden = sel => `getComputedStyle(document.querySelector('${sel}')).display === 'none'`;
  const visible = sel => `getComputedStyle(document.querySelector('${sel}')).display !== 'none'`;

  await cdp.send('Page.navigate', { url: URL_ARG });
  for (let i = 0; i < 120; i++) {
    if (await evalJs('!!(window.RESORT && RESORT.ready)').catch(() => false)) break;
    await sleep(500);
  }

  // --- 1. BOOT: the phone shell reality --------------------------------
  console.log('BOOT');
  ok(await evalJs('RESORT.ready'), 'game boots at 844x390 mobile');
  ok(await evalJs(`document.body.classList.contains('touch')`), 'IS_TOUCH detected -> body.touch');
  ok(await evalJs(`RESORT.ui.phaseAttr`) === 'FORGE', 'data-phase stamps FORGE at boot');
  ok(await evalJs('RESORT.ui.standingsCollapsed') === true, 'standings boot COLLAPSED at a phone height');

  // title PLAY by real tap
  await tapEl('#title-play');
  ok(await poll('!RESORT.titleUp', 20), 'tap PLAY dismisses the title');
  await evalJs('RESORT.pause(true)');

  // forge card by real tap
  ok(await poll(visible('#forge'), 20), 'the Forge overlay is up');
  await sleep(200);
  await tapEl('.bodycard');
  ok(await poll('!!RESORT.state.bodyId', 20), 'tap a Forge card picks the body',
    String(await evalJs('RESORT.state.bodyId')));
  ok(await poll(`RESORT.ui.phaseAttr === 'BREAK'`, 20), 'data-phase walks to BREAK with the pick');

  // --- 2. THE FIRST BREAK: compact calm panel + its mute ----------------
  console.log('\nBREAK — compact panel, mute, herobox door');
  ok(await poll(visible('#break-panel'), 20) && await evalJs(`document.getElementById('break-panel').classList.contains('show')`),
    'the shop-break panel is up');
  await sleep(400);   // let the panel's .2s show-transition (scale .97 -> 1) settle before measuring
  const tf = await evalJs(`parseFloat(getComputedStyle(document.getElementById('break-timer')).fontSize)`);
  ok(tf <= 40, 'compact form: the break timer is <= 40px at 390pt', tf + 'px');
  ok(await evalJs(hidden('#shop-stub')), 'the teaching stub folds at a phone height (the hint strip survives)');
  const skipR = await rectOf('#break-skip');
  ok(skipR && skipR.h >= 56, 'the skip button clears the thumb floor', skipR && Math.round(skipR.h) + 'px');
  ok(await evalJs(hidden('#tidebox')), 'tidebox dies during the break (#break-next already previews the tide)');
  ok(await evalJs(visible('#purse')) && await evalJs(visible('#herobox')),
    'purse + herobox earn their pixels on a live break');
  ok(await evalJs('RESORT.ui.muteButtonCount') >= 3, 'mute buttons ride break + down panels + title',
    String(await evalJs('RESORT.ui.muteButtonCount')));
  const bmuteR = await rectOf('#break-panel .mutebtn');
  ok(bmuteR && bmuteR.w >= 60 && bmuteR.h >= 60, 'the panel mute is thumb-sized', bmuteR && `${Math.round(bmuteR.w)}x${Math.round(bmuteR.h)}`);
  const m0 = await evalJs('RESORT.audio.muted');
  await tapEl('#break-panel .mutebtn');
  ok(await poll(`RESORT.audio.muted === ${!m0}`, 20), 'tapping the panel mute flips the sound');
  const icoSync = await evalJs(`(()=>{ const t = [...document.querySelectorAll('.mutebtn')].map(b=>b.textContent);
    return t.length >= 3 && t.every(x => x === t[0]) && t[0] === (RESORT.audio.muted ? '🔇' : '🔊'); })()`);
  ok(icoSync, 'every mute icon syncs to the one truth');
  await tapEl('#break-panel .mutebtn');   // leave it as found

  // herobox tap opens the castaway sheet; its header closes it; the open
  // sheet swallows its own taps (the tap-through law re-proven)
  await tapEl('#herobox');
  ok(await poll(`document.getElementById('castaway').classList.contains('show')`, 20),
    'the HEROBOX is the castaway-sheet door');
  const t0 = await evalJs('({x: RESORT.state.hero.tx, z: RESORT.state.hero.tz})');
  await tapEl('#castaway .cbody');
  await sleep(150);
  const t1 = await evalJs('({x: RESORT.state.hero.tx, z: RESORT.state.hero.tz})');
  ok(t0.x === t1.x && t0.z === t1.z, 'a tap ON the open sheet never marches the hero');
  const cheadR = await rectOf('#castaway .chead');
  ok(cheadR && cheadR.h >= 56, 'the sheet header is a real close target', cheadR && Math.round(cheadR.h) + 'px');
  await tapEl('#castaway .chead');
  ok(await poll(`!document.getElementById('castaway').classList.contains('show')`, 20), 'the sheet header tap closes it');

  // --- 3. THE MARKET RACKS: tap targets + the sheet swallows taps -------
  console.log('\nMARKET — rack sheet targets');
  await evalJs('RESORT.state.hero.x = -18; RESORT.state.hero.z = 3; 1');   // the STRIKE rack counter
  ok(await poll(`document.getElementById('sheet').classList.contains('show')`, 40), 'standing at a stall opens its rack');
  const srowR = await rectOf('#sheet-rows .srow');
  const sbtnR = await rectOf('#sheet-rows button.sbtn');
  ok(srowR && srowR.h >= 56, 'rack rows give the thumb a lane (>=56px)', srowR && Math.round(srowR.h) + 'px');
  ok(sbtnR && sbtnR.h >= 44, 'rack buy buttons clear the HIG floor (>=44px)', sbtnR && Math.round(sbtnR.h) + 'px');
  const m1 = await evalJs('({x: RESORT.state.hero.tx, z: RESORT.state.hero.tz})');
  await tapEl('#sheet-rows');
  await sleep(150);
  const m2 = await evalJs('({x: RESORT.state.hero.tx, z: RESORT.state.hero.tz})');
  ok(m1.x === m2.x && m1.z === m2.z, 'a tap on the rack sheet never falls through to the sand');
  await shot('touch-market.png');
  await evalJs('RESORT.state.hero.x = 0; RESORT.state.hero.z = -14; 1');
  ok(await poll(`!document.getElementById('sheet').classList.contains('show')`, 40), 'walking away closes the counter');

  // --- 4. MID-TIDE, NOTHING BOUGHT: THE ZERO-BUTTONS LAW ----------------
  console.log('\nTIDE — the zero-buttons law');
  await evalJs('RESORT.skipTide(); RESORT.runTicks(3)');   // the skip lands on the next tick
  ok(await poll(`RESORT.ui.phaseAttr === 'TIDE' && RESORT.ui.zoneAttr === 'SQUARE'`, 20),
    'data-phase/zone walk to TIDE / SQUARE with the port');
  ok(await evalJs('RESORT.ui.qwerVisible') === false, 'no spells owned -> NO cast bar');
  ok(await evalJs('RESORT.ui.itemChipCount') === 0, 'no items owned -> NO chips');
  ok(await evalJs(`document.getElementById('tbtns') === null`), 'the floating C/M buttons are GONE from the document');
  ok(await evalJs(hidden('#stamp')), 'the seed stamp vanishes mid-fight on glass');
  ok(await evalJs(visible('#tidebox')) && await evalJs(visible('#purse')) && await evalJs(visible('#herobox')),
    'what remains is the fight: tide + quota, purse, HP');
  ok(await evalJs(`document.querySelectorAll('#st-rows .strow').length`) === 0,
    'the standings are a one-line strip (zero rows built)');
  const strip = await evalJs(`document.getElementById('st-label').textContent`);
  ok(/^T\d+ \d+:\d{2}$/.test(strip), 'the strip reads tide + live clock', strip);
  await shot('touch-tide-clean.png');

  // --- 5. THE RACE STRIP: tap to open, sand still orders, auto-fold -----
  console.log('\nSTANDINGS — strip taps + the tap-through tripwire');
  const stripR = await rectOf('#standings .shead');
  ok(stripR && stripR.h >= 60, 'the strip hit box clears the thumb floor', stripR && Math.round(stripR.h) + 'px');
  await tapEl('#standings .shead');
  ok(await poll(`document.querySelectorAll('#st-rows .strow').length === 11`, 30),
    'tapping the strip opens the full board (header + ten tides)');
  const sandBefore = await evalJs('({x: RESORT.state.hero.tx, z: RESORT.state.hero.tz})');
  await tap(stripR.x + 212 + 40, stripR.cy);          // bare sand 40px right of the strip
  await sleep(150);
  const sandAfter = await evalJs('({x: RESORT.state.hero.tx, z: RESORT.state.hero.tz, o: RESORT.state.hero.hasOrder})');
  ok(sandAfter.o === true && (sandAfter.x !== sandBefore.x || sandAfter.z !== sandBefore.z),
    'a tap on the sand NEXT to the strip still orders a move (tripwire)');
  const rowsR = await rectOf('#st-rows');
  const rowBefore = await evalJs('({x: RESORT.state.hero.tx, z: RESORT.state.hero.tz})');
  await tap(rowsR.cx, rowsR.cy);   // mid-board: clear of the strip's hit box AND the herobox below
  await sleep(150);
  const rowAfter = await evalJs('({x: RESORT.state.hero.tx, z: RESORT.state.hero.tz})');
  ok(rowAfter.x !== rowBefore.x || rowAfter.z !== rowBefore.z,
    'the OPEN board stays tap-transparent — the sand behind it still answers');
  const clr = await evalJs('RESORT.runTides(1, 20*60*4)');
  await evalJs('RESORT.skipTide(); RESORT.runTicks(3)');
  ok(clr.ok && await poll('RESORT.ui.standingsCollapsed === true', 30),
    'the next tide start folds the board back to the strip');

  // --- 6. PROGRESSIVE QWER: the bar is born at the first purchase -------
  console.log('\nQWER — slot count = slotted spells');
  await evalJs('RESORT.givePearls(10)');
  await evalJs('RESORT.buySpell("fireball")');
  ok(await poll('RESORT.ui.qwerVisible === true', 20), 'the FIRST purchase births the cast bar');
  let sv = await evalJs('RESORT.ui.slotsVisible');
  ok(sv.length === 1 && sv[0] === 'Q', 'one spell -> ONE slot (Q)', JSON.stringify(sv));
  const qR = await rectOf('#slot-q');
  ok(qR && qR.w >= 60 && qR.h >= 60, 'the slot is thumb-sized', qR && `${Math.round(qR.w)}x${Math.round(qR.h)}`);
  await evalJs('RESORT.buySpell("spinslash")');
  ok(await poll(`RESORT.ui.slotsVisible.join('') === 'QW'`, 20), 'the second purchase grows it to two');
  // stuff a big straight into R (probe-only direct write — the pearl ledger
  // is the battery's job, not ours): the R slot's arrival is the fanfare
  await evalJs(`(RESORT.state.spells['meteortide'] = { rank: 1 }, RESORT.state.slots.R = 'meteortide', 1)`);
  ok(await poll(`RESORT.ui.slotsVisible.join('') === 'QWR'`, 20), 'a big in R makes the R slot appear');
  const rR = await rectOf('#slot-r');
  ok(rR && rR.w >= 68, 'the R slot is the big 68px target', rR && Math.round(rR.w) + 'px');
  ok(await evalJs(hidden('#slot-e')), 'no dead slots to tap — the empty-slot announce is unreachable by thumb');

  // slot taps still auto-aim-cast
  await evalJs('RESORT.spawn(3)');
  await evalJs('RESORT.runTicks(2)');
  const projsBefore = await evalJs('RESORT.state.projs.length');
  await tapEl('#slot-q');
  await sleep(150);
  const q = await evalJs(`({projs: RESORT.state.projs.length, cd: RESORT.state.cds['fireball'] || 0})`);
  ok(q.projs > projsBefore && q.cd > 0, 'tap Q casts at the nearest creep', `projs ${projsBefore}->${q.projs}, cd ${q.cd}`);

  // --- 7. ITEMS: occupied chips only ------------------------------------
  console.log('\nITEMS — chips exist only when items do');
  await evalJs('RESORT.giveGold(600)');
  await evalJs('RESORT.buyItem("guava")');
  ok(await poll('RESORT.ui.itemChipCount === 1', 20), 'one item -> exactly one chip');
  const chipR = await rectOf('.itemchip');
  ok(chipR && chipR.w >= 60 && chipR.h >= 60, 'the chip is thumb-sized', chipR && `${Math.round(chipR.w)}x${Math.round(chipR.h)}`);
  ok(await evalJs(`document.querySelector('.itemchip b').textContent`) === '1', 'the chip wears its true key label');
  await evalJs('RESORT.state.hero.hp = 200; 1');
  await tapEl('.itemchip');
  ok(await poll('RESORT.state.hero.hp > 200', 20), 'tapping the juice drinks it');
  ok(await poll('RESORT.ui.itemChipCount === 0', 20), 'the drunk chip leaves no husk behind');

  // --- 8. THE LOADED FRAME ----------------------------------------------
  await evalJs('RESORT.buyItem("guava"); RESORT.buyItem("flippers")');
  await poll('RESORT.ui.itemChipCount === 2', 20);
  await evalJs('RESORT.resume()');
  await sleep(900);
  await shot('touch-tide-loaded.png');
  await evalJs('RESORT.pause(true)');

  // --- 9. THE THUMB AUDIT ----------------------------------------------
  console.log('\nTHUMB AUDIT — every visible control >= its floor');
  const audit = await evalJs(`(()=>{
    const out = [];
    const floors = [
      ['.slot', 60], ['.itemchip', 60], ['.mutebtn', 60], ['#break-skip', 60],
      ['#herobox', 60], ['#standings .shead', 60], ['#castaway .chead', 56],
      ['button.sbtn', 44], ['.slotchip', 40],
    ];
    for (const [sel, floor] of floors) {
      for (const e of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        // the break/down panels sit faded + scaled(.97) when not .show —
        // their buttons are unreachable then, so they audit only while up
        const pnl = e.closest('#break-panel, #down-panel');
        if (pnl && !pnl.classList.contains('show')) continue;
        const r = e.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (Math.min(r.width, r.height) < floor) out.push(sel + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' < ' + floor);
      }
    }
    return out; })()`);
  ok(audit.length === 0, 'every visible tap target clears its floor (60 free / 44+ in-sheet)', audit.slice(0, 3).join(' | '));

  // --- 10. SAFE-AREA SMOKE ---------------------------------------------
  const offscreen = await evalJs(`(()=>{
    const out = [];
    for (const e of document.querySelectorAll('#hud .panel, #break-panel, #down-panel, #bar, #items')) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.opacity === '0') continue;
      const r = e.getBoundingClientRect();
      if (!r.width) continue;
      if (r.x < -1 || r.x + r.width > 845 || r.y < -1 || r.y + r.height > 391) out.push((e.id || e.className) + '@' + Math.round(r.x) + ',' + Math.round(r.y));
    }
    return out; })()`);
  ok(offscreen.length === 0, 'no visible panel leaves the 844x390 frame', offscreen.join(' | '));

  // --- 11. WASHOUT: the postcard breathes -------------------------------
  console.log('\nWASHOUT — down panel + race strip, nothing else');
  await evalJs(`(()=>{
    const S = RESORT.state;
    S.hero.hp = 1;
    RESORT.spawn(2, 'crab');
    for (const c of S.creeps) { c.x = S.hero.x; c.z = S.hero.z - 1.5; c.px = c.x; c.pz = c.z; }
    let g = 0;
    while (S.phase !== 'WASHOUT' && g++ < 20*60) RESORT.runTicks(1);
    return S.phase; })()`);
  ok(await poll(`RESORT.ui.phaseAttr === 'WASHOUT'`, 30), 'data-phase walks to WASHOUT');
  ok(await poll(visible('#down-panel'), 20) && await evalJs(`document.getElementById('down-panel').classList.contains('show')`),
    'the down panel owns the story');
  ok(await evalJs(hidden('#tidebox')) && await evalJs(hidden('#purse')) && await evalJs(hidden('#herobox'))
    && await evalJs(hidden('#bar')) && await evalJs(hidden('#items')),
    'washout strips the combat chrome — the postcard breathes');
  ok(await evalJs(visible('#standings')), 'the race strip stays — the ghost pulling ahead IS the drama');
  ok(await evalJs(`!!document.querySelector('#down-panel .mutebtn')`), 'the down panel carries its own mute');
  await sleep(1200);
  await shot('touch-washout.png');

  // --- 12. PERF FLOOR ---------------------------------------------------
  console.log('\nPERF');
  await evalJs(`(()=>{
    let g = 0;
    while (RESORT.state.phase !== 'TIDE' && g++ < 20*40) RESORT.runTicks(1);
    RESORT.spawn(18);
    RESORT.resume();
    return RESORT.state.phase; })()`);
  const f0 = await evalJs('RESORT.frames');
  await sleep(5000);
  const f1 = await evalJs('RESORT.frames');
  const fps = (f1 - f0) / 5;
  ok(fps > 15, 'software-GL floor is sane at the phone viewport (real GPUs multiply it)', fps.toFixed(1) + ' fps');

  const errs = cdp.errors.filter(e => !/Audio/i.test(e));
  ok(errs.length === 0, 'no page exceptions', errs.slice(0, 3).join(' | '));

  console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} touch checks green\n`);
  return failures;
};

main().then(f => { cleanup(); process.exit(f ? 1 : 0); })
  .catch(e => { console.error('\nPROBE ERROR: ' + (e && e.message || e), '\n'); cleanup(); process.exit(2); });
