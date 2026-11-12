// IMAP (read) + SMTP (send) for providers other than Gmail and Outlook.
// Only encrypted connections are allowed; hosts on private/loopback networks are refused
// so a signed-in user cannot make the server probe its own network.
import net from 'node:net';
import dns from 'node:dns/promises';

export const IMAP_PRESETS = {
  yahoo: { name: 'Yahoo Mail', imap: { host: 'imap.mail.yahoo.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl' } },
  icloud: { name: 'iCloud Mail', imap: { host: 'imap.mail.me.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' } },
  fastmail: { name: 'Fastmail', imap: { host: 'imap.fastmail.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.fastmail.com', port: 465, security: 'ssl' } },
  zoho: { name: 'Zoho Mail', imap: { host: 'imap.zoho.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.zoho.com', port: 465, security: 'ssl' } },
  gmx: { name: 'GMX', imap: { host: 'imap.gmx.com', port: 993, security: 'ssl' }, smtp: { host: 'mail.gmx.com', port: 587, security: 'starttls' } },
  aol: { name: 'AOL Mail', imap: { host: 'imap.aol.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.aol.com', port: 465, security: 'ssl' } },
};

const bad = code => Object.assign(new Error(code), { status: 400 });
const isPrivate = ip => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && isPrivate(v.slice(7));
};

/** Validates and normalizes user-entered settings. Throws 400 errors with plain codes. */
export function normalizeImap(input = {}, { allowPrivate = false } = {}) {
  const email = String(input.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('invalid_email');
  const side = (s = {}, defPort) => {
    const host = String(s.host || '').trim().toLowerCase();
    const port = Number(s.port || defPort);
    const security = s.security || 'ssl';
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') && !allowPrivate) throw bad('invalid_host');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('invalid_port');
    if (!['ssl', 'starttls'].includes(security)) throw bad('encryption_required');
    if (!allowPrivate && net.isIP(host) && isPrivate(host)) throw bad('private_host_not_allowed');
    return { host, port, security };
  };
  return { email, username: String(input.username || email).trim(), password: String(input.password || ''), name: String(input.name || '').trim().slice(0, 80), imap: side(input.imap, 993), smtp: side(input.smtp, 465) };
}

async function assertPublic(host, allowPrivate) {
  if (allowPrivate) return;
  const addrs = await dns.lookup(host, { all: true }).catch(() => { throw bad('server_not_found'); });
  if (addrs.some(a => isPrivate(a.address))) throw bad('private_host_not_allowed');
}

/** Turns library errors into short plain-language codes the UI can show. */
export function friendlyImapError(e) {
  const m = `${e?.responseText || ''} ${e?.response || ''} ${e?.message || ''} ${e?.code || ''}`.toLowerCase();
  if (/application-specific|app password|web login required|\[alert\] please log in via/.test(m)) return 'app_password_needed';
  if (/auth|login|credentials|invalid user|535|password/.test(m)) return 'wrong_password';
  if (/enotfound|eai_again|server_not_found/.test(m)) return 'server_not_found';
  if (/econnrefused|etimedout|timeout|ehostunreach|econnreset/.test(m)) return 'server_not_reachable';
  if (/certificate|self.signed|tls|ssl/.test(m)) return 'secure_connection_failed';
  return 'connection_failed';
}

export function createImapClient({ ImapFlow, nodemailer, allowPrivate = false }) {
  const imapClient = s => new ImapFlow({ host: s.imap.host, port: s.imap.port, secure: s.imap.security === 'ssl', doSTARTTLS: s.imap.security === 'starttls' ? true : undefined, auth: { user: s.username, pass: s.password }, logger: false, socketTimeout: 30_000 });
  const transport = s => nodemailer.createTransport({ host: s.smtp.host, port: s.smtp.port, secure: s.smtp.security === 'ssl', requireTLS: s.smtp.security === 'starttls', auth: { user: s.username, pass: s.password }, connectionTimeout: 15_000 });
  const wrap = fn => async (...a) => { try { return await fn(...a); } catch (e) { const code = e.status === 400 ? e.message : friendlyImapError(e); throw Object.assign(new Error(code), { status: 400 }); } };
  return {
    test: wrap(async s => {
      await assertPublic(s.imap.host, allowPrivate); await assertPublic(s.smtp.host, allowPrivate);
      const c = imapClient(s); await c.connect(); await c.logout();
      await transport(s).verify();
      return { ok: true };
    }),
    inbox: wrap(async (s, max = 25) => {
      await assertPublic(s.imap.host, allowPrivate);
      const c = imapClient(s); await c.connect();
      const out = [];
      try {
        const lock = await c.getMailboxLock('INBOX');
        try {
          const total = c.mailbox.exists || 0;
          if (total) for await (const m of c.fetch(`${Math.max(1, total - max + 1)}:*`, { uid: true, envelope: true, flags: true, internalDate: true, bodyParts: ['TEXT'] }, { partial: true })) {
            const from = m.envelope?.from?.[0];
            const text = (m.bodyParts?.get('text') || m.bodyParts?.get('TEXT') || Buffer.alloc(0)).toString('utf8').slice(0, 2000);
            out.push({ id: String(m.uid), from: from ? (from.name ? `${from.name} <${from.address}>` : from.address) : '', subject: m.envelope?.subject || '', date: new Date(m.internalDate || m.envelope?.date || Date.now()).toISOString(), snippet: text.replace(/<[^>]+>/g, ' ').replace(/=\r?\n/g, '').replace(/\s+/g, ' ').trim().slice(0, 300), read: m.flags?.has('\\Seen') || false });
          }
        } finally { lock.release(); }
      } finally { await c.logout().catch(() => {}); }
      return out.reverse();
    }),
    send: wrap(async (s, { to, subject, body }) => {
      await assertPublic(s.smtp.host, allowPrivate);
      await transport(s).sendMail({ from: s.name ? `"${s.name.replace(/"/g, '')}" <${s.email}>` : s.email, to, subject, text: body });
      return null;
    }),
  };
}
