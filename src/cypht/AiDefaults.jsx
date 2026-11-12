import { useState } from 'react';
import { confirmsLock } from './privacy.js';

const received = [['subject', 'Subject (header)'], ['sender', 'Sender name'], ['email', 'Sender email'], ['body', 'Message body'], ['attachments', 'Attachments']];
const sent = [['subject', 'Subject (header)'], ['to', 'Recipients'], ['body', 'Message body'], ['attachments', 'Attachments']];

export default function AiDefaults({ value, onSave, onNotify }) {
  const [draft, setDraft] = useState(null);
  const [asking, setAsking] = useState(false);
  const [word, setWord] = useState('');
  const d = draft || value;
  const row = (k, label, isSent) => <label key={k} className="form-check form-switch ai-default-row"><input className="form-check-input" type="checkbox" role="switch" disabled={!draft} aria-label={isSent ? `Hide ${label} on sent emails` : undefined} checked={!!(isSent ? d.sent?.[k] : d[k])} onChange={e => setDraft(x => isSent ? { ...x, sent: { ...(x.sent || {}), [k]: e.target.checked } } : { ...x, [k]: e.target.checked })} /><span className="form-check-label">{label}</span></label>;
  return <>
    <div className="ai-card-head"><div><h2>Hide by default</h2><p className="muted-copy">Applies to every email unless you unlock that part on a specific email.</p></div>
      {!draft ? <button className="btn btn-sm btn-outline-secondary" onClick={() => { setWord(''); setAsking(true); }}><i className="bi bi-lock-fill" aria-hidden="true" /> Change settings</button>
        : <div className="ai-save-row"><button className="btn btn-sm btn-outline-secondary" onClick={() => setDraft(null)}>Cancel</button><button className="btn btn-sm btn-primary" onClick={() => { onSave(draft); setDraft(null); onNotify?.('Hide-by-default settings saved.'); }}>Save</button></div>}
    </div>
    <div className={`ai-columns ${draft ? '' : 'is-locked'}`}>
      <div><h3 className="ai-subhead">Received emails</h3><div className="ai-defaults">{received.map(([k, l]) => row(k, l, false))}</div></div>
      <div><h3 className="ai-subhead">Sent and scheduled emails</h3><div className="ai-defaults">{sent.map(([k, l]) => row(k, l, true))}</div></div>
    </div>
    {asking && <div className="lock-confirm-backdrop" onClick={() => setAsking(false)}><div className="lock-confirm" role="dialog" aria-modal="true" aria-labelledby="lock-confirm-title" onClick={e => e.stopPropagation()}>
      <h3 id="lock-confirm-title"><i className="bi bi-exclamation-triangle-fill" aria-hidden="true" /> Are you sure?</h3>
      <p>Changing these settings can let AI agents see parts of your emails that are hidden now.</p>
      <label htmlFor="lock-word">Type <strong>Lock</strong> to continue</label>
      <input id="lock-word" className="form-control" autoFocus value={word} onChange={e => setWord(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && confirmsLock(word)) { setDraft(JSON.parse(JSON.stringify(value))); setAsking(false); } }} />
      <div className="ai-save-row"><button className="btn btn-sm btn-outline-secondary" onClick={() => setAsking(false)}>Cancel</button><button className="btn btn-sm btn-primary" disabled={!confirmsLock(word)} onClick={() => { setDraft(JSON.parse(JSON.stringify(value))); setAsking(false); }}>Continue</button></div>
    </div></div>}
  </>;
}
