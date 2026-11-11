// Mailbox operations for Gmail API and Microsoft Graph, behind one interface.
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GRAPH = 'https://graph.microsoft.com/v1.0/me';

async function api(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (res.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  if (!res.ok) throw new Error(`Provider request failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
  return res.status === 202 || res.status === 204 ? null : res.json();
}
const header = (headers, name) => headers?.find(h => h.name.toLowerCase() === name)?.value || '';
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const encHeader = v => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

export const mail = {
  google: {
    async profile(token) { const p = await api(`${GMAIL}/profile`, token); return { email: p.emailAddress }; },
    async inbox(token, max = 25) {
      const list = await api(`${GMAIL}/messages?labelIds=INBOX&maxResults=${max}`, token);
      // Small pages; a production sync should batch these and track historyId.
      const msgs = await Promise.all((list.messages || []).map(m => api(`${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token)));
      return msgs.map(m => ({ id: m.id, from: header(m.payload.headers, 'from'), subject: header(m.payload.headers, 'subject'), date: new Date(Number(m.internalDate)).toISOString(), snippet: m.snippet, read: !m.labelIds?.includes('UNREAD') }));
    },
    async send(token, from, { to, subject, body }) {
      const raw = [`From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', '', body].join('\r\n');
      return api(`${GMAIL}/messages/send`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }) });
    },
  },
  microsoft: {
    async profile(token) { const p = await api(`${GRAPH}?$select=mail,userPrincipalName`, token); return { email: p.mail || p.userPrincipalName }; },
    async inbox(token, max = 25) {
      const r = await api(`${GRAPH}/mailFolders/inbox/messages?$top=${max}&$orderby=receivedDateTime desc&$select=id,from,subject,receivedDateTime,bodyPreview,isRead`, token);
      return r.value.map(m => ({ id: m.id, from: m.from?.emailAddress?.address || '', subject: m.subject, date: m.receivedDateTime, snippet: m.bodyPreview, read: m.isRead }));
    },
    async send(token, _from, { to, subject, body }) {
      return api(`${GRAPH}/sendMail`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { subject, body: { contentType: 'Text', content: body }, toRecipients: to.split(',').map(a => ({ emailAddress: { address: a.trim() } })) } }) });
    },
  },
};

/** Upsert by provider + address so reconnecting the same mailbox updates it. */
export function upsertMailbox(list, box) {
  const key = b => `${b.provider}:${b.email.toLowerCase()}`;
  const i = list.findIndex(b => key(b) === key(box));
  return i < 0 ? [...list, box] : list.map((b, j) => (j === i ? { ...b, ...box, id: b.id } : b));
}
