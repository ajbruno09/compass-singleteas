import type { DeptItem } from './types';

// Turns a spoken order such as "onion 5 kg, tomato 10 kg" (English, Hindi, or Hindi in English letters)
// into item and quantity lines. It only suggests; the person confirms before anything is added.

const DEV_DIGITS = '०१२३४५६७८९';
const NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, forty: 40, fifty: 50, hundred: 100, half: 0.5,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15, bees: 20, pachees: 25, tees: 30, chalis: 40, pachaas: 50, sau: 100, aadha: 0.5, adha: 0.5, dedh: 1.5, dhai: 2.5,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'छे': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12, 'पंद्रह': 15, 'पन्द्रह': 15, 'बीस': 20, 'पच्चीस': 25, 'तीस': 30, 'चालीस': 40, 'पचास': 50, 'सौ': 100, 'आधा': 0.5, 'आधी': 0.5, 'डेढ़': 1.5, 'डेढ': 1.5, 'ढाई': 2.5
};
const UNIT_WORDS = new Set(['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'किलो', 'किलोग्राम', 'litre', 'litres', 'liter', 'liters', 'l', 'लीटर', 'packet', 'packets', 'pkt', 'पैकेट', 'piece', 'pieces', 'pcs', 'नग', 'पीस', 'bottle', 'bottles', 'बोतल', 'tray', 'trays', 'ट्रे', 'bunch', 'गुच्छा', 'roll', 'rolls', 'रोल', 'tub', 'tubs', 'टब', 'box', 'boxes', 'डिब्बा', 'dibba']);
const GRAM = new Set(['gram', 'grams', 'g', 'gm', 'ग्राम']);
const ML = new Set(['ml', 'milliliter', 'millilitre', 'मिली']);
const FILLER = new Set(['and', 'aur', 'और', 'of', 'ka', 'ki', 'ke', 'का', 'की', 'के', 'please', 'add', 'order', 'chahiye', 'चाहिए', 'the', 'a', 'need', 'want', 'mujhe', 'मुझे']);
const ALIAS: Record<string, string> = {
  pyaaz: 'onion', pyaz: 'onion', pyaj: 'onion', aloo: 'potato', alu: 'potato', tamatar: 'tomato', dahi: 'curd', doodh: 'milk', dudh: 'milk', anda: 'eggs', ande: 'eggs', egg: 'eggs',
  chawal: 'rice', nimbu: 'lemon', adrak: 'ginger', lehsun: 'garlic', lahsun: 'garlic', mirch: 'chilli', dhaniya: 'coriander', gajar: 'carrot', gobi: 'cauliflower', baingan: 'brinjal',
  kheera: 'cucumber', khira: 'cucumber', matar: 'peas', chini: 'sugar', cheeni: 'sugar', namak: 'salt', tel: 'oil', makhan: 'butter', haldi: 'turmeric', pudina: 'mint', kela: 'banana', seb: 'apple',
  santra: 'orange', tarbooz: 'watermelon', mooli: 'radish', kaddu: 'pumpkin', lauki: 'lauki', bhindi: 'bhindi', palak: 'palak', jeera: 'jeera', atta: 'atta', maida: 'maida', besan: 'besan'
};

const norm = (s: string) => s.toLowerCase().replace(/[०-९]/g, (d) => String(DEV_DIGITS.indexOf(d))).replace(/़/g, '').replace(/[()"'।?!:]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s: string) => norm(s).split(/[^\p{L}\p{M}\p{N}.]+/u).filter(Boolean);

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function sim(a: string, b: string) {
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  if (a.length >= 4 && b.length >= 4 && lev(a, b) <= 1) return 0.75;
  return 0;
}

export interface VoiceLine { item: DeptItem; qty: number; said: string }
export interface VoiceResult { lines: VoiceLine[]; missed: string[] }

function readQty(words: string[], itemUnit: string): { qty: number | null; rest: string[] } {
  let qty: number | null = null; let unitDiv = 1; const rest: string[] = [];
  for (const w of words) {
    if (/^\d+(\.\d+)?$/.test(w)) { qty = (qty ?? 0) + Number(w); continue; }
    if (w in NUM) { qty = (qty ?? 0) + NUM[w]; continue; }
    if (GRAM.has(w)) { if (itemUnit === 'kg') unitDiv = 1000; continue; }
    if (ML.has(w)) { if (itemUnit === 'L') unitDiv = 1000; continue; }
    if (UNIT_WORDS.has(w) || FILLER.has(w)) continue;
    rest.push(w);
  }
  return { qty: qty == null ? null : qty / unitDiv, rest };
}

const isNum = (w: string) => /^\d+(\.\d+)?$/.test(w) || w in NUM;
const isUnit = (w: string) => UNIT_WORDS.has(w) || GRAM.has(w) || ML.has(w);
// Speech often comes without commas: "onion 5 kg tomato 10 kg" or "5 kg onion 10 kg tomato". Cut it into one piece per item.
function runs(words: string[]): string[][] {
  const out: string[][] = []; let cur: string[] = [];
  const qtyFirst = words.length > 0 && isNum(words[0]);
  let seenQty = false; let seenPhrase = false;
  for (const w of words) {
    const q = isNum(w) || isUnit(w);
    if (qtyFirst) {
      if (isNum(w) && seenPhrase) { out.push(cur); cur = []; seenPhrase = false; }
      if (!q && !FILLER.has(w)) seenPhrase = true;
    } else {
      if (!q && !FILLER.has(w) && seenQty) { out.push(cur); cur = []; seenQty = false; }
      if (q) seenQty = true;
    }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function parseOrder(text: string, items: DeptItem[], lang: 'en' | 'hi'): VoiceResult {
  const segs = norm(text).split(/\s*(?:,|;|\.\s|\band\b|\baur\b|और|\bthen\b|फिर)\s*/u).filter(Boolean);
  const cands = items.map((i) => ({ i, en: toks(i.name), hi: toks(i.local_names?.hi ?? '') }));
  const lines: VoiceLine[] = []; const missed: string[] = [];
  for (const seg0 of segs) for (const wordsRun of runs(toks(seg0))) {
    const seg = wordsRun.join(' ');
    const words = wordsRun;
    // First pass with the quantity unit unknown: try each distinct unit once.
    let best: { i: DeptItem; score: number; qty: number | null } | null = null;
    for (const unit of new Set(items.map((i) => i.unit))) {
      const { qty, rest } = readQty(words, unit);
      const phrase = rest.map((w) => ALIAS[w] ?? w);
      if (!phrase.length) continue;
      for (const c of cands) {
        if (c.i.unit !== unit) continue;
        const pools = [c.en, lang === 'hi' || c.hi.length ? c.hi : []].filter((p) => p.length);
        for (const pool of pools) {
          let hit = 0; let cover = 0;
          for (const p of phrase) { const s = Math.max(0, ...pool.map((n) => sim(p, n))); hit += s; }
          for (const n of pool) { const s = Math.max(0, ...phrase.map((p) => sim(p, n))); cover += s; }
          const score = 0.65 * (hit / phrase.length) + 0.35 * (cover / pool.length) - 0.01 * pool.length;
          if (hit / phrase.length >= 0.6 && (!best || score > best.score)) best = { i: c.i, score, qty };
        }
      }
    }
    if (best && best.score >= 0.55) {
      const q = best.qty ?? 1;
      if (!lines.some((l) => l.item.id === best!.i.id)) lines.push({ item: best.i, qty: Math.round(q * 1000) / 1000, said: seg });
    } else if (words.length) missed.push(seg);
  }
  return { lines, missed };
}
