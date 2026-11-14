// Reads a bill photo (or PDF) and returns bill number, date, vendor, total and every line (item, quantity, unit, rate).
// Caller must be signed in with a role that receives goods. The Anthropic key is the function secret ANTHROPIC_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const STRONG = 'claude-sonnet-5-5';
const LIGHT = 'claude-haiku-5-5';
// US dollars per million tokens (input, output)
const PRICE: Record<string, [number, number]> = { [STRONG]: [2, 10], [LIGHT]: [0.1, 0.5] };
const PRINTED = /hyperpure|zepto|blinkit|instamart|swiggy|bigbasket/i;
const DAILY_CAP = 60;

const PROMPT = `This is a supplier bill or invoice received at a cafe in India (it may be handwritten). Read it and reply with ONLY one JSON object, no other text:
{"bill_number": string|null, "bill_date": "YYYY-MM-DD"|null, "vendor": string|null, "total": number|null, "style": "printed"|"handwritten", "unclear": string[], "lines": [{"name": string, "item_id": number|null, "qty": number|null, "unit": string|null, "rate": number|null, "amount": number|null}]}
Rules: bill_number is the invoice or bill number printed or written on it. bill_date uses Indian day-month-year order when written as numbers. total is the final payable amount in rupees as a plain number (no commas or symbols). vendor is the seller's name. If a field cannot be read with confidence use null and add its name to "unclear". style is "handwritten" if the main details are written by hand, otherwise "printed".
lines has one entry for every product line on the bill, in order. name is the product name as written. qty is the quantity billed, unit is its unit as written (kg, g, L, ml, pcs, pkt, bunch and so on). rate is the price for one unit of that quantity before tax if shown, and amount is the line total. Use plain numbers. If the list of our item names is given below, set item_id to the id of the matching item only when you are sure it is the same product, otherwise null. Never guess a number you cannot read, use null.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
    if (!prof || !['owner', 'manager', 'store'].includes(prof.role)) return json({ error: 'Not allowed.' }, 403);

    const body = await req.json();
    const pages: { b64: string; type: string }[] = (body.pages ?? []).slice(0, 3);
    if (!pages.length) return json({ error: 'No bill pages sent.' }, 400);

    const apiKey = Deno.env.get('ANTHROPIC_KEY');
    if (!apiKey) return json({ error: 'Bill reading is not set up yet.' }, 503);

    const content: unknown[] = pages.map((p) => p.type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.b64 } }
      : { type: 'image', source: { type: 'base64', media_type: p.type || 'image/jpeg', data: p.b64 } });
    const names: { id: number; name: string; unit: string }[] = Array.isArray(body.items) ? body.items.slice(0, 150).filter((x: { id?: unknown; name?: unknown }) => typeof x?.id === 'number' && typeof x?.name === 'string') : [];
    content.push({ type: 'text', text: PROMPT + (names.length ? '\nOur item names (id: name, unit):\n' + names.map((x) => `${x.id}: ${String(x.name).slice(0, 60)}, ${String(x.unit ?? '').slice(0, 10)}`).join('\n') : '') });

    // Printed vendors go to the light model first. Anything else, or any doubtful read, goes to the strong model.
    const vendor = typeof body.vendor === 'string' ? body.vendor.slice(0, 80) : '';
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin.from('bill_reads').select('id', { count: 'exact', head: true }).gte('at', since);
    if ((count ?? 0) >= DAILY_CAP) return json({ error: 'Daily bill reading limit reached. Type the details yourself.' }, 429);

    // Keep a copy of the bill so the owner can open it later and see if it was printed or handwritten.
    const paths: string[] = [];
    const stamp = Date.now();
    for (let n = 0; n < pages.length; n++) {
      try {
        const t = pages[n].type || 'image/jpeg';
        const ext = t === 'application/pdf' ? 'pdf' : t.includes('png') ? 'png' : t.includes('webp') ? 'webp' : 'jpg';
        const bin = Uint8Array.from(atob(pages[n].b64), (ch) => ch.charCodeAt(0));
        const path = `reads/${stamp}-${n + 1}.${ext}`;
        const up = await admin.storage.from('bill-photos').upload(path, bin, { contentType: t, upsert: false });
        if (!up.error) paths.push(path);
      } catch { /* keep going without the copy */ }
    }
    let inTok = 0, outTok = 0, cost = 0, retried = false, lastText = '', note = '';
    const ask = async (model: string) => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 4000, system: 'You read bills. Reply with one JSON object only. No explanation, no markdown.', messages: [{ role: 'user', content }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? String(r.status));
      const i = j.usage?.input_tokens ?? 0, o = j.usage?.output_tokens ?? 0;
      inTok += i; outTok += o; cost += (i * PRICE[model][0] + o * PRICE[model][1]) / 1e6;
      const text: string = (j.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
      lastText = text;
      const a = text.lastIndexOf('{"bill_number"') >= 0 ? text.lastIndexOf('{"bill_number"') : text.indexOf('{');
      const k = text.lastIndexOf('}');
      if (a < 0 || k < a) return null;
      try { return JSON.parse(text.slice(a, k + 1)); } catch { return null; }
    };
    const why = (x: Record<string, unknown> | null) => !x ? 'light reply not readable' : !x.bill_number ? 'light: no bill number' : x.total == null ? 'light: no total' : '';
    const doubtful = (x: Record<string, unknown> | null) => why(x) !== '';
    const log = async (tier: string, ok: boolean, error?: string, style?: string) => {
      await admin.from('bill_reads').insert({ user_id: u.user!.id, vendor, tier, paths, style: style ?? null, pages: pages.length, input_tokens: inTok, output_tokens: outTok, cost_usd: cost, retried, ok, error: error ?? (note || null) });
    };
    let o: Record<string, unknown> | null = null;
    let tier = PRINTED.test(vendor) ? 'light' : 'strong';
    try {
      if (tier === 'light') {
        try { o = await ask(LIGHT); } catch (e) { o = null; note = 'light error: ' + (e instanceof Error ? e.message.slice(0, 120) : ''); }
        if (doubtful(o)) { retried = true; note = note || why(o); tier = 'strong'; o = await ask(STRONG); }
      } else {
        o = await ask(STRONG);
      }
    } catch (e) {
      await log(tier, false, e instanceof Error ? e.message.slice(0, 200) : 'error');
      return json({ error: 'Could not read the bill (' + (e instanceof Error ? e.message : 'error') + ').' }, 502);
    }
    if (!o) { await log(tier, false, 'unreadable reply: ' + lastText.slice(0, 160).replace(/\s+/g, ' ')); return json({ error: 'Could not read the bill.' }, 502); }
    await log(tier, true, undefined, o.style === 'handwritten' ? 'handwritten' : o.style === 'printed' ? 'printed' : undefined);
    const date = typeof o.bill_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.bill_date) ? o.bill_date : null;
    const total = o.total != null && isFinite(Number(o.total)) ? Number(o.total) : null;
    const num = (x: unknown) => (x != null && x !== '' && isFinite(Number(x)) ? Number(x) : null);
    const known = new Set(names.map((x) => x.id));
    const lines = (Array.isArray(o.lines) ? o.lines : []).slice(0, 80).map((l: Record<string, unknown>) => ({
      name: String(l?.name ?? '').slice(0, 80), item_id: typeof l?.item_id === 'number' && known.has(l.item_id) ? l.item_id : null,
      qty: num(l?.qty), unit: l?.unit ? String(l.unit).slice(0, 12) : null, rate: num(l?.rate), amount: num(l?.amount)
    })).filter((l: { name: string }) => l.name);
    return json({ bill_number: o.bill_number ? String(o.bill_number) : null, bill_date: date, vendor: o.vendor ? String(o.vendor) : null, total, unclear: Array.isArray(o.unclear) ? o.unclear : [], lines, reader: tier });
  } catch (e) {
    return json({ error: 'Could not read the bill. ' + (e instanceof Error ? e.message : '') }, 500);
  }
});
