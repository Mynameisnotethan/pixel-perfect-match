import { useState } from 'react';
import { isDuplicateLabel, labelPalette, makeLabel, removeLabel, restoreDefaultLabels, updateLabel } from './privacy.js';

function Swatches({ value, onChange, ariaLabel }) {
  return <div className="label-swatches" role="group" aria-label={ariaLabel}>
    {labelPalette.map(c => <button key={c} type="button" className={`color-swatch ${value === c ? 'is-on' : ''}`} style={{ '--label-color': c }} aria-label={`Colour ${c}`} aria-pressed={value === c} onClick={() => onChange(c)} />)}
  </div>;
}

export default function LabelManager({ labels, setLabels, onNotify, onAfterChange }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(labelPalette[0]);
  const [edit, setEdit] = useState(null);

  const apply = next => { setLabels(next); onAfterChange?.(next); };

  const add = event => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { onNotify('Give the label a name first.'); return; }
    if (isDuplicateLabel(trimmed, labels)) { onNotify(`You already have a label called “${trimmed}”.`); return; }
    const created = makeLabel(trimmed, color, labels);
    if (!created) return;
    apply([...labels, created]);
    setName('');
    setColor(labelPalette[0]);
    onNotify(`Label “${created.name}” added. Pick it in the bottom bar before hiding text.`);
  };

  const save = event => {
    event.preventDefault();
    const trimmed = edit.name.trim();
    if (!trimmed) { onNotify('Give the label a name first.'); return; }
    if (isDuplicateLabel(trimmed, labels.filter(l => l.id !== edit.id))) { onNotify(`You already have a label called “${trimmed}”.`); return; }
    apply(updateLabel(labels, edit.id, { name: trimmed, color: edit.color }));
    onNotify(`Label renamed to “${trimmed}”.`);
    setEdit(null);
  };

  const remove = label => {
    apply(removeLabel(labels, label.id));
    if (edit?.id === label.id) setEdit(null);
    onNotify(`Label “${label.name}” removed. Hidden text that used it now shows as [hidden].`);
  };

  return <div className="label-manager">
    <form className="label-form" onSubmit={add}>
      <input className="form-control form-control-sm" type="text" placeholder="New label name" aria-label="New label name" value={name} onChange={e => setName(e.target.value)} maxLength={40} />
      <Swatches value={color} onChange={setColor} ariaLabel="New label colour" />
      <button className="btn btn-sm btn-primary" type="submit"><i className="bi bi-plus-lg" aria-hidden="true" /> Add label</button>
    </form>
    <ul className="label-rows">
      {labels.map(l => edit?.id === l.id ? <li className="label-row is-editing" key={l.id}>
        <form className="label-edit" onSubmit={save}>
          <input className="form-control form-control-sm" type="text" aria-label={`Rename label ${l.name}`} value={edit.name} onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} maxLength={40} autoFocus />
          <Swatches value={edit.color} onChange={c => setEdit(v => ({ ...v, color: c }))} ariaLabel={`Colour for ${l.name}`} />
          <button className="btn btn-sm btn-primary" type="submit">Save</button>
          <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setEdit(null)}>Cancel</button>
        </form>
      </li> : <li className="label-row" key={l.id}>
        <span className="label-chip" style={{ '--label-color': l.color }}><span className="label-dot" />{l.name}</span>
        <span className="label-row-actions">
          <button type="button" className="btn btn-sm btn-outline-secondary" aria-label={`Edit label ${l.name}`} onClick={() => setEdit({ id: l.id, name: l.name, color: l.color })}><i className="bi bi-pencil" aria-hidden="true" /></button>
          <button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Delete label ${l.name}`} onClick={() => remove(l)}><i className="bi bi-trash" aria-hidden="true" /></button>
        </span>
      </li>)}
    </ul>
    <button type="button" className="btn btn-sm btn-link label-restore" onClick={() => { apply(restoreDefaultLabels()); onNotify('Default labels restored.'); }}><i className="bi bi-arrow-counterclockwise" aria-hidden="true" /> Restore default labels</button>
  </div>;
}
