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
const header = (headers, name) => headers?.find(h => h.name.toLowerCase() === name)?.value || '';

export const mail = {
  google: {
    async profile(token) { const p = await api(`${GMAIL}/profile`, token); return { email: p.emailAddress }; },
    async inbox(token, max = 25) {
      const list = await api(`${GMAIL}/messages?labelIds=INBOX&maxResults=${max}`, token);
      // Small pages; a production sync should batch these and track historyId.
      const msgs = await Promise.all((list.messages || []).map(m => api(`${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token)));
      return msgs.map(m => ({ id: m.id, from: header(m.payload.headers, 'from'), subject: header(m.payload.headers, 'subject'), date: new Date(Number(m.internalDate)).toISOString(), snippet: m.snippet, read: !m.labelIds?.includes('UNREAD') }));
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
      const r = await api(`${GRAPH}/mailFolders/inbox/messages?$top=${max}&$orderby=receivedDateTime desc&$select=id,from,subject,receivedDateTime,bodyPreview,isRead`, token);
      return r.value.map(m => ({ id: m.id, from: m.from?.emailAddress?.address || '', subject: m.subject, date: m.receivedDateTime, snippet: m.bodyPreview, read: m.isRead }));
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
