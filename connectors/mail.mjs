// Mailbox operations for Gmail API and Microsoft Graph, behind one interface.
import MailComposer from 'nodemailer/lib/mail-composer';
import { graphAttachments, graphRecipients, mimeAttachments, normalizeOutgoing } from './outgoing.mjs';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GRAPH = 'https://graph.microsoft.com/v1.0/me';

async function api(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (res.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  if (!res.ok) throw Object.assign(new Error(`Provider request failed [${res.status}]: ${(await res.text()).slice(0, 300)}`), { providerStatus: res.status });
  return res.status === 202 || res.status === 204 ? null : res.json();
}
const MAX_DOWNLOAD = 25 * 1024 * 1024;
const fromB64Url = v => Buffer.from(String(v || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
/** Collects file parts (anything with a filename) from a Gmail payload tree. */
export function gmailAttachments(part, out = []) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push({ id: part.body.attachmentId, name: part.filename, type: part.mimeType || 'application/octet-stream', size: part.body.size || 0 });
  for (const p of part.parts || []) gmailAttachments(p, out);
  return out;
}
const tooBig = () => Object.assign(new Error('attachment_too_large'), { status: 413 });
const header = (headers, name) => headers?.find(h => h.name.toLowerCase() === name)?.value || '';
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** True when the provider says the item is gone (404/410). Network failures are rethrown. */
async function exists(url, token, check = () => true) {
  try { return check(await api(url, token)); } catch (e) { if (e.providerStatus === 404 || e.providerStatus === 410) return false; throw e; }
}
/** Raw MIME for a Gmail draft. Replies carry In-Reply-To/References so they thread; the body is only what was written. */
async function gmailRaw(from, d) {
  const mime = await new MailComposer({
    from, to: d.to || undefined, cc: d.cc || undefined, subject: d.subject, text: d.body,
    ...(d.reply?.inReplyTo ? { inReplyTo: d.reply.inReplyTo, references: [d.reply.references, d.reply.inReplyTo].filter(Boolean).join(' ') } : {}),
    headers: { 'X-Lockbox-Draft': d.id },
  }).compile().build();
  return b64url(d.bcc ? Buffer.concat([Buffer.from(`Bcc: ${d.bcc}\r\n`, 'utf8'), mime]) : mime);
}
const graphDraftBody = d => ({
  subject: d.subject, body: { contentType: 'Text', content: d.body },
  toRecipients: graphRecipients(d.to), ccRecipients: graphRecipients(d.cc), bccRecipients: graphRecipients(d.bcc),
});
const addr = v => (v || '').trim();

export const mail = {
  google: {
    async profile(token) { const p = await api(`${GMAIL}/profile`, token); return { email: p.emailAddress }; },
    async inbox(token, max = 25) {
      const list = await api(`${GMAIL}/messages?labelIds=INBOX&maxResults=${max}`, token);
      // Small pages; a production sync should batch these and track historyId.
      const msgs = await Promise.all((list.messages || []).map(m => api(`${GMAIL}/messages/${m.id}?format=full`, token)));
      return msgs.map(m => ({ id: m.id, from: header(m.payload.headers, 'from'), subject: header(m.payload.headers, 'subject'), date: new Date(Number(m.internalDate)).toISOString(), snippet: m.snippet, read: !m.labelIds?.includes('UNREAD'), attachments: gmailAttachments(m.payload) }));
    },
    async attachment(token, messageId, attachmentId) {
      const msg = await api(`${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`, token);
      const meta = gmailAttachments(msg.payload).find(a => a.id === attachmentId);
      if (!meta) throw Object.assign(new Error('attachment_not_found'), { status: 404 });
      if (meta.size > MAX_DOWNLOAD) throw tooBig();
      const r = await api(`${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, token);
      return { name: meta.name, type: meta.type, data: fromB64Url(r.data).toString('base64') };
    },
    async send(token, from, input) {
      const msg = normalizeOutgoing(input);
      const mime = await new MailComposer({
        from,
        to: msg.to,
        cc: msg.cc,
        bcc: msg.bcc,
        subject: msg.subject,
        text: msg.body,
        html: msg.html || undefined,
        attachments: mimeAttachments(msg.attachments),
      }).compile().build();
      // Gmail's API has no separate envelope: Bcc must be present in the raw
      // message for delivery. Gmail removes this header from recipients' copies.
      const raw = msg.bcc ? Buffer.concat([Buffer.from(`Bcc: ${msg.bcc}\r\n`, 'utf8'), mime]) : mime;
      return api(`${GMAIL}/messages/send`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }) });
    },
    // ---- AI drafts
    async replyContext(token, messageId) {
      const q = ['Message-ID', 'References', 'From', 'Reply-To', 'To', 'Cc', 'Subject'].map(h => `metadataHeaders=${h}`).join('&');
      const m = await api(`${GMAIL}/messages/${encodeURIComponent(messageId)}?format=metadata&${q}`, token);
      const h = n => header(m.payload?.headers, n);
      return { threadId: m.threadId, inReplyTo: h('message-id'), references: h('references'), from: addr(h('from')), replyTo: addr(h('reply-to')), to: addr(h('to')), cc: addr(h('cc')), subject: h('subject') };
    },
    async createDraft(token, from, d) {
      const r = await api(`${GMAIL}/drafts`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { raw: await gmailRaw(from, d), ...(d.reply?.threadId ? { threadId: d.reply.threadId } : {}) } }) });
      return { providerDraftId: r.id };
    },
    async updateDraft(token, from, pid, d) {
      await api(`${GMAIL}/drafts/${encodeURIComponent(pid)}`, token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pid, message: { raw: await gmailRaw(from, d), ...(d.reply?.threadId ? { threadId: d.reply.threadId } : {}) } }) });
    },
    async deleteDraft(token, pid) { await api(`${GMAIL}/drafts/${encodeURIComponent(pid)}`, token, { method: 'DELETE' }); },
    async sendDraft(token, pid) {
      const r = await api(`${GMAIL}/drafts/send`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pid }) });
      return { messageId: r?.id || null };
    },
    // Gmail removes a draft when it is sent, so a missing draft means it went out.
    draftExists: (token, pid) => exists(`${GMAIL}/drafts/${encodeURIComponent(pid)}?format=minimal`, token),
  },
  microsoft: {
    async profile(token) { const p = await api(`${GRAPH}?$select=mail,userPrincipalName`, token); return { email: p.mail || p.userPrincipalName }; },
    async inbox(token, max = 25) {
      const r = await api(`${GRAPH}/mailFolders/inbox/messages?$top=${max}&$orderby=receivedDateTime desc&$select=id,from,subject,receivedDateTime,bodyPreview,isRead,hasAttachments`, token);
      return Promise.all(r.value.map(async m => ({ id: m.id, from: m.from?.emailAddress?.address || '', subject: m.subject, date: m.receivedDateTime, snippet: m.bodyPreview, read: m.isRead,
        attachments: m.hasAttachments ? ((await api(`${GRAPH}/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,isInline`, token)).value || []).filter(a => !a.isInline || a.name).map(a => ({ id: a.id, name: a.name || 'attachment', type: a.contentType || 'application/octet-stream', size: a.size || 0 })) : [] })));
    },
    async attachment(token, messageId, attachmentId) {
      const a = await api(`${GRAPH}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, token);
      if ((a.size || 0) > MAX_DOWNLOAD) throw tooBig();
      if (!a.contentBytes) throw Object.assign(new Error('attachment_not_downloadable'), { status: 415 });
      return { name: a.name || 'attachment', type: a.contentType || 'application/octet-stream', data: a.contentBytes };
    },
    async send(token, _from, input) {
      const msg = normalizeOutgoing(input);
      return api(`${GRAPH}/sendMail`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        message: {
          subject: msg.subject,
          body: { contentType: msg.html ? 'HTML' : 'Text', content: msg.html || msg.body },
          toRecipients: graphRecipients(msg.to),
          ccRecipients: graphRecipients(msg.cc),
          bccRecipients: graphRecipients(msg.bcc),
          attachments: graphAttachments(msg.attachments),
        },
        saveToSentItems: true,
      }) });
    },
    // ---- AI drafts
    async replyContext(token, messageId) {
      const m = await api(`${GRAPH}/messages/${encodeURIComponent(messageId)}?$select=internetMessageId,conversationId,from,replyTo,toRecipients,ccRecipients,subject`, token);
      const list = r => (r || []).map(x => x.emailAddress?.address).filter(Boolean).join(', ');
      return { graphId: messageId, threadId: m.conversationId, inReplyTo: m.internetMessageId || '', references: '', from: m.from?.emailAddress?.address || '', replyTo: list(m.replyTo), to: list(m.toRecipients), cc: list(m.ccRecipients), subject: m.subject || '' };
    },
    async createDraft(token, _from, d) {
      // createReply threads the draft; its pre-filled quote is replaced right away by only what was written.
      const r = d.reply?.graphId
        ? await api(`${GRAPH}/messages/${encodeURIComponent(d.reply.graphId)}/createReply`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        : await api(`${GRAPH}/messages`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graphDraftBody(d)) });
      if (d.reply?.graphId) await api(`${GRAPH}/messages/${encodeURIComponent(r.id)}`, token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graphDraftBody(d)) });
      return { providerDraftId: r.id };
    },
    async updateDraft(token, _from, pid, d) {
      await api(`${GRAPH}/messages/${encodeURIComponent(pid)}`, token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graphDraftBody(d)) });
    },
    async deleteDraft(token, pid) { await api(`${GRAPH}/messages/${encodeURIComponent(pid)}`, token, { method: 'DELETE' }); },
    async sendDraft(token, pid) { await api(`${GRAPH}/messages/${encodeURIComponent(pid)}/send`, token, { method: 'POST' }); return { messageId: null }; },
    // Outlook moves a sent draft to Sent Items (new id), so a missing draft means it went out.
    draftExists: (token, pid) => exists(`${GRAPH}/messages/${encodeURIComponent(pid)}?$select=isDraft`, token, m => m?.isDraft !== false),
  },
};

/** Upsert by provider + address so reconnecting the same mailbox updates it. */
export function upsertMailbox(list, box) {
  const key = b => `${b.provider}:${b.email.toLowerCase()}`;
  const i = list.findIndex(b => key(b) === key(box));
  return i < 0 ? [...list, box] : list.map((b, j) => (j === i ? { ...b, ...box, id: b.id } : b));
}
