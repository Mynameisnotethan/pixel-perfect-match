export const isReceived = m => !['sent', 'drafts', 'scheduled'].includes(m.folder);

export function mergeRanges(ranges) {
  const sorted = ranges.filter(r => r[1] > r[0]).map(r => [...r]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push(r);
  }
  return out;
}

export function subtractRange(ranges, [s, e]) {
  const out = [];
  for (const [a, b] of ranges) {
    if (b <= s || a >= e) { out.push([a, b]); continue; }
    if (a < s) out.push([a, s]);
    if (b > e) out.push([e, b]);
  }
  return out;
}

export function segments(text, ranges) {
  const parts = []; let pos = 0;
  for (const [a, b] of mergeRanges(ranges || [])) {
    if (a > pos) parts.push({ start: pos, text: text.slice(pos, a), hidden: false });
    parts.push({ start: a, text: text.slice(a, b), hidden: true });
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
      pending: item.hidden,
    }));
  });
}

export function redact(text, ranges) {
  return segments(text || '', ranges).map(part => part.hidden ? '[hidden]' : part.text).join('');
}

export function lockStatus(m) {
  if (!m.reviewed) return 'grey';
  const textLen = privacyFields.reduce((length, { field }) => length + (m[field] || '').length, 0);
  const hidText = privacyFields.reduce((length, { key }) => length + hiddenLength(m[key]), 0);
  const atts = m.attachments?.length || 0;
  const hidAtts = (m.hiddenAttachments || []).filter(i => i < atts).length;
  if (hidText === 0 && hidAtts === 0) return 'green';
  if (hidText >= textLen && hidAtts >= atts) return 'red';
  return 'yellow';
}

export function aiView(m) {
  if (lockStatus(m) === 'grey') return null;
  const hidden = m.hiddenAttachments || [];
  return {
    id: m.id,
    from: redact(m.sender, m.hiddenSenderRanges),
    email: redact(m.email, m.hiddenEmailRanges),
    subject: redact(m.subject, m.hiddenSubjectRanges),
    date: m.date,
    body: redact(m.body, m.hiddenRanges),
    attachments: (m.attachments || []).map((a, i) => hidden.includes(i) ? { name: '[hidden]', hidden: true } : { name: a.name }),
  };
}
