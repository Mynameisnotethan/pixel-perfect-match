import { useState } from 'react';
import { MAILBOX_PROVIDERS, STATUS_TEXT } from './mailbox-demo.js';
import { liveBridge } from './mailbox-live.js';

const Icon = ({ name }) => <i aria-hidden="true" className={`bi bi-${name}`} />;

export default function MailboxDialog({ mailboxes, onConnect, onReconnect, onDisconnect, onExpire, onManual, onClose }) {
  const [provider, setProvider] = useState(null);
  const [email, setEmail] = useState('');
  const live = !!liveBridge();
  const start = p => { if (live) { onConnect(p); return; } setProvider(p); setEmail(p === 'google' ? 'you@gmail.com' : 'you@outlook.com'); };
  const submit = e => { e.preventDefault(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return; onConnect(provider, email.trim()); setProvider(null); };
  return <div className="mailbox-connect">
    {!live && <div className="mailbox-demo-badge"><Icon name="info-circle" /> <span><strong>Demo mode.</strong> No Google or Microsoft sign-in happens in this preview. To connect real mailboxes, use the desktop app (built with Lockbox's Google and Microsoft app registrations) or a Docker install with its own registrations.</span></div>}
    {!provider ? <div className="mailbox-providers">
      {Object.entries(MAILBOX_PROVIDERS).map(([id, p]) => <button key={id} type="button" className="mailbox-provider" onClick={() => start(id)}>
        <span className={`mailbox-provider-icon is-${id}`}><Icon name={p.icon} /></span>
        <span><strong>Connect {p.name}</strong><small>{p.hint}</small></span>
      </button>)}
    </div> : <form className="mailbox-fake-signin" onSubmit={submit}>
      <p><strong>Demo {MAILBOX_PROVIDERS[provider].name} sign-in</strong><br /><small>In the real app this opens {provider === 'google' ? 'Google' : 'Microsoft'} in your browser. Type any address to simulate it.</small></p>
      <input className="form-control" type="email" aria-label="Mailbox address" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
      <div className="dialog-actions"><button type="button" className="btn btn-outline-secondary" onClick={() => setProvider(null)}>Back</button><button className="btn btn-primary" type="submit">Approve access</button></div>
    </form>}
    {mailboxes.length > 0 && <><h3 className="mailbox-list-title">Connected mailboxes</h3><ul className="mailbox-list">
      {mailboxes.map(b => <li key={b.id}>
        <span className={`mailbox-provider-icon is-${b.provider}`}><Icon name={MAILBOX_PROVIDERS[b.provider].icon} /></span>
        <span className="mailbox-list-main"><strong>{b.email}</strong><small className={`mailbox-status is-${b.status}`}>{['connecting', 'syncing'].includes(b.status) && <span className="spinner-border spinner-border-sm" aria-hidden="true" />} {STATUS_TEXT[b.status]}</small></span>
        <span className="mailbox-list-actions">
          {b.status === 'reconnect' && <button className="btn btn-sm btn-primary" onClick={() => onReconnect(b)}>Reconnect</button>}
          {b.status === 'connected' && <button className="btn btn-sm btn-outline-secondary" title="Demo: simulate revoked access" onClick={() => onExpire(b)}>Simulate expiry</button>}
          <button className="btn btn-sm btn-outline-danger" onClick={() => onDisconnect(b)}>Disconnect</button>
        </span>
      </li>)}
    </ul></>}
    <div className="dialog-actions"><button type="button" className="btn btn-link btn-sm me-auto" onClick={onManual}>Add sample IMAP account instead</button><button type="button" className="btn btn-outline-secondary" onClick={onClose}>Done</button></div>
  </div>;
}
