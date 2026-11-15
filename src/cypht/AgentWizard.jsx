import { useEffect, useRef, useState } from 'react';
import { normalizePerms } from '../../connectors/ai-perms.mjs';
import { PROVIDERS, STEPS, mcpUrlFrom, isLocalUrl, TEST_PROMPT, tryPrompts, evidence, grokSample, bearerConfig, saveProgress, loadProgress, clearProgress } from './agent-wizard.js';

const Icon = ({ name }) => <i className={`bi bi-${name}`} aria-hidden="true" />;
const FLAGS = [
  { id: 'read', label: 'Read emails' },
  { id: 'drafts', label: 'Manage drafts' },
  { id: 'send', label: 'Send emails' },
];
// Same dependency rules as the key editor: Send needs drafts; turning drafts off turns Send off.
const flip = (f, id, on) => ({ ...f, [id]: on, ...(id === 'drafts' && !on ? { send: false } : {}), ...(id === 'send' && on ? { drafts: true } : {}) });
const writable = b => b.provider !== 'imap';
const needsReconnect = (b, f) => b.status && b.status !== 'connected' ? 'Disconnected — sign in again' : (writable(b) && b.aiDrafts === false && (f?.drafts || f?.send)) ? 'Sign in again to allow drafts' : '';
const fmt = t => t ? new Date(t).toLocaleString() : 'not yet';

function Copy({ text, label, onNotify, done }) {
  return <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { navigator.clipboard?.writeText(text); onNotify?.(done || `${label.replace(/^Copy /, '')} copied.`); }}><Icon name="clipboard" /> {label}</button>;
}

