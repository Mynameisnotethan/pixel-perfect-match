// Browser-safe pieces of the AI feed (no Node modules), shared by the screens, the server and the desktop app.
import { normalizeDefaults } from './privacy-core.mjs';

/** Per-message fields that make up hide-from-AI rules (everything else comes fresh from the mailbox). */
export const RULE_KEYS = ['reviewed', 'overrides', 'hiddenSubjectRanges', 'hiddenSenderRanges', 'hiddenEmailRanges', 'hiddenToRanges', 'hiddenRanges', 'hiddenAttachments', 'hiddenAttachmentLabels'];
export function rulesFrom(messages = []) {
  const out = {};
  for (const m of messages) {
    const r = {}; for (const k of RULE_KEYS) if (m[k] !== undefined) r[k] = m[k];
    if (Object.keys(r).length) out[m.id] = r;
  }
  return out;
}
export const pickRules = r => Object.fromEntries(RULE_KEYS.filter(k => r && r[k] !== undefined).map(k => [k, r[k]]));
/** Cleans a privacy document sent by the owner's screens before it is stored. */
export function cleanPrivacy(body = {}) {
  const rules = {};
  for (const [id, r] of Object.entries(body.rules || {}).slice(0, 20000)) if (typeof id === 'string' && id.length < 400 && r && typeof r === 'object') rules[id] = pickRules(r);
  const labels = Array.isArray(body.labels) ? body.labels.slice(0, 200).map(l => ({ id: String(l.id || ''), name: String(l.name || '').slice(0, 60), color: String(l.color || '') })) : undefined;
  return { rules, defaults: normalizeDefaults(body.defaults), ...(labels ? { labels } : {}) };
}

/** Splits "Name <a@b.c>" into its parts. */
export function parseFrom(from = '') {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { sender: m[1].trim() || m[2], email: m[2].trim() } : { sender: from.trim(), email: from.trim() };
}
/** Converts synced provider inbox items into Lockbox messages for one mailbox. */
export const inboxToMessages = (box, items) => items.map(item => {
  const { sender, email } = parseFrom(item.from);
  return { id: `${box.id}:${item.id}`, sender, email, subject: item.subject || '(no subject)', body: item.snippet || '', account: box.id, folder: 'inbox', read: !!item.read, flagged: false, date: item.date, attachments: (item.attachments || []).map(a => ({ name: a.name, type: a.type, size: a.size, remote: { message: String(item.id), id: String(a.id) } })) };
});

