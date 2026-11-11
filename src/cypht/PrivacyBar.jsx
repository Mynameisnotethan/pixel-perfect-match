export default function PrivacyBar({ mode, setMode, onConfirm, onClose, onHideAll, pending }) {
  return <div className="privacy-bar" role="toolbar" aria-label="Hide from AI">
    <div className="privacy-mode-group" role="group" aria-label="Privacy selection mode">
      <button className={`privacy-mode ${mode === 'lock' ? 'is-on' : ''}`} aria-pressed={mode === 'lock'} title="Lock: select text or attachments to hide" onClick={() => setMode('lock')}><i className="bi bi-lock-fill" aria-hidden="true" /><span>Lock</span></button>
      <button className={`privacy-mode ${mode === 'unlock' ? 'is-on' : ''}`} aria-pressed={mode === 'unlock'} title="Unlock: select hidden parts to reveal" onClick={() => setMode('unlock')}><i className="bi bi-unlock-fill" aria-hidden="true" /><span>Unlock</span></button>
    </div>
    <button className="btn btn-sm btn-outline-secondary privacy-hide-all" aria-label="Hide all" onClick={onHideAll}><i className="bi bi-lock-fill" aria-hidden="true" /> Hide all</button>
    <div className="privacy-bar-actions">
      <button className="btn btn-sm btn-primary" disabled={!pending} onClick={onConfirm}>Confirm</button>
      <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>Done</button>
    </div>
  </div>;
}
