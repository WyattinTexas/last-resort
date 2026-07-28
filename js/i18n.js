// SURVIVAL QUEST — i18n. Ported from the GVT architecture: THE ENGLISH STRING IS
// THE KEY. Every player-facing string in this game passes through TXT() from
// line 1 so that "English x6" never happens here (GVT's scar, §7 of the spec).
//
//   TXT('SHOP BREAK')              -> 'SHOP BREAK'          (en = identity)
//   tf('TIDE %1 CLEARED', 3)       -> 'TIDE 3 CLEARED'
//
// English is a straight identity function, so an English build is byte-for-byte
// the game that shipped before any translator ever touched it.

// Translation tables land here as   TR.ja = { "SHOP BREAK": "...", ... }
// P0 ships en only; the rails are what matter today.
export const TR = Object.create(null);

const SUPPORTED = ['en'];

function canonLang(s) {
  if (!s) return null;
  const base = String(s).toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.includes(base) ? base : null;
}

export let LANG = (function detect() {
  const q = (location.search.match(/[?&]lang=([A-Za-z-]+)/) || [])[1];
  if (q) { const c = canonLang(q); if (c) return c; }
  const navs = (navigator.languages && navigator.languages.length)
    ? navigator.languages : [navigator.language || 'en'];
  for (const n of navs) { const c = canonLang(n); if (c) return c; }
  return 'en';
}());

export function setLang(l) { const c = canonLang(l); if (c) LANG = c; }

// A number, or a number with a decimal/thousands run. Numbers get punched out
// of keys so "+14 GOLD" and "+18 GOLD" are ONE dictionary entry.
//
// The lookbehind is load-bearing: WITHOUT it the tokeniser eats the digit in a
// tf() placeholder, so "TIDE %1 CLEARED" becomes the key "TIDE %{0} CLEARED"
// and no translator's entry would ever match it again. A %N slot is a
// placeholder, not a number.
const NUMTOK = /(?<!%)\d+(?:[.,]\d+)*/g;

function trLookup(src) {
  const d = TR[LANG];
  if (!d) return null;
  const k = String(src).replace(/\s+/g, ' ').trim();
  if (!k) return null;
  let v = d[k];
  if (v !== undefined) return v;
  if (!/\d/.test(k)) return null;
  const nums = [];
  const key = k.replace(NUMTOK, m => { nums.push(m); return '{' + (nums.length - 1) + '}'; });
  v = d[key];
  if (v === undefined) return null;
  return v.replace(/\{(\d+)\}/g, (m, i) => (nums[+i] !== undefined ? nums[+i] : m));
}

// AUDIT MODE (?l10n=audit or RESORT.i18nAudit()): every string that walks past
// without a dictionary hit is recorded in its TOKENISED form. That is how
// "EVERY player-facing string" gets proved by measurement, not by hope.
let AUDIT = null;

export function i18nAudit(on) {
  if (on === false) { const out = AUDIT; AUDIT = null; return out; }
  AUDIT = AUDIT || Object.create(null);
  return AUDIT;
}

function miss(k) {
  if (!AUDIT) return;
  let n = String(k).replace(/\s+/g, ' ').trim();
  if (!n || !/[A-Za-z]/.test(n)) return;
  if (/\d/.test(n)) { let i = 0; n = n.replace(NUMTOK, () => '{' + (i++) + '}'); }
  AUDIT[n] = (AUDIT[n] || 0) + 1;
}

// t() / TXT(): the one call every string passes through.
export function t(src) {
  if (src === null || src === undefined || src === '') return src;
  if (LANG === 'en') { miss(src); return src; }
  const v = trLookup(src);
  if (v === null) { miss(src); return src; }
  return v;
}

export const TXT = t;

// %1, %2... for the pieces a number-tokeniser cannot carry: tide names, body
// names, player names — anything a translator must be free to move around.
export function tf(src) {
  const a = arguments;
  let out = t(src);
  for (let i = 1; i < a.length; i++) out = out.split('%' + i).join(a[i]);
  return out;
}

// Static markup goes through the same door once at boot: any element carrying
// data-txt has its text content resolved. data-notr opts a node out (numbers,
// timers, names) so a translator never sees a value that isn't a sentence.
export function localizeDom(root) {
  const els = (root || document).querySelectorAll('[data-txt]');
  for (const el of els) {
    if (el.hasAttribute('data-notr')) continue;
    const en = el.getAttribute('data-txt');
    el.textContent = t(en);
  }
  const attrEls = (root || document).querySelectorAll('[data-txt-title],[data-txt-aria]');
  for (const el of attrEls) {
    if (el.hasAttribute('data-txt-title')) el.setAttribute('title', t(el.getAttribute('data-txt-title')));
    if (el.hasAttribute('data-txt-aria')) el.setAttribute('aria-label', t(el.getAttribute('data-txt-aria')));
  }
}

if (/[?&]l10n=audit/.test(location.search)) i18nAudit(true);
