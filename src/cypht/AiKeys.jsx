import { useEffect, useState } from 'react';
import { liveBridge } from './mailbox-live.js';
import { buildChatGptPrompt, buildMcpSetup } from './ai-prompt.js';
import { READ_ONLY, normalizePerms } from '../../connectors/ai-perms.mjs';
export { READ_ONLY, normalizePerms };

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
    const rec = { id: crypto.randomUUID(), name: n, last4: key.slice(-4), createdAt: new Date().toISOString(), lastUsedAt: null, perms: { ...READ_ONLY } };
    demoKeys.write([...demoKeys.read(), rec]); return { ...rec, key };
  },
  remove: async id => { demoKeys.write(demoKeys.read().filter(k => k.id !== id)); },
  setPerms: async (id, perms) => { const p = normalizePerms(perms); demoKeys.write(demoKeys.read().map(k => k.id === id ? { ...k, perms: p } : k)); return { ...demoKeys.read().find(k => k.id === id) }; },
};
const PERMS = [
  { id: 'read', label: 'See emails', hint: 'Only emails you opened, with hidden parts replaced by their label.' },
  { id: 'drafts', label: 'Draft emails', hint: 'Create and edit drafts in Gmail or Outlook. Nothing is sent.' },
  { id: 'send', label: 'Send emails', hint: 'Only after you approve the exact email in Lockbox, and only once.' },
];
export const summarize = perms => {
  const p = normalizePerms(perms);
  const what = PERMS.filter(x => p[x.id]).map(x => x.label.split(' ')[0]).join(', ') || 'Nothing';
  if (p.mailboxes === 'all') return `All mailboxes · ${what}`;
  const n = Object.keys(p.mailboxes).length;
  return n ? `${n} mailbox${n === 1 ? '' : 'es'} · ${what}` : 'No mailboxes';
};
const setFlag = (f, id, on) => ({ ...f, [id]: on, ...(id === 'drafts' && !on ? { send: false } : {}), ...(id === 'send' && on ? { drafts: true } : {}) });

export function KeyEditor({ k, mailboxes = [], onSave, onCancel, onReconnect }) {
  const start = normalizePerms(k.perms);
  const [all, setAll] = useState(start.mailboxes === 'all');
  const [allFlags, setAllFlags] = useState({ read: start.read, drafts: start.drafts, send: start.send });
  const [boxes, setBoxes] = useState(() => Object.fromEntries(mailboxes.map(b => [b.id, start.mailboxes === 'all' ? { read: start.read, drafts: start.drafts, send: start.send } : (start.mailboxes[b.id] || { read: false, drafts: false, send: false })])));
  const [saving, setSaving] = useState(false);
  const writable = b => b.provider !== 'imap';
  const save = async () => {
    const next = all ? normalizePerms({ mailboxes: 'all', ...allFlags }) : normalizePerms({ mailboxes: Object.fromEntries(Object.entries(boxes).map(([id, f]) => { const b = mailboxes.find(x => x.id === id); return [id, b && !writable(b) ? { ...f, drafts: false, send: false } : f]; })) });
    if (next.send && !normalizePerms(k.perms).send && !confirm(`Allow "${k.name}" to ask to send email? You'll still approve every email in Lockbox before it is sent.`)) return;
    setSaving(true); try { await onSave(next); } finally { setSaving(false); }
  };
  const row = (f, set, disabledWrite) => PERMS.map(p => <label key={p.id} className="form-check form-check-inline" title={p.hint}><input type="checkbox" className="form-check-input" checked={!!f[p.id]} disabled={p.id !== 'read' && disabledWrite} onChange={e => set(setFlag(f, p.id, e.target.checked))} /> <span className="form-check-label">{p.label}</span></label>);
  return <div className="modal-backdrop-lite" role="presentation" onClick={onCancel}>
    <div className="key-editor" role="dialog" aria-modal="true" aria-label={`Edit ${k.name}`} onClick={e => e.stopPropagation()}>
      <h2>Edit “{k.name}”</h2>
      <p className="muted-copy">Choose which mailboxes this AI agent can use and what it may do there. Sending always waits for your approval.</p>
      <label className="form-check key-editor-all"><input type="checkbox" className="form-check-input" checked={all} onChange={e => setAll(e.target.checked)} /> <span className="form-check-label">All mailboxes, including ones added later</span></label>
      {all ? <div className="key-editor-box"><strong>Every mailbox</strong><div>{row(allFlags, setAllFlags, false)}</div></div>
        : mailboxes.length ? mailboxes.map(b => { const f = boxes[b.id] || {}; const on = !!(f.read || f.drafts); const needsSignIn = writable(b) && b.status === 'connected' && b.aiDrafts === false && (f.drafts || f.send);
          return <div className="key-editor-box" key={b.id}>
            <label className="form-check form-switch"><input type="checkbox" role="switch" className="form-check-input" checked={on} onChange={e => setBoxes(x => ({ ...x, [b.id]: e.target.checked ? { read: true, drafts: false, send: false } : { read: false, drafts: false, send: false } }))} aria-label={`Allow ${b.email}`} /> <strong>{b.email}</strong></label>
            {on && <div>{row(f, v => setBoxes(x => ({ ...x, [b.id]: v })), !writable(b))}</div>}
            {on && !writable(b) && <p className="muted-copy">Drafting and sending aren't available for this mailbox yet. Seeing emails works.</p>}
            {needsSignIn && <p className="muted-copy">Sign in again to allow drafting. <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onReconnect?.(b)}>Sign in again</button></p>}
          </div>; })
        : <p className="muted-copy">No mailboxes connected yet.</p>}
      <div className="key-editor-actions"><button className="btn btn-sm btn-outline-secondary" onClick={onCancel}>Cancel</button><button className="btn btn-sm btn-primary" disabled={saving} onClick={save}>Save</button></div>
    </div>
  </div>;
}
const store = () => liveBridge()?.aiKeys || demoKeys;
const day = d => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never';
const Icon = ({ name }) => <i className={`bi bi-${name}`} aria-hidden="true" />;