export default function AgentWizard({ store, keys, refreshKeys, endpoint, publicUrl, mailboxes = [], onClose, onNotify, onAddMailbox, onReconnect }) {
  const saved = useRef(loadProgress()).current;
  const [st, setSt] = useState(() => saved || { step: 0, provider: '', keyId: '', mode: 'new', all: true, allFlags: { read: true, drafts: false, send: false }, boxes: {}, since: Date.now(), confirmed: false });
  const [secret, setSecret] = useState(null); // memory only
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reachable, setReachable] = useState(null);
  const set = patch => setSt(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  useEffect(() => { saveProgress(st); }, [st]);
  const prov = PROVIDERS[st.provider];
  const key = keys.find(k => k.id === st.keyId);
  const url = mcpUrlFrom(publicUrl || endpoint);
  const perms = normalizePerms(key?.perms);
  const dialog = useRef(null);
  useEffect(() => { dialog.current?.querySelector('h3, [data-autofocus]')?.focus(); }, [st.step]);
  // Refresh activity when the user comes back from their assistant's tab.
  useEffect(() => { const on = () => { if (document.visibilityState === 'visible') { refreshKeys(); probe(); } }; document.addEventListener('visibilitychange', on); return () => document.removeEventListener('visibilitychange', on); }, [url]);
  const probe = async () => {
    if (!url) return setReachable(null);
    try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const j = await r.json().catch(() => ({})); setReachable(r.status === 401 && /api_key_required|invalid_token/.test(j.error || '') ? true : false); } catch { setReachable(false); }
  };
  useEffect(() => { if (st.step === 4) probe(); }, [st.step, url]);

  const loadKey = k => { const p = normalizePerms(k.perms); set({ keyId: k.id, mode: 'existing', all: p.mailboxes === 'all', allFlags: { read: p.read, drafts: p.drafts, send: p.send }, boxes: p.mailboxes === 'all' ? {} : p.mailboxes }); };
  const chosen = () => st.all ? normalizePerms({ mailboxes: 'all', ...st.allFlags }) : normalizePerms({ mailboxes: Object.fromEntries(Object.entries(st.boxes).map(([id, f]) => { const b = mailboxes.find(x => x.id === id); return [id, b && !writable(b) ? { ...f, drafts: false, send: false } : f]; })) });

  const saveAccess = async () => {
    setError(''); const next = chosen();
    if (!next.read && !next.drafts) return setError('Allow at least one thing, or pick mailboxes.');
    if (next.send && !(key && normalizePerms(key.perms).send) && !confirm(`Allow this ${prov.name} key to send and schedule emails without a separate Lockbox approval page? Creating or editing a draft never sends it.`)) return;
    setBusy(true);
    try {
      let k = key;
      if (st.mode === 'new' || !k) { k = await store.create(prov.keyName); setSecret(k.key); set({ keyId: k.id, mode: 'existing', createdHere: true }); }
      else setSecret(null);
      await store.setPerms(k.id, next);
      await refreshKeys(); set({ step: 2 });
    } catch (e) { setError(e.message === 'name_required' ? 'Give the key a name.' : e.message); } finally { setBusy(false); }
  };
  const close = () => { onClose(); };
  const finish = () => { clearProgress(); setSecret(null); onClose(); };
  const ev = evidence({ reachable, key, since: st.since });
  const Mark = ({ s }) => <span className={`aw-mark aw-${s}`}>{s === 'ok' ? <><Icon name="check-circle-fill" /> Seen by Lockbox</> : s === 'fail' ? <><Icon name="x-circle-fill" /> Not reachable</> : <><Icon name="hourglass" /> Not seen yet</>}</span>;

  const body = () => {
    switch (st.step) {
      case 0: return <>
        <h3 tabIndex={-1}>Which assistant are you connecting?</h3>
        <div className="aw-choices" role="radiogroup" aria-label="Assistant">{Object.values(PROVIDERS).map(p => <button key={p.id} type="button" role="radio" aria-checked={st.provider === p.id} className={`aw-choice ${st.provider === p.id ? 'is-on' : ''}`} onClick={() => set({ provider: p.id })}><strong>{p.name}</strong><small>{p.id === 'grok' ? 'For an app you build with the xAI API' : 'Custom connector in the app'}</small></button>)}</div>
      </>;
      case 1: return <>
        <h3 tabIndex={-1}>Choose access</h3>
        <div className="aw-row" role="radiogroup" aria-label="Key">
          <label className="form-check"><input type="radio" className="form-check-input" checked={st.mode === 'new'} onChange={() => set({ mode: 'new', keyId: '' })} /> <span className="form-check-label">Create a new key named “{prov.keyName}”</span></label>
          {!!keys.length && <label className="form-check"><input type="radio" className="form-check-input" checked={st.mode === 'existing'} onChange={() => loadKey(key || keys[0])} /> <span className="form-check-label">Use an existing key</span></label>}
          {st.mode === 'existing' && <select className="form-select form-select-sm" aria-label="Existing key" value={st.keyId} onChange={e => loadKey(keys.find(k => k.id === e.target.value))}>{keys.map(k => <option key={k.id} value={k.id}>{k.name} (lbx_••••{k.last4})</option>)}</select>}
        </div>
        {!mailboxes.length ? <div className="aw-note"><Icon name="inbox" /> No mailbox is connected yet. <button type="button" className="btn btn-sm btn-outline-primary" onClick={onAddMailbox}>Connect a mailbox</button> Your place in this setup is kept; reopen <strong>Connect an Agent</strong> afterwards.</div> : <>
          <label className="form-check"><input type="checkbox" className="form-check-input" checked={st.all} onChange={e => set({ all: e.target.checked })} /> <span className="form-check-label">All mailboxes, including ones added later</span></label>
          {st.all ? <div className="aw-box">{FLAGS.map(f => <label key={f.id} className="form-check form-check-inline"><input type="checkbox" className="form-check-input" checked={!!st.allFlags[f.id]} onChange={e => set(s => ({ allFlags: flip(s.allFlags, f.id, e.target.checked) }))} /> <span className="form-check-label">{f.label}</span></label>)}
            {mailboxes.map(b => { const r = needsReconnect(b, st.allFlags); return r ? <p key={b.id} className="aw-warn"><Icon name="exclamation-triangle" /> {b.email}: {r} <button type="button" className="btn btn-sm btn-link p-0" onClick={() => onReconnect?.(b)}>Sign in again</button></p> : null; })}</div>
            : mailboxes.map(b => { const f = st.boxes[b.id] || { read: false, drafts: false, send: false }; const r = needsReconnect(b, f); return <div key={b.id} className="aw-box"><strong>{b.email}</strong>
              <div>{FLAGS.map(x => <label key={x.id} className="form-check form-check-inline"><input type="checkbox" className="form-check-input" checked={!!f[x.id]} disabled={x.id !== 'read' && !writable(b)} onChange={e => set(s => ({ boxes: { ...s.boxes, [b.id]: flip(f, x.id, e.target.checked) } }))} aria-label={`${x.label} for ${b.email}`} /> <span className="form-check-label">{x.label}</span></label>)}</div>
              {!writable(b) && <small className="muted-copy">Drafts and sending aren't available for this mailbox type yet.</small>}
              {r && <p className="aw-warn"><Icon name="exclamation-triangle" /> {r} <button type="button" className="btn btn-sm btn-link p-0" onClick={() => onReconnect?.(b)}>Sign in again</button></p>}</div>; })}
        </>}
        <p className="muted-copy"><strong>Send emails</strong> lets the assistant send and schedule an exact draft version when it explicitly asks to, without a separate Lockbox approval page. It needs Manage drafts. Creating or editing a draft never sends it.</p>
        {error && <div className="ai-key-error" role="alert">{error}</div>}
      </>;
      case 2: return <>
        <h3 tabIndex={-1}>Copy connection details</h3>
        {url ? <div className="aw-field"><label>MCP URL (Server URL)</label><div className="ai-key-copy"><code>{url}</code><Copy text={url} label="Copy MCP URL" onNotify={onNotify} /></div>{isLocalUrl(url) && <p className="aw-warn">This address only works on this computer while Lockbox is open. {st.provider !== 'grok' && `${prov.name} connects from the internet, so use Lockbox on your server instead.`}</p>}</div>
          : <p className="aw-note"><Icon name="info-circle" /> Demo: there's no server address yet. Run Lockbox on your server to get one.</p>}
        {secret ? <div className="ai-key-fresh"><strong><Icon name="exclamation-triangle" /> Copy your “{key?.name}” key now. You won't see it again.</strong><div className="ai-key-copy"><code>{secret}</code><Copy text={secret} label="Copy API key" onNotify={onNotify} done="API key copied. Paste it only where the next step says." /></div>
          <p className="muted-copy">{st.provider === 'grok' ? 'Store it as the LOCKBOX_KEY environment variable of your app.' : 'Paste it only on the Lockbox sign-in page that opens when you connect — never into a chat.'}</p></div>
          : <p className="aw-note"><Icon name="key" /> Using <strong>{key?.name}</strong> (lbx_••••{key?.last4}). Lockbox never stores the full key, so use the copy you saved. Lost it? Go back and create a new key.</p>}
      </>;
      case 3: return <>
        <h3 tabIndex={-1}>Set up {prov.name}</h3>
        {url && st.provider !== 'claude' && <div className="aw-field"><label>MCP URL (Server URL)</label><div className="ai-key-copy"><code>{url}</code><Copy text={url} label="Copy MCP URL" onNotify={onNotify} /></div><p className="muted-copy">Use this address if {prov.name} asks for an MCP, server or connector URL.</p></div>}
        {st.provider === 'chatgpt' && <><ol className="aw-steps">
          <li>On ChatGPT on the web, open <strong>Plugins</strong>, select <strong>+</strong>, then <strong>Add custom MCP server</strong>. If you don't see it, your plan or workspace admin hasn't enabled custom servers.</li>
          <li>Name it <code>Lockbox</code> and paste the MCP URL as the Server URL. {url && <Copy text={url} label="Copy MCP URL" onNotify={onNotify} />}</li>
          <li>Choose <strong>OAuth</strong>. Leave client credentials empty: Lockbox registers ChatGPT automatically.</li>
          <li>Accept the warning and create it. A Lockbox page opens: paste your Lockbox key there and select <strong>Allow</strong>.</li>
          <li>In a new chat, turn on Lockbox from the <strong>+</strong> menu (or tools menu) before asking.</li></ol>
          <details className="aw-more"><summary>Using a client with Bearer-key settings instead</summary><p>Add a remote (Streamable HTTP) server with the MCP URL and header <code>Authorization: Bearer &lt;your lbx_ key&gt;</code>. If a field asks for an <em>environment variable</em>, type the variable's name (for example <code>LOCKBOX_KEY</code>) and set that variable to your key. If it asks for a <em>token</em>, paste the key itself.</p><div className="ai-key-copy"><code>{bearerConfig(url)}</code><Copy text={bearerConfig(url)} label="Copy config" onNotify={onNotify} /></div></details></>}
        {st.provider === 'claude' && <ol className="aw-steps">
          <li>In Claude, open <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>. On Team or Enterprise plans, an owner adds it first in organization settings; members then connect it.</li>
          <li>Name it <code>Lockbox</code> and paste this MCP URL:{url && <div className="ai-key-copy"><code>{url}</code><Copy text={url} label="Copy MCP URL" onNotify={onNotify} /></div>}</li>
          <li>Under advanced settings, leave the OAuth client ID empty or choose <strong>Register automatically</strong> if it appears — Lockbox supports automatic registration.</li>
          <li>Select <strong>Connect</strong>. On the Lockbox page that opens, paste your Lockbox key and select <strong>Allow</strong>.</li>
          <li>In a chat, enable Lockbox from the tools/connectors menu.</li></ol>}
        {st.provider === 'grok' && <><p className="aw-note"><Icon name="code-slash" /> This connects Lockbox to <strong>an application you run that uses xAI's API</strong>. The regular Grok chat app has no custom connector setting for this.</p>
          <ol className="aw-steps"><li>Set <code>XAI_API_KEY</code> to your xAI API key (from the xAI console).</li><li>Set <code>LOCKBOX_KEY</code> to your Lockbox key.</li><li>Run this example, which asks Grok to call <code>get_access</code>:</li></ol>
          <pre className="aw-code">{grokSample(url || 'https://your-lockbox-address/api/ai/v1/mcp')}</pre><Copy text={grokSample(url || 'https://your-lockbox-address/api/ai/v1/mcp')} label="Copy example" onNotify={onNotify} /></>}
        <p><a href={prov.docs} target="_blank" rel="noreferrer">Official {prov.name.split(' ')[0]} setup guide <Icon name="box-arrow-up-right" /></a></p>
      </>;
      case 4: return <>
        <h3 tabIndex={-1}>Check the connection</h3>
        <p>Ask {prov.name.split(' ')[0]} this, then come back here:</p>
        <div className="ai-key-copy"><code>{TEST_PROMPT}</code><Copy text={TEST_PROMPT} label="Copy test prompt" onNotify={onNotify} /></div>
        <ul className="aw-evidence">
          <li><span>Server reachable</span><Mark s={ev.reachable} /></li>
          <li><span>Signed-in request arrived <small>(last: {fmt(key?.lastUsedAt)})</small></span><Mark s={ev.authenticated} /></li>
          <li><span>Assistant used a tool <small>{key?.lastToolName ? `(${key.lastToolName}, ${fmt(key.lastToolCallAt)})` : ''}</small></span><Mark s={ev.toolCalled} /></li>
        </ul>
        {!!key?.apps?.length && <p className="muted-copy">Connected apps: {key.apps.map(a => a.name).join(', ')}</p>}
        <p className="muted-copy">Saved for this key: {perms.mailboxes === 'all' ? 'all mailboxes' : `${Object.keys(perms.mailboxes).length} mailbox(es)`} · {FLAGS.filter(f => perms[f.id]).map(f => f.label).join(', ') || 'nothing'}.</p>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { refreshKeys(); probe(); }}><Icon name="arrow-clockwise" /> Check again</button>
        {ev.toolCalled !== 'ok' && <label className="form-check mt-2"><input type="checkbox" className="form-check-input" checked={!!st.confirmed} onChange={e => set({ confirmed: e.target.checked })} /> <span className="form-check-label">The assistant answered correctly (I checked myself)</span></label>}
        <details className="aw-more"><summary>Troubleshooting</summary><ul>
          <li><strong>Lockbox tools are missing:</strong> the assistant saves the tool list when it connects. After changing permissions, disconnect and reconnect Lockbox (or refresh its tools), then start a new chat.</li>
          <li><strong>Wrong key:</strong> ask it to run get_access; the key name and last four characters must match “{key?.name}” (••••{key?.last4}).</li>
          <li><strong>direct_send: false:</strong> Send emails is off for that mailbox. Go back to Access, turn it on, then reconnect.</li>
          <li><strong>Mailbox needs reconnection:</strong> sign in again on the Mailboxes page, then retry.</li>
          <li><strong>Setting not available:</strong> custom connectors depend on your plan and workspace permissions; ask your admin.</li>
          <li><strong>Server not reachable:</strong> the MCP URL must be your public https address and the server must be running.</li></ul></details>
      </>;
      case 5: { const tp = tryPrompts(perms); return <>
        <h3 tabIndex={-1}>Try it</h3>
        <ul className="aw-try">{tp.map(t => <li key={t.id}><span>{t.label}</span><Copy text={t.text} label="Copy prompt" onNotify={onNotify} /></li>)}</ul>
        {!perms.send && <p className="muted-copy">Sending prompts appear when this key has Send emails.</p>}
        <p className="muted-copy">Drafts it creates appear in <strong>Drafts</strong>; scheduled emails appear in <strong>Scheduled</strong>, where you can cancel them. This setup never sends anything by itself.</p>
      </>; }
      default: return <>
        <h3 tabIndex={-1}>All set</h3>
        <dl className="aw-summary"><dt>Assistant</dt><dd>{prov?.name}</dd><dt>Key</dt><dd>{key ? `${key.name} (lbx_••••${key.last4})` : '—'}</dd>
          <dt>Mailboxes</dt><dd>{perms.mailboxes === 'all' ? 'All mailboxes' : Object.keys(perms.mailboxes).join(', ') || 'None'}</dd>
          <dt>Permissions</dt><dd>{FLAGS.filter(f => perms[f.id]).map(f => f.label).join(', ') || 'None'}</dd>
          <dt>Verification</dt><dd>{ev.toolCalled === 'ok' ? `Lockbox saw a tool call (${key?.lastToolName})` : st.confirmed ? 'Confirmed by you (not seen by Lockbox)' : 'Not verified yet'}</dd></dl>
      </>;
    }
  };
  const next = () => st.step === 1 ? saveAccess() : set({ step: st.step + 1 });
  return <div className="modal-backdrop-lite" role="presentation" onKeyDown={e => e.key === 'Escape' && close()}>
    <div className="agent-wizard" role="dialog" aria-modal="true" aria-labelledby="aw-title" ref={dialog}>
      <div className="aw-head"><div><h2 id="aw-title"><Icon name="plug" /> Connect an Agent</h2><p className="aw-sub">Step {Math.min(st.step, STEPS.length - 1) + 1} of {STEPS.length} · {STEPS[Math.min(st.step, STEPS.length - 1)]}</p></div><button type="button" className="btn-close" aria-label="Close" onClick={close} /></div>
      <ol className="aw-progress" aria-label="Progress">{STEPS.map((s, i) => <li key={s} className={i === st.step ? 'is-now' : i < st.step ? 'is-done' : ''} aria-current={i === st.step ? 'step' : undefined}><span>{i < st.step ? <Icon name="check" /> : i + 1}</span><em>{s}</em></li>)}</ol>
      <div className="aw-body">{body()}</div>
      <div className="aw-foot">
        {st.step > 0 && st.step < 6 && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => set({ step: st.step - 1 })}>Back</button>}
        <span className="aw-spacer" />
        {st.step < 6 ? <button type="button" className="btn btn-sm btn-primary" disabled={busy || (st.step === 0 && !st.provider) || (st.step === 1 && (!mailboxes.length && !st.all))} onClick={next}>{st.step === 1 ? (busy ? 'Saving…' : 'Save and continue') : 'Next'}</button>
          : <button type="button" className="btn btn-sm btn-primary" onClick={finish}>Done</button>}
      </div>
    </div>
  </div>;
}
