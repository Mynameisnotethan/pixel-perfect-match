// Mailbox operations for Gmail API and Microsoft Graph, behind one interface.
import MailComposer from 'nodemailer/lib/mail-composer';
import { graphAttachments, graphRecipients, mimeAttachments, normalizeOutgoing } from './outgoing.mjs';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GRAPH = 'https://graph.microsoft.com/v1.0/me';

async function api(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (res.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  if (!res.ok) throw new Error(`Provider request failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
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
  },
};

/** Upsert by provider + address so reconnecting the same mailbox updates it. */
export function upsertMailbox(list, box) {
  const key = b => `${b.provider}:${b.email.toLowerCase()}`;
  const i = list.findIndex(b => key(b) === key(box));
  return i < 0 ? [...list, box] : list.map((b, j) => (j === i ? { ...b, ...box, id: b.id } : b));
}
