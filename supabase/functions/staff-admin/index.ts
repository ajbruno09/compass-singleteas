// Owner-only staff administration: create a mobile + PIN login, or reset a PIN.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const DOMAIN = 'staff.singleteas.local';
const ROLES = ['manager', 'store', 'department', 'closing', 'accounts'];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false }
  });
  const { data: u } = await caller.auth.getUser();
  if (!u.user) return json({ error: 'Please sign in again.' }, 401);
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', u.user.id).single();
  if (!me || me.role !== 'owner' || !me.active) return json({ error: 'Only the owner can do this.' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const pin = String(body.pin ?? '');
  if (!/^[0-9]{6}$/.test(pin)) return json({ error: 'The PIN must be 6 digits.' }, 400);
  if (/^(\d)\1{5}$/.test(pin) || pin === '123456' || pin === '654321') return json({ error: 'Choose a PIN that is harder to guess.' }, 400);

  if (body.action === 'create') {
    const phone = String(body.phone ?? '');
    const name = String(body.full_name ?? '').trim();
    const role = String(body.role ?? 'department');
    const lang = body.extra_language ? String(body.extra_language) : null;
    const locs = Array.isArray(body.location_ids) ? (body.location_ids as unknown[]).map(Number).filter(Number.isFinite) : [];
    if (!/^[6-9][0-9]{9}$/.test(phone)) return json({ error: 'Enter a 10-digit mobile number.' }, 400);
    if (!name) return json({ error: 'Enter the person’s name.' }, 400);
    if (!ROLES.includes(role)) return json({ error: 'Choose a valid role.' }, 400);
    if (lang && !/^[a-z]{2,3}$/.test(lang)) return json({ error: 'Choose a valid language.' }, 400);

    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${phone}@${DOMAIN}`, password: pin, email_confirm: true,
      user_metadata: { phone, full_name: name }, app_metadata: { created_by_owner: true }
    });
    if (error) return json({ error: error.message.includes('already') ? 'Someone with this mobile number already has a login.' : error.message }, 400);
    const id = created.user!.id;
    const up = await admin.from('profiles').update({ role, extra_language: lang, full_name: name, phone, active: true }).eq('id', id);
    if (up.error) return json({ error: up.error.message }, 500);
    if (locs.length) {
      const ins = await admin.from('profile_locations').insert(locs.map((l) => ({ profile_id: id, location_id: l })));
      if (ins.error) return json({ error: ins.error.message }, 500);
    }
    return json({ id });
  }

  if (body.action === 'reset_pin') {
    const id = String(body.user_id ?? '');
    const { data: p } = await admin.from('profiles').select('role').eq('id', id).single();
    if (!p || p.role === 'owner') return json({ error: 'This person’s PIN cannot be reset here.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(id, { password: pin });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
