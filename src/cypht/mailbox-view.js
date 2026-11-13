// Resolve account navigation against the actual mailbox IDs. Provider IDs contain
// colons (for example google:user@example.com), so splitting the view is unsafe.
export function parseAccountView(view, accounts) {
  if (!view.startsWith('account:')) return null;
  const account = accounts.find(item => view === `account:${item.id}` || view.startsWith(`account:${item.id}:`));
  if (!account) return null;
  const suffix = view.slice(`account:${account.id}`.length);
  return { id: account.id, folder: suffix.startsWith(':') ? suffix.slice(1) || 'inbox' : 'inbox' };
}
