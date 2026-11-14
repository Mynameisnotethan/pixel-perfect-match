// Turns drafts an AI agent made into ordinary Lockbox drafts. A draft the owner already has (edited,
// sent or deleted) is never brought back; a newer AI version replaces an untouched copy.
import { draftMessage, normalizeDraft } from './compose-utils.js';

export function aiDraftsToMessages(messages, aiDrafts, accountFor = () => null) {
  const byId = new Map(messages.map(m => [m.id, m]));
  let out = messages; let changed = false;
  for (const d of aiDrafts || []) {
    if (d.sent || d.status === 'sent') continue;
    const id = `ai-draft-${d.id}`; const have = byId.get(id);
    if (have && !(have.folder === 'drafts' && have.aiDraft && !have.aiDraft.edited && have.aiDraft.version < d.version)) continue;
    const msg = { ...draftMessage(normalizeDraft({ id, account: d.mailbox, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject || '', body: d.body || '' }, d.mailbox), accountFor(d.mailbox), 'drafts'), date: d.updatedAt || d.createdAt || new Date().toISOString(), aiDraft: { id: d.id, version: d.version } };
    out = have ? out.map(m => m.id === id ? msg : m) : [msg, ...out]; changed = true;
  }
  return changed ? out : messages;
}
