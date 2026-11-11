// Demo-mode mailbox connections for the preview. Live connections run in the desktop / Docker builds.
export const MAILBOX_PROVIDERS = {
  google: { name: 'Gmail', icon: 'google', color: '#d93025', hint: 'Gmail or Google Workspace' },
  microsoft: { name: 'Outlook', icon: 'microsoft', color: '#0060d9', hint: 'Outlook.com or Microsoft 365' },
};
export const mailboxId = (provider, email) => `mb-${provider}-${email.trim().toLowerCase()}`;
export const STATUS_TEXT = { connecting: 'Connecting…', syncing: 'Syncing inbox…', connected: 'Connected', reconnect: 'Reconnect required' };

/** Add a mailbox or, when the same provider + address is connected again, update it in place. */
export function upsertMailbox(list, box) {
  const id = mailboxId(box.provider, box.email);
  return list.some(b => b.id === id) ? list.map(b => (b.id === id ? { ...b, ...box, id } : b)) : [...list, { ...box, id }];
}
export const setStatus = (list, id, status) => list.map(b => (b.id === id ? { ...b, status } : b));
export const removeMailbox = (list, id) => list.filter(b => b.id !== id);
/** Account entry shown in the sidebar for a connected mailbox. */
export const accountFromMailbox = box => ({ id: box.id, name: `${MAILBOX_PROVIDERS[box.provider].name} (demo)`, email: box.email, color: MAILBOX_PROVIDERS[box.provider].color, host: box.provider === 'google' ? 'gmail.googleapis.com' : 'graph.microsoft.com', port: '443', type: box.provider === 'google' ? 'Gmail API' : 'Microsoft Graph', demo: true });
