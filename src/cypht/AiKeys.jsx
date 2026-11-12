import { useEffect, useState } from 'react';
import { liveBridge } from './mailbox-live.js';

const DEMO_KEY = 'cypht-preview:ai-keys';
// Preview (no server): keys live in this browser and only the visible tail is remembered.
export const demoKeys = {
  read: () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch { return []; } },
  write: v => localStorage.setItem(DEMO_KEY, JSON.stringify(v)),
  list: async () => demoKeys.read(),
  create: async name => {
    const n = String(name || '').trim().slice(0, 60); if (!n) throw new Error('Give the key a name.');
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const key = 'lbx_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const rec = { id: crypto.randomUUID(), name: n, last4: key.slice(-4), createdAt: new Date().toISOString(), lastUsedAt: null };
    demoKeys.write([...demoKeys.read(), rec]); return { ...rec, key };
  },
  remove: async id => { demoKeys.write(demoKeys.read().filter(k => k.id !== id)); },
};
const store = () => liveBridge()?.aiKeys || demoKeys;
const day = d => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never';
const Icon = ({ name }) => <i className={`bi bi-${name}`} aria-hidden="true" />;

export default function AiKeys({ onNotify = () => {} }) {
  const [keys, setKeys] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const [error, setError] = useState('');
  const demo = !liveBridge()?.aiKeys;
  const refresh = () => store().list().then(setKeys).catch(e => setError(e.message));
  useEffect(() => { refresh(); }, []);
  const create = async e => {
    e.preventDefault(); setError('');
    try { const k = await store().create(name); setFresh(k); setName(''); setCreating(false); refresh(); } catch (err) { setError(err.message === 'name_required' ? 'Give the key a name.' : err.message); }
  };
  const remove = async k => {
    if (!confirm(`Delete "${k.name}"? Anything using this key will stop working.`)) return;
    try { await store().remove(k.id); if (fresh?.id === k.id) setFresh(null); refresh(); onNotify('API key deleted.'); } catch (err) { setError(err.message); }
  };
  return <div className="ai-keys">
    <div className="ai-card-head"><div><h2>API keys</h2><p className="muted-copy">Keys belong to your account only. Give each AI agent its own key so you can remove one without affecting the others.{demo && ' Demo: kept in this browser.'}</p></div>
      {!creating && <button className="btn btn-primary btn-sm" onClick={() => { setCreating(true); setFresh(null); }}><Icon name="plus-lg" /> Create API key</button>}</div>
    {creating && <form className="ai-key-form" onSubmit={create}><input className="form-control form-control-sm" autoFocus maxLength={60} placeholder="Key name, e.g. Claude agent" aria-label="Key name" value={name} onChange={e => setName(e.target.value)} /><button className="btn btn-primary btn-sm" type="submit">Create</button><button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => { setCreating(false); setName(''); }}>Cancel</button></form>}
    {fresh && <div className="ai-key-fresh" role="status"><strong><Icon name="exclamation-triangle" /> Copy “{fresh.name}” now. You won't see it again.</strong><div className="ai-key-copy"><code>{fresh.key}</code><button className="btn btn-sm btn-outline-secondary" onClick={() => { navigator.clipboard?.writeText(fresh.key); onNotify('API key copied.'); }}><Icon name="clipboard" /> Copy</button><button className="btn btn-sm btn-link" onClick={() => setFresh(null)}>Done</button></div></div>}
    {error && <div className="ai-key-error" role="alert">{error}</div>}
    {keys.length ? <table className="ai-key-table"><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th /></tr></thead><tbody>{keys.map(k => <tr key={k.id}><td data-label="Name">{k.name}</td><td data-label="Key"><code>lbx_••••{k.last4}</code></td><td data-label="Created">{day(k.createdAt)}</td><td data-label="Last used">{day(k.lastUsedAt)}</td><td><button className="btn btn-sm btn-outline-danger" aria-label={`Delete ${k.name}`} onClick={() => remove(k)}><Icon name="trash" /></button></td></tr>)}</tbody></table>
      : <div className="ai-key-empty"><Icon name="key" /> No API keys yet.</div>}
  </div>;
}
