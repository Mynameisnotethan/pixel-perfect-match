export const isReceived = m => !['sent', 'drafts', 'scheduled'].includes(m.folder);

export function mergeRanges(ranges) {
  const sorted = (ranges || []).filter(r => r[1] > r[0]).map(r => [...r]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) {
      if ((last[2] || null) === (r[2] || null)) last[1] = Math.max(last[1], r[1]);
      else if (r[1] > last[1]) out.push(r[2] ? [last[1], r[1], r[2]] : [last[1], r[1]]);
    } else out.push(r);
  }
  return out.filter(r => r[1] > r[0]);
}

export function addRanges(existing, added) {
  let base = existing || [];
  for (const r of added) base = subtractRange(base, r);
  return mergeRanges([...base, ...added]);
}

export function subtractRange(ranges, [s, e]) {
  const out = [];
  for (const [a, b, ...rest] of ranges || []) {
    if (b <= s || a >= e) { out.push([a, b, ...rest]); continue; }
    if (a < s) out.push([a, s, ...rest]);
    if (b > e) out.push([e, b, ...rest]);
  }
  return out;
}

export function segments(text, ranges) {
  const parts = []; let pos = 0;
  for (const [a, b, label] of mergeRanges(ranges || [])) {
    if (a > pos) parts.push({ start: pos, text: text.slice(pos, a), hidden: false });
    parts.push({ start: a, text: text.slice(a, b), hidden: true, label: label || null });
    pos = b;
  }
  if (pos < text.length) parts.push({ start: pos, text: text.slice(pos), hidden: false });
  return parts;
}

export const mask = s => s.replace(/[^\n]/g, '*');

export function hiddenLength(ranges) { return mergeRanges(ranges || []).reduce((n, [a, b]) => n + b - a, 0); }

export const privacyFields = [
  { field: 'body', key: 'hiddenRanges' },
  { field: 'subject', key: 'hiddenSubjectRanges' },
  { field: 'sender', key: 'hiddenSenderRanges' },
  { field: 'email', key: 'hiddenEmailRanges' },
];

export function selectionSegments(text, hiddenRanges, pendingRanges) {
  return segments(text, hiddenRanges).flatMap(part => {
    const pending = (pendingRanges || [])
      .map(([a, b]) => [a - part.start, b - part.start])
      .filter(([a, b]) => b > 0 && a < part.text.length)
      .map(([a, b]) => [Math.max(0, a), Math.min(part.text.length, b)]);
    return segments(part.text, pending).map(item => ({
      ...item,
      start: item.start + part.start,
      hidden: part.hidden,
      label: part.label || null,
      pending: item.hidden,
    }));
  });
}

export const presetLabels = [
  { id: 'financial', name: 'Financial info', color: '#16a34a' },
  { id: 'personal', name: 'Personal info', color: '#2563eb' },
  { id: 'password', name: 'Password', color: '#dc2626' },
  { id: 'address', name: 'Address', color: '#9333ea' },
  { id: 'phone', name: 'Phone number', color: '#ea580c' },
  { id: 'other', name: 'Other', color: '#64748b' },
];
const autoNames = { 'auto-subject': 'Subject', 'auto-sender': 'Sender name', 'auto-email': 'Sender email', 'auto-body': 'Body', 'auto-attachments': 'Attachment' };
export function labelFor(id, labels = presetLabels) {
  if (!id) return null;
  if (autoNames[id]) return { id, name: autoNames[id], color: '#64748b' };
  return labels.find(l => l.id === id) || null;
}
const tag = (id, labels) => { const l = labelFor(id, labels); return l ? `[hidden: ${l.name}]` : '[hidden]'; };

export function redact(text, ranges, labels) {
  return segments(text || '', ranges).map(part => part.hidden ? tag(part.label, labels) : part.text).join('');
}

export function applyDefaults(m, defaults) {
  if (!defaults || !isReceived(m)) return m;
  const out = { ...m };
  const ov = m.overrides || {};
  for (const { field, key } of privacyFields) {
    if (defaults[field] && !ov[field] && (m[field] || '').length) out[key] = [[0, m[field].length, 'auto-' + field]];
  }
  if (defaults.attachments && !ov.attachments) {
    out.hiddenAttachments = (m.attachments || []).map((_, i) => i);
    out.hiddenAttachmentLabels = { ...Object.fromEntries(out.hiddenAttachments.map(i => [i, 'auto-attachments'])), ...(m.hiddenAttachmentLabels || {}) };
  }
  return out;
}

export function fieldFullyHidden(text, ranges) {
  return Boolean((text || '').length) && hiddenLength(ranges) >= (text || '').length;
}

const whole = (len, label) => label ? [[0, len, label]] : [[0, len]];
export function togglePrivacyField(message, field, label) {
  const config = privacyFields.find(item => item.field === field);
  if (!config) return {};
  const text = message[field] || '';
  return {
    reviewed: true,
    overrides: { ...(message.overrides || {}), [field]: true },
    [config.key]: fieldFullyHidden(text, message[config.key]) || !text.length ? [] : whole(text.length, label),
  };
}

export function hideEntireMessage(message, label) {
  const atts = (message.attachments || []).map((_, index) => index);
  const patch = {
    reviewed: true,
    hiddenAttachments: atts,
    hiddenAttachmentLabels: label ? Object.fromEntries(atts.map(i => [i, label])) : {},
    overrides: { subject: true, sender: true, email: true, body: true, attachments: true },
  };
  for (const { field, key } of privacyFields) patch[key] = message[field]?.length ? whole(message[field].length, label) : [];
  return patch;
}

export function lockStatus(raw, defaults) {
  if (!raw.reviewed) return 'grey';
  const m = applyDefaults(raw, defaults);
  const textLen = privacyFields.reduce((length, { field }) => length + (m[field] || '').length, 0);
  const hidText = privacyFields.reduce((length, { key }) => length + hiddenLength(m[key]), 0);
  const atts = m.attachments?.length || 0;
  const hidAtts = (m.hiddenAttachments || []).filter(i => i < atts).length;
  if (hidText === 0 && hidAtts === 0) return 'green';
  if (hidText >= textLen && hidAtts >= atts) return 'red';
  return 'yellow';
}

export function aiView(raw, defaults, labels) {
  if (lockStatus(raw, defaults) === 'grey') return null;
  const m = applyDefaults(raw, defaults);
  const hidden = m.hiddenAttachments || [];
  return {
    id: m.id,
    from: redact(m.sender, m.hiddenSenderRanges, labels),
    email: redact(m.email, m.hiddenEmailRanges, labels),
    subject: redact(m.subject, m.hiddenSubjectRanges, labels),
    date: m.date,
    body: redact(m.body, m.hiddenRanges, labels),
    attachments: (m.attachments || []).map((a, i) => hidden.includes(i) ? { name: tag(m.hiddenAttachmentLabels?.[i], labels), hidden: true } : { name: a.name }),
  };
}