export default function AiKeys({ onNotify = () => {}, mailboxes = [], onReconnect }) {
  const [editing, setEditing] = useState(null);
  const [keys, setKeys] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const [error, setError] = useState('');
  const demo = !liveBridge()?.aiKeys;
  const refresh = () => store().list().then(setKeys).catch(e => setError(e.message));
  const [endpoint, setEndpoint] = useState('');
  useEffect(() => { refresh(); const b = liveBridge(); if (b?.aiEndpoint) Promise.resolve(b.aiEndpoint()).then(setEndpoint).catch(() => {}); }, []);
  const create = async e => {
    e.preventDefault(); setError('');
    try { const k = await store().create(name); setFresh(k); setName(''); setCreating(false); refresh(); } catch (err) { setError(err.message === 'name_required' ? 'Give the key a name.' : err.message); }
  };
  const savePerms = async (k, next) => {
    setError('');
    try { await store().setPerms(k.id, next); setEditing(null); refresh(); onNotify('Permissions saved. Disconnect and reconnect ChatGPT to update its tools.'); } catch (err) { setError(err.message); }
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
    {endpoint ? <div className="ai-endpoint"><strong>Give your AI agent this address and a key</strong><div className="ai-key-copy"><code>{endpoint}/messages</code><button className="btn btn-sm btn-outline-secondary" onClick={() => { navigator.clipboard?.writeText(`${endpoint}/messages`); onNotify('Address copied.'); }}><Icon name="clipboard" /> Copy</button></div><p className="muted-copy">Example: <code>curl -H "Authorization: Bearer lbx_…" {endpoint}/messages?limit=10</code>. Agents only get emails you have opened, with hidden parts replaced by their label. Each key can only read until you allow more below. Sending always waits for your approval of the exact email.{liveBridge()?.runtime === 'desktop' && ' This address works only on this computer, while Lockbox is open.'}</p></div>
      : demo && <p className="muted-copy ai-endpoint">Demo: AI agents can connect once Lockbox runs on your server or the desktop app.</p>}
    {keys.length ? <table className="ai-key-table"><thead><tr><th>Name</th><th>Key</th><th>Allowed</th><th>Created</th><th>Last used</th><th /></tr></thead><tbody>{keys.map(k => { const pm = normalizePerms(k.perms); return <tr key={k.id}><td data-label="Name">{k.name}</td><td data-label="Key"><code>lbx_••••{k.last4}</code></td><td data-label="Allowed"><span className="ai-key-summary">{summarize(pm)}</span> <button className="btn btn-sm btn-outline-secondary" aria-label={`Edit ${k.name}`} onClick={() => setEditing(k)}><Icon name="pencil" /> Edit</button></td><td data-label="Created">{day(k.createdAt)}</td><td data-label="Last used">{day(k.lastUsedAt)}</td><td className="ai-key-actions">{endpoint && <button className="btn btn-sm btn-outline-secondary" title="Copy a setup prompt for ChatGPT or other agents (does not include the key)" aria-label={`Copy ChatGPT prompt for ${k.name}`} onClick={() => { navigator.clipboard?.writeText(buildChatGptPrompt({ endpoint, keyName: k.name })); onNotify('ChatGPT prompt copied. Paste the key only into the GPT’s Authentication field.'); }}><Icon name="chat-left-text" /> ChatGPT prompt</button>}{endpoint && <> <button className="btn btn-sm btn-outline-secondary" title="Copy the MCP address and setup steps for ChatGPT, Claude or Cursor (does not include the key)" aria-label={`Copy MCP setup for ${k.name}`} onClick={() => { navigator.clipboard?.writeText(buildMcpSetup({ endpoint, keyName: k.name })); onNotify('MCP setup copied. Paste the key only into the app’s sign-in or settings, never a chat.'); }}><Icon name="plug" /> MCP setup</button></>} <button className="btn btn-sm btn-outline-danger" aria-label={`Delete ${k.name}`} onClick={() => remove(k)}><Icon name="trash" /></button></td></tr>; })}</tbody></table>
      : <div className="ai-key-empty"><Icon name="key" /> No API keys yet.</div>}
    {editing && <KeyEditor k={editing} mailboxes={mailboxes} onCancel={() => setEditing(null)} onSave={next => savePerms(editing, next)} onReconnect={onReconnect} />}
  </div>;
}
