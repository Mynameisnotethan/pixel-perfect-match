// Live mailbox mode: used when the desktop app (or a Docker deployment) exposes window.lockboxMailboxes.
// Without it, the preview falls back to demo mode.
import { MAILBOX_PROVIDERS } from './mailbox-demo.js';

export const liveBridge = () => (typeof window !== 'undefined' && window.lockboxMailboxes) || null;

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
