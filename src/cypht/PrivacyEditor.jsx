import { useState } from 'react';
import { addRanges, applyDefaults, fieldFullyHidden, fieldsFor, hideEntireMessage, labelFor, mergeRanges, selectionSegments, subtractRange, togglePrivacyField } from './privacy.js';

const Icon = ({ name }) => <i aria-hidden="true" className={`bi bi-${name}`} />;

export function PrivacyText({ field, text, hiddenRanges, pendingRanges, onSelect, onToggle, onUnpick, mode, labels, inline = false, title }) {
  const Tag = inline ? 'span' : 'div';
  const fullyHidden = fieldFullyHidden(text, hiddenRanges);
  const name = title || field;
  return <Tag className={`privacy-text selecting mode-${mode} ${inline ? 'privacy-inline' : ''}`} data-privacy-root="true" data-privacy-field={field} onMouseUp={onSelect}>
    <span className="privacy-text-content">{selectionSegments(text || '', hiddenRanges, pendingRanges).map(part => <span key={part.start} data-start={part.start} className={`${part.hidden ? 'hidden-text' : ''} ${part.pending ? 'pending-sel' : ''}`} onClick={part.pending ? event => { event.stopPropagation(); onUnpick?.(field, part.start, part.start + part.text.length); } : undefined} style={part.hidden && labelFor(part.label, labels) ? { '--label-color': labelFor(part.label, labels).color } : undefined} title={part.hidden ? labelFor(part.label, labels)?.name || 'Hidden' : undefined}>{part.text}</span>)}</span>
    <button type="button" className={`privacy-field-toggle ${fullyHidden ? 'is-hidden' : ''}`} title={fullyHidden ? `Reveal entire ${name}` : `Hide entire ${name}`} aria-label={fullyHidden ? `Reveal entire ${name}` : `Hide entire ${name}`} onMouseUp={event => event.stopPropagation()} onClick={event => { event.preventDefault(); event.stopPropagation(); onToggle(field); }}><Icon name={fullyHidden ? 'unlock-fill' : 'lock-fill'} /></button>
  </Tag>;
}

/** Shared lock-mode state + actions for any message-like object (received, sent, scheduled, or a draft). */
export function usePrivacyEditor({ message, defaults, label, labels, onPatch }) {
  const [mode, setModeRaw] = useState(null);
  const [pendRanges, setPendRanges] = useState([]);
  const [pendAtts, setPendAtts] = useState([]);
  const reset = () => { setPendRanges([]); setPendAtts([]); };
  const setMode = m => { setModeRaw(m); reset(); };
  const eff = message ? applyDefaults(message, defaults) : null;

  function captureSelection() {
    const selection = window.getSelection();
    if (!mode || !selection || selection.isCollapsed) return;
    const rootFor = node => (node?.nodeType === 3 ? node.parentElement : node)?.closest?.('[data-privacy-root]');
    const root = rootFor(selection.anchorNode);
    if (!root || root !== rootFor(selection.focusNode)) return;
    const offset = (node, nodeOffset) => { const range = document.createRange(); range.selectNodeContents(root); range.setEnd(node, nodeOffset); return range.toString().length; };
    const anchor = offset(selection.anchorNode, selection.anchorOffset);
    const focus = offset(selection.focusNode, selection.focusOffset);
    if (anchor === focus) return;
    setPendRanges(rs => [...rs, { field: root.dataset.privacyField, start: Math.min(anchor, focus), end: Math.max(anchor, focus) }]);
    selection.removeAllRanges();
  }
  function confirm() {
    if (!message) return;
    const overrides = { ...(message.overrides || {}) };
    const patch = { reviewed: true };
    for (const { field, key } of fieldsFor(message)) {
      const selected = pendRanges.filter(r => r.field === field).map(({ start, end }) => label && mode === 'lock' ? [start, end, label] : [start, end]);
      if (!selected.length) continue;
      let ranges = eff[key] || [];
      if (mode === 'lock') ranges = addRanges(ranges, selected);
      else selected.forEach(r => { ranges = subtractRange(ranges, r); });
      patch[key] = ranges; overrides[field] = true;
    }
    let atts = eff.hiddenAttachments || [];
    const attLabels = { ...(eff.hiddenAttachmentLabels || {}) };
    if (pendAtts.length) overrides.attachments = true;
    if (mode === 'lock') { atts = [...new Set([...atts, ...pendAtts])]; pendAtts.forEach(i => { if (label) attLabels[i] = label; else delete attLabels[i]; }); }
    else { atts = atts.filter(i => !pendAtts.includes(i)); pendAtts.forEach(i => delete attLabels[i]); }
    onPatch({ ...patch, overrides, hiddenAttachments: atts, hiddenAttachmentLabels: attLabels });
    reset();
  }
  function toggleField(field) {
    if (!message) return;
    onPatch(togglePrivacyField(eff, field, label));
    setPendRanges(rs => rs.filter(r => r.field !== field));
  }
  function hideAll() { if (!message) return; onPatch(hideEntireMessage(message, label)); reset(); }
  function pickAttachment(i) {
    // One tap hides or reveals the file, whichever mode the bar is in (same as the field lock buttons).
    if (!message || !eff) return;
    const hidden = eff.hiddenAttachments || [];
    const attLabels = { ...(eff.hiddenAttachmentLabels || {}) };
    let atts;
    if (hidden.includes(i)) { atts = hidden.filter(v => v !== i); delete attLabels[i]; }
    else { atts = [...hidden, i]; if (label) attLabels[i] = label; else delete attLabels[i]; }
    onPatch({ reviewed: true, overrides: { ...(message.overrides || {}), attachments: true }, hiddenAttachments: atts, hiddenAttachmentLabels: attLabels });
    setPendAtts(x => x.filter(v => v !== i));
  }
  const pendingFor = field => mergeRanges(pendRanges.filter(r => r.field === field).map(({ start, end }) => [start, end]));
  const text = (field, value, hiddenRanges, inline = false, title) => <PrivacyText field={field} title={title} text={value} hiddenRanges={hiddenRanges} pendingRanges={pendingFor(field)} labels={labels} onSelect={captureSelection} onToggle={toggleField} mode={mode} onUnpick={(f, a, b) => setPendRanges(rs => rs.filter(r => !(r.field === f && r.start < b && r.end > a)))} inline={inline} />;
  return { mode, setMode, eff, pendAtts, pending: pendRanges.length + pendAtts.length, confirm, toggleField, hideAll, pickAttachment, text, close: () => setMode(null) };
}
