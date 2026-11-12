// Demo-mode mailbox connections for the preview. Live connections run in the desktop / Docker builds.
export const MAILBOX_PROVIDERS = {
  google: { name: 'Gmail', icon: 'google', color: '#d93025', hint: 'Gmail or Google Workspace' },
  microsoft: { name: 'Outlook', icon: 'microsoft', color: '#0060d9', hint: 'Outlook.com or Microsoft 365' },
  imap: { name: 'Other email', icon: 'envelope-at', color: '#008080', hint: 'Yahoo, iCloud, Fastmail and others (IMAP/SMTP)' },
};
// Server settings for common providers. Mirrors connectors/imap.mjs; "custom" leaves fields for the user.
export const IMAP_PRESETS = {
  yahoo: { name: 'Yahoo Mail', domains: ['yahoo.com', 'ymail.com'], imap: { host: 'imap.mail.yahoo.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl' }, appPassword: true },
  icloud: { name: 'iCloud Mail', domains: ['icloud.com', 'me.com', 'mac.com'], imap: { host: 'imap.mail.me.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' }, appPassword: true },
  fastmail: { name: 'Fastmail', domains: ['fastmail.com', 'fastmail.fm'], imap: { host: 'imap.fastmail.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.fastmail.com', port: 465, security: 'ssl' }, appPassword: true },
  zoho: { name: 'Zoho Mail', domains: ['zoho.com', 'zohomail.com'], imap: { host: 'imap.zoho.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.zoho.com', port: 465, security: 'ssl' } },
  gmx: { name: 'GMX', domains: ['gmx.com', 'gmx.net', 'gmx.de'], imap: { host: 'imap.gmx.com', port: 993, security: 'ssl' }, smtp: { host: 'mail.gmx.com', port: 587, security: 'starttls' } },
  aol: { name: 'AOL Mail', domains: ['aol.com'], imap: { host: 'imap.aol.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.aol.com', port: 465, security: 'ssl' }, appPassword: true },
  proton: { name: 'Proton Mail Bridge', domains: ['proton.me', 'protonmail.com'], imap: { host: '127.0.0.1', port: 1143, security: 'starttls' }, smtp: { host: '127.0.0.1', port: 1025, security: 'starttls' }, desktopOnly: true },
  custom: { name: 'Other / custom', domains: [], imap: { host: '', port: 993, security: 'ssl' }, smtp: { host: '', port: 465, security: 'ssl' } },
};
/** Picks a preset from the address's domain, falling back to custom. */
export const presetForEmail = email => Object.entries(IMAP_PRESETS).find(([, p]) => p.domains.includes(String(email).split('@')[1]?.toLowerCase()))?.[0] || 'custom';
export const IMAP_ERRORS = {
  wrong_password: 'The email server rejected the username or password.',
  app_password_needed: 'This provider needs an app password. Create one in your email account\'s security settings and use it here.',
  server_not_found: 'That server name could not be found. Check the incoming and outgoing server.',
  server_not_reachable: 'The server did not answer. Check the server name and port.',
  secure_connection_failed: 'A secure connection could not be made. Try the other security option.',
  encryption_required: 'Only encrypted connections (SSL/TLS or STARTTLS) are allowed.',
  private_host_not_allowed: 'This server address is on a private network and cannot be used from your Lockbox server.',
  invalid_host: 'Enter a valid server name, like imap.example.com.',
  invalid_port: 'Enter a port between 1 and 65535.',
  invalid_email: 'Enter a valid email address.',
  password_required: 'Enter your password or app password.',
  too_many_attempts: 'Too many tries. Wait a few minutes and try again.',
  connection_failed: 'Could not connect. Check your settings and try again.',
};
export const imapErrorText = msg => IMAP_ERRORS[String(msg || '').replace(/^[a-z_]+: /, '')] || IMAP_ERRORS[msg] || msg || IMAP_ERRORS.connection_failed;
export const mailboxId = (provider, email) => `mb-${provider}-${email.trim().toLowerCase()}`;
export const STATUS_TEXT = { connecting: 'Connecting…', syncing: 'Syncing inbox…', connected: 'Connected', reconnect: 'Reconnect required', error: 'Sync problem' };

/** Add a mailbox or, when the same provider + address is connected again, update it in place. */
export function upsertMailbox(list, box) {
  // Live mailboxes keep the id the server or desktop gave them.
  const id = box.id || mailboxId(box.provider, box.email);
  const same = b => b.id === id || (b.provider === box.provider && b.email.toLowerCase() === box.email.toLowerCase());
  if (list.some(same)) return list.map(b => (same(b) ? { ...b, ...box, id } : b));
  return list.some(b => b.id === id) ? list.map(b => (b.id === id ? { ...b, ...box, id } : b)) : [...list, { ...box, id }];
}
export const setStatus = (list, id, status) => list.map(b => (b.id === id ? { ...b, status } : b));
export const removeMailbox = (list, id) => list.filter(b => b.id !== id);
/** Account entry shown in the sidebar for a connected mailbox. */
export const accountFromMailbox = box => ({ id: box.id, name: `${box.provider === 'imap' ? (box.settings?.name || box.email.split('@')[1]) : MAILBOX_PROVIDERS[box.provider].name} (demo)`, email: box.email, color: MAILBOX_PROVIDERS[box.provider].color, host: box.provider === 'imap' ? box.settings?.imap?.host : box.provider === 'google' ? 'gmail.googleapis.com' : 'graph.microsoft.com', port: box.provider === 'imap' ? String(box.settings?.imap?.port || 993) : '443', type: box.provider === 'imap' ? 'IMAP / SMTP' : box.provider === 'google' ? 'Gmail API' : 'Microsoft Graph', demo: true });
