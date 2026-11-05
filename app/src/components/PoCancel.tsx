import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { timeOf } from '../lib/ist';
import { useToast } from './Toast';

interface Req { id: string; po_id: string; reason: string; requested_at: string; purchase_orders: { po_number: string } | null }

// Admin only: orders the store has asked to cancel. Nothing is cancelled until Admin approves.
export function PoCancelInbox({ onChanged }: { onChanged: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [list, setList] = useState<Req[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('po_cancel_requests').select('id, po_id, reason, requested_at, purchase_orders(po_number)').eq('status', 'pending').order('requested_at');
    setList((data as unknown as Req[]) ?? []);
  }, []);
  useEffect(() => { if (profile?.role !== 'owner') return; void load(); const t = window.setInterval(() => { void load(); }, 20000); return () => window.clearInterval(t); }, [profile?.role, load]);
  async function decide(r: Req, approve: boolean) {
    const { error } = await supabase.rpc('decide_po_cancel', { p_request_id: r.id, p_approve: approve, p_note: '' });
    if (error) { toast(errText(error)); return; }
    toast(approve ? 'Order cancelled' : 'Request declined'); await load(); onChanged();
  }
  if (profile?.role !== 'owner' || list.length === 0) return null;
  return (
    <div className="banner warn stack">
      <b>{list.length === 1 ? 'The store wants to cancel an order' : `The store wants to cancel ${list.length} orders`}</b>
      {list.map((r) => (
        <div key={r.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span><b>{r.purchase_orders?.po_number ?? 'Order'}</b> · asked at {timeOf(r.requested_at)} · {r.reason}</span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => void decide(r, false)}>Keep order</button>
            <button className="btn primary" onClick={() => void decide(r, true)}>Approve cancel</button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Inside a placed order: the store asks, Admin can cancel straight away.
export function PoCancelBox({ poId, onDone }: { poId: string; onDone: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [pending, setPending] = useState<{ id: string; reason: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = profile?.role === 'owner';
  const load = useCallback(async () => {
    const { data } = await supabase.from('po_cancel_requests').select('id, reason').eq('po_id', poId).eq('status', 'pending').limit(1);
    setPending(((data as { id: string; reason: string }[]) ?? [])[0] ?? null);
  }, [poId]);
  useEffect(() => { void load(); }, [load]);
  async function go() {
    setBusy(true);
    const { error } = owner ? await supabase.rpc('cancel_po', { p_po_id: poId, p_reason: reason }) : await supabase.rpc('request_po_cancel', { p_po_id: poId, p_reason: reason });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    if (owner) { toast('Order cancelled'); onDone(); } else { toast('Sent to Admin for approval'); setReason(''); void load(); }
  }
  if (pending) return <p className="banner warn">Cancel requested: {pending.reason}. {owner ? 'Approve it at the top of the Buying page.' : 'Waiting for Admin to approve.'}</p>;
  return (
    <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <b>Raised by mistake?</b>
      <p className="muted small">{owner ? 'You can cancel this order now. It is kept in the history, not deleted.' : 'Only Admin can cancel an order. Write the reason and Admin will be asked to approve.'}</p>
      <label className="field"><span>Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: wrong quantity" /></label>
      <button className="btn" disabled={busy || !reason.trim()} onClick={() => void go()}>{owner ? 'Cancel this order' : 'Ask Admin to cancel'}</button>
    </div>
  );
}
