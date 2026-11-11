# Connecting Gmail and Outlook mailboxes

Lockbox connects mailboxes with OAuth (Authorization Code + PKCE). Connecting a mailbox is separate from signing in to Lockbox itself.

| Piece | Location |
|---|---|
| Shared provider logic (OAuth, token refresh, Gmail API, Microsoft Graph) | `connectors/` |
| Desktop shell: system browser, loopback callback, OS credential vault | `desktop/` |
| Docker backend: HTTPS callbacks, encrypted token store | `server/`, `Dockerfile`, `docker-compose.yml` |
| Preview demo mode (no real sign-in) | `src/cypht/MailboxDialog.jsx`, `src/cypht/mailbox-demo.js` |

Permissions requested (no others):
- **Google:** `openid`, `email`, `gmail.readonly`, `gmail.send`
- **Microsoft:** `openid`, `email`, `offline_access`, `User.Read`, `Mail.Read`, `Mail.Send`

Lockbox refreshes tokens automatically. When a refresh fails permanently (`invalid_grant`, revoked consent), the mailbox switches to **Reconnect required**.

---

## 1. Google Cloud (Gmail + Google Workspace)

1. Go to https://console.cloud.google.com and create or choose a project.
2. Go to **APIs & Services → Library** and enable the **Gmail API**.
3. Under **Google Auth Platform → Branding / Audience**, set up the consent screen:
   - User type **External**. Use **Internal** if every user is in your Workspace.
   - Add the scopes listed above. `gmail.readonly` is a *restricted* scope. Public External apps need Google's verification, and possibly a security assessment, before people outside your test-user list can connect.
   - While the app is in **Testing**, add test users. Google expires their refresh tokens after 7 days. Publish the app to avoid this.
4. Go to **Credentials → Create credentials → OAuth client ID** and create two clients:
   - **Desktop app** (for `desktop/`). No redirect URI needs to be registered, because Google allows any `http://127.0.0.1:<port>` loopback.
   - **Web application** (for Docker). Authorised redirect URI: `https://<your-public-url>/oauth/google/callback`

## 2. Microsoft Entra (Outlook.com + Microsoft 365)

1. Go to https://entra.microsoft.com → **App registrations → New registration**.
2. Under **Supported account types**, pick *Accounts in any organizational directory and personal Microsoft accounts* so both Microsoft 365 and Outlook.com work.
3. Under **API permissions → Microsoft Graph → Delegated**, add `User.Read`, `Mail.Read`, `Mail.Send`, `offline_access`, `openid` and `email`. Tenants that block user consent need an admin to click **Grant admin consent**.
4. Under **Authentication**:
   - Desktop: add the **Mobile and desktop applications** platform with custom redirect `http://127.0.0.1` (Entra ignores the port for loopback). Enable **Allow public client flows**. Do not create a client secret for this registration.
   - Docker sign-in by code: **your own public desktop registration** works for every mailbox user on your deployment. Keep **Allow public client flows** on and put its ID in your environment or repo variable `LOCKBOX_MS_DEVICE_CLIENT_ID`. Independent deployers must use their own registration, not the original developer's.
   - Docker fallback for organizations that block codes: a separate registration (recommended) with the **Web** platform and redirect `https://<your-public-url>/oauth/microsoft/callback`. Under **Certificates & secrets**, create a client secret.

---

## 3. Desktop app

Development run (builds the bundled screens, then opens them; set `LOCKBOX_DEV_URL=http://localhost:8080` to use a dev server instead):

```bash
cd desktop && npm install
LOCKBOX_GOOGLE_DESKTOP_CLIENT_ID=... LOCKBOX_GOOGLE_DESKTOP_CLIENT_SECRET=... \
LOCKBOX_MS_DESKTOP_CLIENT_ID=... npm start
```

Official release / fork release. The three values below are baked into `release-config.json` inside the installer, so end users never enter anything. Only public desktop-client values go in; web-client secrets and `LOCKBOX_TOKEN_KEY` are never read.

