// Drafts an AI agent made through Lockbox. They live in Lockbox (and in the mailbox's own Drafts folder when
// the provider accepted them), so they are listed here separately from drafts written in this app.
import { useEffect, useState } from 'react';
import { liveBridge } from './mailbox-live.js';
const Icon = ({ name }) => <i aria-hidden="true" className={`bi bi-${name}`} />;

const when = v => v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
function badge(d) {
  if (d.sent || d.status === 'sent') return ['sent', 'Sent'];
  if (d.status === 'unknown' || d.status === 'sending') return ['warn', 'Sending — checking'];
  if (d.schedule_status === 'failed') return ['bad', 'Scheduled send failed'];
  if (d.send_at) return d.approved ? ['ok', `Scheduled ${when(d.send_at)}`] : ['warn', `Needs approval · ${when(d.send_at)}`];
  return d.approved ? ['ok', 'Approved'] : ['muted', 'Not approved'];
}

export default function AiDrafts() {
  const bridge = liveBridge();
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!bridge?.aiDrafts) return;
    let stop = false;
    const load = () => bridge.aiDrafts.list().then(d => { if (!stop) { setDrafts(d); setError(''); } }, e => !stop && setError(e.message));
    load(); const t = setInterval(load, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, [bridge]);
  if (!bridge?.aiDrafts || (!error && !drafts?.length)) return null;
  return <section className="ai-drafts" aria-label="Drafts from AI agents">
    <h2><Icon name="robot" /> From AI agents <span>{drafts?.length || 0}</span></h2>
    {error && <p className="ai-drafts-error">Could not load AI drafts: {error}</p>}
    <ul>{(drafts || []).map(d => { const [tone, label] = badge(d); return <li key={d.id}>
      <div className="ai-draft-main"><strong>{d.subject || '(no subject)'}</strong><span>To {d.to || '—'} · from {d.from} · v{d.version}</span>
        <span className={`ai-draft-store ${d.storage_status === 'saved' ? '' : 'bad'}`}><Icon name={d.storage_status === 'saved' ? 'check-circle' : 'exclamation-triangle'} /> {d.saved_in}{d.storage_status !== 'saved' && d.provider_error ? ` — ${d.provider_error}` : ''}</span></div>
      <div className="ai-draft-side"><span className={`ai-draft-badge ${tone}`}>{label}</span>
        {bridge.runtime === 'web' && !d.sent && !d.approved && <a className="btn btn-sm btn-outline-secondary" href={`/api/ai/approve/${encodeURIComponent(d.id)}`}>Review</a>}</div>
    </li>; })}</ul>
  </section>;
}
