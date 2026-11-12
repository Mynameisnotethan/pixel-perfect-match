# Real mail mode on Hostinger

## What's wrong
Your server sign-in works ("Signed in as et"), but the inbox screen still loads the built-in sample emails, sample accounts (Personal, Work, Outlook) and sample contacts, and keeps the demo wording ("About this preview", "Reset sample data", "Demo: ... is connected"). The real mailbox pieces are hidden behind that demo data. The Lockbox logo also shows as broken.

## What changes
1. **Starts empty on a real server.** When Lockbox runs on your server or the desktop app, it starts with no sample emails, accounts, contacts or drafts. Your inbox fills only from mailboxes you connect.
2. **Kept apart from demo data.** Real-mode data is saved separately from the preview's sample data, so old sample emails saved in your browser disappear on the server version.
3. **Empty-state welcome.** With no mailbox connected, the inbox shows "Connect your Gmail or Outlook" with an **Add mailbox** button (and **Setup** for admins when credentials are missing).
4. **Real inbox loading.** After connecting, and on every visit/refresh, Lockbox loads each connected mailbox's inbox from the server, shows "Reconnect required" when access has expired, and shows clear errors instead of failing silently.
5. **Back from Google/Microsoft.** When you return from Google sign-in, Lockbox opens straight to the new mailbox and loads it, or explains what went wrong (e.g. "Gmail isn't set up yet").
6. **No demo wording in real mode.** Hide "About this preview", sample-data reset/export, "Add sample IMAP account", fake welcome email, simulated failures and "Simulate expiry". The Lovable preview keeps everything as it is now.
7. **Fix the broken logo** in the hosted version.

## After this you'll do
Push happens automatically -> wait for the "Docker images" run on GitHub -> in Hostinger, redeploy (pull latest images) -> sign in -> **Add mailbox -> Setup** to paste your Google / Microsoft keys -> connect your inbox.

## Not verifiable here
I can't sign in to a real Gmail/Outlook or your Hostinger VPS from here; I'll test against a local copy of the server with fake mailbox responses.

## Technical details
- `App.jsx`: pick `mode = liveBridge() ? 'live' : 'demo'`; in live mode `useSaved` uses a `lockbox-live:` key prefix and empty initial values (no `seedMessages`/`initialAccounts`/`initialContacts`); accounts derived from `bridge.list()`.
- On mount and refresh: `bridge.list()` then `bridge.sync(id)` per mailbox, merge via `inboxToMessages`; 401/expired -> mailbox status `reconnect`.
- Handle `?connected=` / `?error=` query after OAuth callback redirect (confirm what `server/index.mjs` redirects with; add if missing), then strip it from the URL.
- Gate demo-only UI (banner, reset/export, sample IMAP, welcome message, simulated failure, Simulate expiry) on `mode === 'demo'`.
- Logo: check the asset URL resolves in the Node build (`Dockerfile.web`); bundle the image file if the pointer URL fails offline/self-hosted.
- Tests: live mode starts with zero messages/accounts; demo mode still seeds samples; OAuth return query handled.
