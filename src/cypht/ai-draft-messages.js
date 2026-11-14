// Turns drafts an AI agent made into ordinary Lockbox drafts, and AI-scheduled emails into Scheduled items.
// A draft the owner already has (edited or deleted) is never brought back; a newer AI version replaces an
// untouched copy. Scheduled/sent state always follows Lockbox's server-side queue, which is the source of truth.
import { draftMessage, normalizeDraft } from './compose-utils.js';

export const AI_SCHEDULE_LABELS = { queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', awaiting_approval: 'Waiting for your approval', needs_approval: 'Needs approval' };

export function aiDraftsToMessages(messages, aiDrafts, accountFor = () => null) {
  const byId = new Map(messages.map(m => [m.id, m]));
  let out = messages; let changed = false;
  const put = (id, msg, have) => { out = have ? out.map(m => m.id === id ? msg : m) : [msg, ...out]; changed = true; };
  for (const d of aiDrafts || []) {
    const id = `ai-draft-${d.id}`; const have = byId.get(id);
    const sent = d.sent || d.status === 'sent';
    const base = () => ({ ...draftMessage(normalizeDraft({ id, account: d.mailbox, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject || '', body: d.body || '' }, d.mailbox), accountFor(d.mailbox), 'drafts'), date: d.updatedAt || d.createdAt || new Date().toISOString(), aiDraft: { id: d.id, version: d.version } });
    if (have?.folder === 'trash') continue;
    if (sent) {
      if (have && have.folder !== 'sent') put(id, { ...have, folder: 'sent', aiStatus: 'sent', date: d.updatedAt || have.date }, have);
      continue;
    }
    if (d.send_at) {
      const status = d.schedule_status || 'awaiting_approval';
      if (have && have.folder === 'drafts' && have.aiDraft?.edited) continue;
      if (have && have.folder === 'scheduled' && have.aiStatus === status && have.scheduledAt === d.send_at && have.aiDraft?.version === d.version) continue;
      put(id, { ...base(), folder: 'scheduled', scheduledAt: d.send_at, aiStatus: status }, have);
      continue;
    }
    if (have?.folder === 'scheduled') { put(id, base(), have); continue; } // schedule was cancelled
    if (have && !(have.folder === 'drafts' && have.aiDraft && !have.aiDraft.edited && have.aiDraft.version < d.version)) continue;
    put(id, base(), have);
  }
  return changed ? out : messages;
}
