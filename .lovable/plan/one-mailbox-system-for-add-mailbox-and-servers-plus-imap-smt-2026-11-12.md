# One mailbox system for "Add mailbox" and "Servers", plus IMAP/SMTP

## What you'll get
- **Add mailbox** and **Settings → Servers** both stay, but show and manage the same list of mailboxes. Connecting, reconnecting, editing or removing in one place shows up instantly in the other.
- **Servers page** becomes a list of every connected mailbox (Gmail, Outlook, IMAP/SMTP) with its real status (Connected, Syncing, Needs reconnect, Error), last sync time, and Reconnect / Edit / Disconnect buttons. Its "Add account" button opens the same Add mailbox window.
- **Add mailbox** gets a third option: **Other email (IMAP/SMTP)**. The form asks for email address, password (or app password), and offers common presets (Yahoo, iCloud, Fastmail, Zoho, GMX, Proton Bridge, custom) that fill in incoming/outgoing server, port and security. A "Test connection" button checks both before saving, with plain-language errors ("wrong password", "server not reachable", "app password needed").
- Connected IMAP mailboxes sync their inbox and can send mail from Compose, like Gmail and Outlook.
- The old "Add sample IMAP account instead" link and "Sample account" wording are removed on your server. The Lovable preview keeps a clearly labelled demo, where IMAP connect is simulated.

## Where IMAP works
- Your Hostinger server and the desktop app: real connections.
- Lovable preview: demo only (it can't open mail server connections).

## Security
- IMAP passwords are stored encrypted on the server's data volume, tied to the signed-in account, and never sent back to the browser (edit shows "saved" with an option to replace).
- Only encrypted connections (SSL/TLS or STARTTLS) are allowed; plain unencrypted connections are refused.

## Technical details
- Add `connectors/imap.mjs` using `imapflow` (fetch INBOX headers/snippets, read flags) and `nodemailer` (SMTP send); expose `mail.imap.{profile,inbox,send,test}` alongside google/microsoft in `connectors/mail.mjs`.
- `server/index.mjs`: `POST /api/mailboxes/imap/test`, `POST /api/mailboxes/imap` (create/update, encrypted creds via existing crypto, upsert by provider+email), existing inbox/send/delete routes dispatch on `provider: 'imap'`. Rate-limit test endpoint; reject private/loopback hosts to avoid server-side request abuse.
- Desktop `main.mjs`/`preload.cjs`: same IMAP methods on `window.lockboxMailboxes`.
- Frontend: `mailbox-demo.js` adds `imap` provider + presets; `MailboxDialog.jsx` adds IMAP form; `App.jsx` Servers view renders `mailboxes` (single source) and reuses MailboxDialog; remove sample-account modal on live builds; `liveAccount` handles imap.
- Tests: preset-to-settings mapping, rejecting unencrypted/private hosts, credentials never in API responses, IMAP upsert dedupe, Servers and Add mailbox showing the same list.
- Real IMAP providers and Hostinger remain untested by me until deployed.
