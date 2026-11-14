import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';
import type { Group } from '../lib/types';
import '../mock-levels.css';

interface Item { id: number; name: string; unit: string; group_id: number | null; count_frequency: 'daily' | 'weekly' | 'monthly' | 'off' }
type Freq = 'daily' | 'weekly' | 'monthly' | 'off';
const FREQ: Freq[] = ['daily', 'weekly', 'monthly', 'off'];
const LABEL: Record<Freq, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', off: 'Off' };

// Lets Admin choose, per counter, how often each item there needs a closing count.
// Daily items are asked every day. Weekly items wait for the weekly count (everything gets counted then too).
// Monthly items get their own count, open on the 1st or whenever Admin opens it from Closing counts.
// Off items are never asked for at this counter, not even on the weekly sweep.
export function CountFrequency() {
  const { locations } = useSession();
  const toast = useToast();
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const [loc, setLoc] = useState<number | null>(counters[0]?.id ?? null);
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [edits, setEdits] = useState<Record<number, Freq>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!loc) return;
    setEdits({});
    const [i, g] = await Promise.all([
      supabase.rpc('department_items', { p_location_id: loc }),
      supabase.from('item_groups').select('*').eq('active', true).order('sort'),
    ]);
    setItems((i.data as Item[]) ?? []);
    setGroups((g.data as Group[]) ?? []);
  }, [loc]);
  useEffect(() => { void load(); }, [load]);

  const freqOf = (i: Item): Freq => edits[i.id] ?? i.count_frequency;
  const onPick = (i: Item, f: Freq) => setEdits((e) => { const n = { ...e }; if (f === i.count_frequency) delete n[i.id]; else n[i.id] = f; return n; });
  const changed = Object.keys(edits).length;
  const counts = FREQ.reduce((a, f) => ({ ...a, [f]: items.filter((i) => freqOf(i) === f).length }), {} as Record<Freq, number>);

  async function save() {
    setBusy(true);
    const rows = Object.entries(edits).map(([id, freq]) => ({ item_id: Number(id), freq }));
    const { error } = await supabase.rpc('save_count_frequency', { p_location_id: loc, p_rows: rows });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    toast(`Saved ${rows.length} ${rows.length === 1 ? 'item' : 'items'}`);
    void load();
  }

  const ql = q.trim().toLowerCase();
  const shelves = [...groups, { id: null as unknown as number, name: 'No shelf group yet', icon: '' } as Group];
  const body = shelves.map((g) => {
    const rows = items.filter((i) => (g.id == null ? !groups.some((x) => x.id === i.group_id) : i.group_id === g.id) && (!ql || i.name.toLowerCase().includes(ql)));
    if (!rows.length) return null;
    return (<tbody key={g.id ?? 'none'}>
      <tr className="sl-grp"><td colSpan={3}>{g.name}</td></tr>
      {rows.map((i) => {
        const cur = freqOf(i);
        return (<tr key={i.id}>
          <td>{i.name}</td>
          <td className="sl-hide-s" style={{ color: 'var(--mut)' }}>{i.unit}</td>
          <td className="sl-r">
            <div className="sl-fseg">{FREQ.map((f) => <button key={f} className={cur === f ? `sl-fon sl-f-${f}` : ''} onClick={() => onPick(i, f)}>{LABEL[f]}</button>)}</div>
          </td>
        </tr>);
      })}
    </tbody>);
  }).filter(Boolean);

  return (
    <div className="sl-root"><div className="sl-wrap">
      <div><div className="sl-lab">Items</div><h1>Count frequency</h1><div className="sl-sm sl-mut">How often each counter needs to count each item at closing. Daily items are asked every day. Weekly and Monthly items wait for that counter's weekly or monthly count.</div></div>
      <div className="sl-bar">
        <div className="sl-seg">{counters.map((c) => <button key={c.id} className={c.id === loc ? 'sl-on' : ''} onClick={() => setLoc(c.id)}>{c.name}</button>)}</div>
      </div>
      <div className="sl-bar">
        <input type="search" placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="sl-seg">{FREQ.map((f) => <button key={f} disabled>{LABEL[f]}<span className="sl-n">{counts[f] ?? 0}</span></button>)}</div>
      </div>
      <div className="sl-card">
        {items.length === 0 ? <div className="sl-empty">{loc ? 'No items are linked to this counter yet.' : 'Choose a counter.'}</div> :
          body.length ? <table><thead><tr><th>Item</th><th className="sl-hide-s">Unit</th><th className="sl-r">Count</th></tr></thead>{body}</table> : <div className="sl-empty">Nothing to show with this search.</div>}
      </div>
    </div>
    {changed > 0 && <div className="sl-save sl-on"><span>{changed} {changed === 1 ? 'change' : 'changes'} not saved</span><button className="sl-btn" onClick={() => setEdits({})}>Discard</button><button className="sl-btn sl-p" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button></div>}
    </div>
  );
}
