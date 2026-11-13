// Reads a bill photo (or PDF) and returns bill number, date, vendor and total.
// Caller must be signed in with a role that receives goods. The Anthropic key lives in private_config.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const MODEL = 'claude-sonnet-5-5';

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

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content }] }),
    });
    const j = await r.json();
    if (!r.ok) return json({ error: 'Could not read the bill (' + (j?.error?.message ?? r.status) + ').' }, 502);
    const text: string = (j.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: 'Could not read the bill.' }, 502);
    const o = JSON.parse(m[0]);
    const date = typeof o.bill_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.bill_date) ? o.bill_date : null;
    const total = typeof o.total === 'number' && isFinite(o.total) ? o.total : (o.total != null && isFinite(Number(o.total)) ? Number(o.total) : null);
    return json({ bill_number: o.bill_number ? String(o.bill_number) : null, bill_date: date, vendor: o.vendor ? String(o.vendor) : null, total, unclear: Array.isArray(o.unclear) ? o.unclear : [] });
  } catch (e) {
    return json({ error: 'Could not read the bill. ' + (e instanceof Error ? e.message : '') }, 500);
  }
});
