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

export function lockStatus(m) {
  if (!m.reviewed) return 'grey';
  const textLen = (m.body || '').length;
  const hidText = hiddenLength(m.hiddenRanges);
  const atts = m.attachments?.length || 0;
  const hidAtts = (m.hiddenAttachments || []).filter(i => i < atts).length;
  if (hidText === 0 && hidAtts === 0) return 'green';
  if (hidText >= textLen && hidAtts >= atts) return 'red';
  return 'yellow';
}

export function aiView(m) {
  if (lockStatus(m) === 'grey') return null;
  const body = segments(m.body || '', m.hiddenRanges).map(p => p.hidden ? '[hidden]' : p.text).join('');
  const hidden = m.hiddenAttachments || [];
  return {
    id: m.id, from: m.sender, email: m.email, subject: m.subject, date: m.date, body,
    attachments: (m.attachments || []).map((a, i) => hidden.includes(i) ? { name: '[hidden]', hidden: true } : { name: a.name }),
  };
}