```bash
cd desktop && npm install
export LOCKBOX_GOOGLE_DESKTOP_CLIENT_ID=...  LOCKBOX_GOOGLE_DESKTOP_CLIENT_SECRET=...
export LOCKBOX_MS_DESKTOP_CLIENT_ID=...
npm run dist:win     # Windows NSIS installer -> desktop/release/Lockbox Setup 0.1.0.exe
# npm run dist:mac / npm run dist:linux on those platforms
```

Build the Windows installer on Windows (or a Windows CI runner); building it on Linux needs Wine. The window only loads `LOCKBOX_URL`, and the mailbox bridge refuses calls from any other page.

## 4. Docker-hosted

Set the variables from `.env.lockbox.example` in Hostinger's Environment panel, or copy it to `.env` next to `docker-compose.yml`. Never commit it:

```
LOCKBOX_PUBLIC_URL=https://mail.example.com      # callbacks are derived from this
LOCKBOX_TOKEN_KEY=<32 random bytes, base64>      # openssl rand -base64 32
LOCKBOX_GOOGLE_CLIENT_ID=...
LOCKBOX_GOOGLE_CLIENT_SECRET=...
LOCKBOX_MS_CLIENT_ID=...
LOCKBOX_MS_CLIENT_SECRET=...
LOCKBOX_USER_HEADER=x-forwarded-user             # set by your auth proxy
# LOCKBOX_SINGLE_USER=1                          # alternative: one-user install
```

Routes:

| Route | Purpose |
|---|---|
| `GET /oauth/google/start`, `GET /oauth/microsoft/start` | Begin connect (redirects to the provider) |
| `GET /oauth/google/callback`, `GET /oauth/microsoft/callback` | Register these exact URLs with the providers |
| `GET /api/mailboxes` | List the signed-in user's mailboxes (no tokens) |
| `GET /api/mailboxes/:id/inbox` | Sync the latest inbox page |
| `POST /api/mailboxes/:id/send` | `{ to, subject, body }` |
| `DELETE /api/mailboxes/:id` | Disconnect |

Storage and security:
- Tokens are encrypted with AES-256-GCM using `LOCKBOX_TOKEN_KEY` and written to `/data/mailboxes.enc`. **Mount `/data` as a persistent volume** (the compose file does this). Losing the key or the volume means every mailbox must reconnect.
- Each mailbox belongs to the Lockbox user who authorised it. The user comes from `LOCKBOX_USER_HEADER`, so run the container **only** behind an HTTPS reverse proxy that authenticates users and sets that header. Never expose port 3000 directly.
- Logs record only the method, path and error message. Tokens, codes and query strings are never logged.
- Pending OAuth states are kept in memory for 10 minutes. Run one replica, or swap in a shared store.

```bash
docker compose up -d --build
```

## 5. What still needs live verification

None of the steps below have been run against real accounts yet:
- Connect a real Gmail / Workspace account and a real Outlook.com / Microsoft 365 account, on desktop and Docker.
- Load the inbox, send a test message, restart the app or container, and confirm the mailbox is still connected.
- Revoke access in the Google or Microsoft account settings and confirm **Reconnect required** appears.
- The UI uses live mode automatically inside the desktop app (`window.lockboxMailboxes`). Self-hosted web builds (`VITE_LOCKBOX_MAIL_API=1`, set in `Dockerfile.web`) use `/api/mailboxes`. See `docs/HOSTINGER_DEPLOY.md`.
- The Windows installer (`npm run dist:win`) has not been built here; only a Linux unpacked build was verified.


## Gmail restricted-scope verification (publisher)
`gmail.readonly` is restricted. Before the public desktop client works for anyone outside your test users, submit the
Google Auth Platform app for verification: privacy policy URL, homepage on a verified domain, a demo video of the
connect flow, and the annual third-party security assessment (CASA). Until then, the installer only works for listed test users.
Docker operators use their own Google client, so they are unaffected by this.
