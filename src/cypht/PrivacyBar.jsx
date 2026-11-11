import { useState } from 'react';
import { labelPalette } from './privacy.js';

const palette = labelPalette;

export default function PrivacyBar({ mode, setMode, onConfirm, onClose, onHideAll, pending, labels, label, setLabel, onAddLabel }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(palette[0]);
  const current = labels.find(l => l.id === label);
  const save = () => { if (!name.trim()) return; onAddLabel({ id: 'custom-' + Date.now(), name: name.trim(), color }); setName(''); setAdding(false); };
  return <div className="privacy-bar" role="toolbar" aria-label="Hide from AI">
    <div className="privacy-mode-group" role="group" aria-label="Privacy selection mode">
      <button className={`privacy-mode ${mode === 'lock' ? 'is-on' : ''}`} aria-pressed={mode === 'lock'} title="Lock: select text or attachments to hide" onClick={() => setMode('lock')}><i className="bi bi-lock-fill" aria-hidden="true" /><span>Lock</span></button>
      <button className={`privacy-mode ${mode === 'unlock' ? 'is-on' : ''}`} aria-pressed={mode === 'unlock'} title="Unlock: select hidden parts to reveal" onClick={() => setMode('unlock')}><i className="bi bi-unlock-fill" aria-hidden="true" /><span>Unlock</span></button>
    </div>
    {mode === 'lock' && <div className="privacy-label-picker">
      <span className="privacy-label-swatch" style={current ? { '--label-color': current.color } : undefined} />
      <select className="form-select form-select-sm" aria-label="Label for hidden text" value={label} onChange={e => { if (e.target.value === '__new') setAdding(true); else setLabel(e.target.value); }}>
        <option value="">No label</option>
        {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        <option value="__new">Custom…</option>
      </select>
      {adding && <div className="privacy-new-label">
        <input type="text" className="form-control form-control-sm" placeholder="Label name" aria-label="New label name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} autoFocus />
        {palette.map(c => <button key={c} type="button" aria-label={`Colour ${c}`} className={`color-swatch ${color === c ? 'is-on' : ''}`} style={{ '--label-color': c }} onClick={() => setColor(c)} />)}
        <button type="button" className="btn btn-sm btn-primary" onClick={save}>Add</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAdding(false)}>Cancel</button>
      </div>}
    </div>}
    <button className="btn btn-sm btn-outline-secondary privacy-hide-all" aria-label="Hide all" onClick={onHideAll}><i className="bi bi-lock-fill" aria-hidden="true" /> Hide all</button>
    <div className="privacy-bar-actions">
      <button className="btn btn-sm btn-primary" disabled={!pending} onClick={onConfirm}>Confirm</button>
      <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>Done</button>
    </div>
  </div>;
}
