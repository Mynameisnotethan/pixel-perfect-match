// Live mailbox mode: used when the desktop app (or a Docker deployment) exposes window.lockboxMailboxes.
// Without it, the preview falls back to demo mode.
import { MAILBOX_PROVIDERS } from './mailbox-demo.js';

// Self-hosted web builds (VITE_LOCKBOX_MAIL_API=1) talk to the Lockbox mail server on the same domain.
async function api(path, init) {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Request failed (${res.status})`); }
  return res.status === 204 ? null : res.json();
}
const webBridge = {
  runtime: 'web',
  list: () => api('/api/mailboxes'),
  // The browser goes to Google/Microsoft and comes back to Lockbox; the server stores the tokens.
  providers: () => api('/api/mailboxes/providers'),
  getSetup: () => api('/api/admin/setup'),
  saveSetup: body => api('/api/admin/setup', { method: 'PUT', body: JSON.stringify(body) }),
  // Gmail (and Outlook when the admin set up a web app): the browser goes to the provider and back.
  // Outlook otherwise uses a one-time code, so no Entra app is needed on this server.
  connect: async (provider, ui = {}) => {
    const mode = (await webBridge.providers())[provider];
    if (mode === 'none') throw new Error(provider === 'google' ? 'Gmail is not set up on this server yet. An admin needs to finish Setup.' : 'Outlook sign-in is not available on this server yet.');
    if (mode === 'web') { window.location.assign(`/oauth/${provider}/start`); return new Promise(() => {}); }
    const d = await api('/api/mailboxes/device/start', { method: 'POST' });
    ui.onDeviceCode?.(d);
    try { return await waitForDevice(d, ui); } finally { ui.onDeviceCode?.(null); }
  },
  sync: id => api(`/api/mailboxes/${encodeURIComponent(id)}/inbox`),
  send: (id, msg) => api(`/api/mailboxes/${encodeURIComponent(id)}/send`, { method: 'POST', body: JSON.stringify(msg) }),
  disconnect: id => api(`/api/mailboxes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
async function waitForDevice(d, ui, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  let wait = d.interval * 1000;
  while (Date.now() < d.expiresAt) {
    await sleep(wait);
    if (ui.cancelled?.()) throw new Error('Sign-in was cancelled.');
    const r = await api('/api/mailboxes/device/poll', { method: 'POST', body: JSON.stringify({ handle: d.handle }) });
    if (r.status === 'done') return r.mailbox;
    if (r.status === 'slow_down') wait += 5000;
  }
  throw new Error('The code expired. Start again.');
}
export { waitForDevice };
export const liveBridge = () => {
  if (typeof window === 'undefined') return null;
  if (window.lockboxMailboxes) return window.lockboxMailboxes;
  return import.meta.env?.VITE_LOCKBOX_MAIL_API === '1' ? webBridge : null;
};

/** Splits "Name <a@b.c>" into its parts. */
export function parseFrom(from = '') {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { sender: m[1].trim() || m[2], email: m[2].trim() } : { sender: from.trim(), email: from.trim() };
}

/** Converts synced provider inbox items into Lockbox messages for one mailbox. */
export const inboxToMessages = (box, items) => items.map(item => {
  const { sender, email } = parseFrom(item.from);
  return { id: `${box.id}:${item.id}`, sender, email, subject: item.subject || '(no subject)', body: item.snippet || '', account: box.id, folder: 'inbox', read: !!item.read, flagged: false, date: item.date, attachments: [] };
});

export const liveAccount = box => ({ id: box.id, name: MAILBOX_PROVIDERS[box.provider].name, email: box.email, color: MAILBOX_PROVIDERS[box.provider].color, host: box.provider === 'google' ? 'gmail.googleapis.com' : 'graph.microsoft.com', port: '443', type: box.provider === 'google' ? 'Gmail API' : 'Microsoft Graph', live: true });
