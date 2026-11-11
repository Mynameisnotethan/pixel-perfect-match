export default function PrivacyBar({ mode, setMode, onConfirm, onClose, pending }) {
  return <div className="privacy-bar" role="toolbar" aria-label="Hide from AI">
    <button className={`privacy-mode ${mode === 'lock' ? 'is-on' : ''}`} aria-pressed={mode === 'lock'} title="Lock: select text or attachments to hide" onClick={() => setMode('lock')}><i className="bi bi-lock-fill" /></button>
    <button className={`privacy-mode ${mode === 'unlock' ? 'is-on' : ''}`} aria-pressed={mode === 'unlock'} title="Unlock: select hidden parts to reveal" onClick={() => setMode('unlock')}><i className="bi bi-unlock-fill" /></button>
    <span className="privacy-hint">{pending ? `${pending} selected` : mode === 'lock' ? 'Highlight text or click attachments to hide' : 'Highlight hidden text or click hidden attachments to reveal'}</span>
    <button className="btn btn-sm btn-primary" disabled={!pending} onClick={onConfirm}>Confirm</button>
    <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>Done</button>
  </div>;
}
