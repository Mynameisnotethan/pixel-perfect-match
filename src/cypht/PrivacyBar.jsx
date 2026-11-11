export default function PrivacyBar({ mode, setMode, onConfirm, onClose, onHideAll, pending }) {
  return <div className="privacy-bar" role="toolbar" aria-label="Hide from AI">
    <button className={`privacy-mode ${mode === 'lock' ? 'is-on' : ''}`} aria-pressed={mode === 'lock'} title="Lock: select text or attachments to hide" onClick={() => setMode('lock')}><i className="bi bi-lock-fill" /></button>
    <button className={`privacy-mode ${mode === 'unlock' ? 'is-on' : ''}`} aria-pressed={mode === 'unlock'} title="Unlock: select hidden parts to reveal" onClick={() => setMode('unlock')}><i className="bi bi-unlock-fill" /></button>
    <button className="btn btn-sm btn-outline-secondary privacy-hide-all" aria-label="Hide all" onClick={onHideAll}><i className="bi bi-lock-fill" aria-hidden="true" /> Hide all</button>
    <button className="btn btn-sm btn-primary" disabled={!pending} onClick={onConfirm}>Confirm</button>
    <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>Done</button>
  </div>;
}
