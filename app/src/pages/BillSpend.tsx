import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money2, date } from '../lib/format';

interface Row { id: number; at: string; vendor: string | null; tier: 'light' | 'strong'; pages: number; cost_usd: number; retried: boolean; ok: boolean; error: string | null; paths: string[] | null; style: string | null }
const RATE = 88; // rupees per US dollar, an estimate

export function BillSpend() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [links, setLinks] = useState<Record<number, { name: string; url: string }[]>>({});
  async function viewBill(r: Row) {
    const out: { name: string; url: string }[] = [];
    for (const [i, p] of (r.paths ?? []).entries()) {
      const { data } = await supabase.storage.from('bill-photos').createSignedUrl(p, 600);
      if (data?.signedUrl) out.push({ name: `${p.endsWith('.pdf') ? 'PDF' : 'Photo'} ${i + 1}`, url: data.signedUrl });
    }
    setLinks((l) => ({ ...l, [r.id]: out }));
    if (out[0]) window.open(out[0].url, '_blank', 'noopener');
  }
  useEffect(() => {
    const since = new Date(Date.now() - 62 * 24 * 3600 * 1000).toISOString();
    supabase.from('bill_reads').select('id, at, vendor, tier, pages, cost_usd, retried, ok, error, paths, style').gte('at', since).order('at', { ascending: false }).limit(1000)
      .then(({ data, error }) => { if (error) setErr('Could not load. ' + error.message); else setRows((data as Row[]) ?? []); });
  }, []);

  const s = useMemo(() => {
    const all = rows ?? [];
    const ym = new Date().toISOString().slice(0, 7);
    const mon = all.filter((r) => r.at.slice(0, 7) === ym);
    const inr = (xs: Row[]) => xs.reduce((a, r) => a + Number(r.cost_usd), 0) * RATE;
    const by = (k: (r: Row) => string) => {
      const m = new Map<string, { n: number; pages: number; inr: number }>();
      for (const r of mon) { const key = k(r) || 'Unknown'; const o = m.get(key) ?? { n: 0, pages: 0, inr: 0 }; o.n += 1; o.pages += r.pages; o.inr += Number(r.cost_usd) * RATE; m.set(key, o); }
      return [...m.entries()].sort((a, b) => b[1].inr - a[1].inr);
    };
    return { mon, spend: inr(mon), pages: mon.reduce((a, r) => a + r.pages, 0), retried: mon.filter((r) => r.retried).length, failed: mon.filter((r) => !r.ok).length, vendors: by((r) => r.vendor ?? ''), tiers: by((r) => (r.tier === 'light' ? 'Light reader (printed)' : 'Strong reader (handwritten or doubtful)')) };
  }, [rows]);

  return (
    <>
      <div className="pagehead"><div><p className="label">Buying and money</p><h1>Bill reading spend</h1></div></div>
      {err && <p className="banner bad" role="alert">{err}</p>}
      <div className="grid-tiles">
        <div className="card tile"><span className="label">Spent this month</span><span className="big">{money2(s.spend)}</span></div>
        <div className="card tile"><span className="label">Bills read</span><span className="big">{s.mon.length}</span><span className="small muted">{s.pages} pages</span></div>
        <div className="card tile"><span className="label">Re-read by strong reader</span><span className="big">{s.retried}</span></div>
        <div className="card tile"><span className="label">Could not read</span><span className="big">{s.failed}</span></div>
      </div>
      <p className="small muted">An estimate from the exact amounts the reader used, at about ₹{RATE} to the dollar. Your balance is in the Anthropic Console (platform.claude.com, Billing).</p>
      {rows && rows.length === 0 && <p className="banner">No bills read yet. Add a bill photo at Receive goods and it will show here.</p>}
      {s.mon.length > 0 && (
        <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          {[['By vendor', s.vendors], ['By reader', s.tiers]].map(([title, list]) => (
            <div key={title as string} className="tablewrap" style={{ flex: 1, minWidth: 280 }}>
              <table><thead><tr><th>{title as string}</th><th className="r">Bills</th><th className="r">Pages</th><th className="r">Cost</th></tr></thead>
                <tbody>{(list as [string, { n: number; pages: number; inr: number }][]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="r num">{v.n}</td><td className="r num">{v.pages}</td><td className="r num">{money2(v.inr)}</td></tr>)}</tbody></table>
            </div>
          ))}
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="tablewrap">
          <table><thead><tr><th>When</th><th>Vendor</th><th>Reader</th><th>Bill looks</th><th className="r">Pages</th><th className="r">Cost</th><th>Note</th><th>Bill</th></tr></thead>
            <tbody>{rows.slice(0, 25).map((r) => (
              <tr key={r.id}><td className="num small">{date(r.at)} {new Date(r.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td>{r.vendor || <span className="muted">none</span>}</td><td>{r.tier === 'light' ? 'Light' : 'Strong'}</td><td>{r.style === 'handwritten' ? 'Handwritten' : r.style === 'printed' ? 'Printed' : <span className="muted">not known</span>}</td><td className="r num">{r.pages}</td><td className="r num">{money2(Number(r.cost_usd) * RATE)}</td><td className="small">{!r.ok ? 'Could not read' : r.retried ? 'Re-read by strong reader' : ''}{r.error && <div className="muted">{r.error}</div>}</td><td className="small">{r.paths && r.paths.length ? (links[r.id] ? links[r.id].map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 8 }}>{l.name}</a>) : <button className="btn quiet" onClick={() => void viewBill(r)}>View bill</button>) : <span className="muted">no copy</span>}</td></tr>))}</tbody></table>
        </div>
      )}
    </>
  );
}
