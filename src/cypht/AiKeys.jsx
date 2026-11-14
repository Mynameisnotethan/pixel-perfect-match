import { useEffect, useState } from 'react';
import { liveBridge } from './mailbox-live.js';
import { buildChatGptPrompt, buildMcpSetup } from './ai-prompt.js';

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
// Same rules as the server: missing = read-only, and sending needs drafts.
export const READ_ONLY = { read: true, drafts: false, send: false };
export const normalizePerms = p => ({ read: p?.read !== false, drafts: p?.drafts === true, send: p?.send === true && p?.drafts === true });
const PERMS = [
  { id: 'read', label: 'Read reviewed emails', hint: 'Only emails you opened, with hidden parts replaced by their label.' },
  { id: 'drafts', label: 'Manage drafts', hint: 'Create and edit drafts in your Gmail or Outlook. Nothing is sent.' },
  { id: 'send', label: 'Send email', hint: 'Only after you approve the exact email in Lockbox, and only once.' },
];
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
  const [endpoint, setEndpoint] = useState('');
  useEffect(() => { refresh(); const b = liveBridge(); if (b?.aiEndpoint) Promise.resolve(b.aiEndpoint()).then(setEndpoint).catch(() => {}); }, []);
  const create = async e => {
    e.preventDefault(); setError('');
    try { const k = await store().create(name); setFresh(k); setName(''); setCreating(false); refresh(); } catch (err) { setError(err.message === 'name_required' ? 'Give the key a name.' : err.message); }
  };
  const setPerm = async (k, id, on) => {
    const next = normalizePerms({ ...normalizePerms(k.perms), [id]: on, ...(id === 'drafts' && !on ? { send: false } : {}) });
    if (on && id === 'send' && !confirm(`Allow "${k.name}" to ask to send email? You'll still approve every email in Lockbox before it is sent.`)) return;
    setError('');
    try { await store().setPerms(k.id, next); refresh(); onNotify('Key permissions saved.'); } catch (err) { setError(err.message); }
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
    {keys.length ? <table className="ai-key-table"><thead><tr><th>Name</th><th>Key</th><th>Allowed</th><th>Created</th><th>Last used</th><th /></tr></thead><tbody>{keys.map(k => { const pm = normalizePerms(k.perms); return <tr key={k.id}><td data-label="Name">{k.name}</td><td data-label="Key"><code>lbx_••••{k.last4}</code></td><td data-label="Allowed"><div className="ai-key-perms">{PERMS.map(p => <label key={p.id} className="form-check" title={p.hint}><input type="checkbox" className="form-check-input" checked={pm[p.id]} disabled={p.id === 'send' && !pm.drafts} onChange={e => setPerm(k, p.id, e.target.checked)} aria-label={`${p.label} for ${k.name}`} /> <span className="form-check-label">{p.label}</span></label>)}</div></td><td data-label="Created">{day(k.createdAt)}</td><td data-label="Last used">{day(k.lastUsedAt)}</td><td className="ai-key-actions">{endpoint && <button className="btn btn-sm btn-outline-secondary" title="Copy a setup prompt for ChatGPT or other agents (does not include the key)" aria-label={`Copy ChatGPT prompt for ${k.name}`} onClick={() => { navigator.clipboard?.writeText(buildChatGptPrompt({ endpoint, keyName: k.name })); onNotify('ChatGPT prompt copied. Paste the key only into the GPT’s Authentication field.'); }}><Icon name="chat-left-text" /> ChatGPT prompt</button>}{endpoint && <> <button className="btn btn-sm btn-outline-secondary" title="Copy the MCP address and setup steps for ChatGPT, Claude or Cursor (does not include the key)" aria-label={`Copy MCP setup for ${k.name}`} onClick={() => { navigator.clipboard?.writeText(buildMcpSetup({ endpoint, keyName: k.name })); onNotify('MCP setup copied. Paste the key only into the app’s sign-in or settings, never a chat.'); }}><Icon name="plug" /> MCP setup</button></>} <button className="btn btn-sm btn-outline-danger" aria-label={`Delete ${k.name}`} onClick={() => remove(k)}><Icon name="trash" /></button></td></tr>; })}</tbody></table>
      : <div className="ai-key-empty"><Icon name="key" /> No API keys yet.</div>}
  </div>;
}
