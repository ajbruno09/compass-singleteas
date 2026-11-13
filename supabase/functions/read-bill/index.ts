// Reads a bill photo (or PDF) and returns bill number, date, vendor and total.
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
{"bill_number": string|null, "bill_date": "YYYY-MM-DD"|null, "vendor": string|null, "total": number|null, "unclear": string[]}
Rules: bill_number is the invoice or bill number printed or written on it. bill_date uses Indian day-month-year order when written as numbers. total is the final payable amount in rupees as a plain number (no commas or symbols). vendor is the seller's name. If a field cannot be read with confidence use null and add its name to "unclear". Never guess.`;

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
    content.push({ type: 'text', text: PROMPT });

    // Printed vendors go to the light model first. Anything else, or any doubtful read, goes to the strong model.
    const vendor = typeof body.vendor === 'string' ? body.vendor.slice(0, 80) : '';
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin.from('bill_reads').select('id', { count: 'exact', head: true }).gte('at', since);
    if ((count ?? 0) >= DAILY_CAP) return json({ error: 'Daily bill reading limit reached. Type the details yourself.' }, 429);

    let inTok = 0, outTok = 0, cost = 0, retried = false, lastText = '';
    const ask = async (model: string) => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1500, system: 'You read bills. Reply with one JSON object only. No explanation, no markdown, no list of items.', messages: [{ role: 'user', content }] }),
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
    const doubtful = (x: Record<string, unknown> | null) => !x || !x.bill_number || x.total == null || (Array.isArray(x.unclear) && x.unclear.length > 0);
    const log = async (tier: string, ok: boolean, error?: string) => {
      await admin.from('bill_reads').insert({ user_id: u.user!.id, vendor, tier, pages: pages.length, input_tokens: inTok, output_tokens: outTok, cost_usd: cost, retried, ok, error: error ?? null });
    };
    let o: Record<string, unknown> | null = null;
    let tier = PRINTED.test(vendor) ? 'light' : 'strong';
    try {
      if (tier === 'light') {
        try { o = await ask(LIGHT); } catch { o = null; }
        if (doubtful(o)) { retried = true; tier = 'strong'; o = await ask(STRONG); }
      } else {
        o = await ask(STRONG);
      }
    } catch (e) {
      await log(tier, false, e instanceof Error ? e.message.slice(0, 200) : 'error');
      return json({ error: 'Could not read the bill (' + (e instanceof Error ? e.message : 'error') + ').' }, 502);
    }
    if (!o) { await log(tier, false, 'unreadable reply: ' + lastText.slice(0, 160).replace(/\s+/g, ' ')); return json({ error: 'Could not read the bill.' }, 502); }
    await log(tier, true);
    const date = typeof o.bill_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.bill_date) ? o.bill_date : null;
    const total = o.total != null && isFinite(Number(o.total)) ? Number(o.total) : null;
    return json({ bill_number: o.bill_number ? String(o.bill_number) : null, bill_date: date, vendor: o.vendor ? String(o.vendor) : null, total, unclear: Array.isArray(o.unclear) ? o.unclear : [], reader: tier });
  } catch (e) {
    return json({ error: 'Could not read the bill. ' + (e instanceof Error ? e.message : '') }, 500);
  }
});
