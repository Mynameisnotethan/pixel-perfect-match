# Shipping Lockbox to a Hostinger VPS (via GitHub)

Result: `https://mail.yourdomain.com` runs Lockbox with live Gmail/Outlook, updates on every push to GitHub, and GitHub builds the Windows installer.

```text
browser / desktop app ──https──> Caddy (certificate + login) ──> web  (Lockbox screens)
                                                           └──> mail (Gmail/Outlook, encrypted tokens in a volume)
```

## 1. One-time server setup
1. Buy a **Hostinger VPS** (KVM 1 or bigger) with the **Ubuntu 24.04 + Docker** template. Shared "Web Hosting" plans will not work.
2. In your DNS, add an `A` record: `mail` → the VPS IP address.
3. Connect Lovable to GitHub (Project settings → Git). On the VPS:
   ```bash
   ssh root@<vps-ip>
   git clone https://github.com/<you>/<repo>.git ~/lockbox   # private repo: use a deploy key or token
   cd ~/lockbox && cp .env.lockbox.example .env.lockbox && nano .env.lockbox
   ```
4. Fill in `.env.lockbox` (only these four are required):
   - `LOCKBOX_DOMAIN`: your domain.
   - `LOCKBOX_TOKEN_KEY`: `openssl rand -base64 32`. **Back it up** — losing it means everyone reconnects.
   - `LOCKBOX_LOGIN_USER` and `LOCKBOX_LOGIN_HASH`: `docker run --rm caddy:2-alpine caddy hash-password --plaintext 'pick-a-password'`
5. Start it: `docker compose up -d --build`.
6. Open `https://mail.yourdomain.com` → Add mailbox → log in as `LOCKBOX_LOGIN_USER` (the admin) → **Setup**:
   - **Address:** your https address. Lockbox then shows the exact Google callback URL with a Copy button.
   - **Gmail:** create a Google *Web application* client with that callback and paste its ID and secret (once per server).
   - **Outlook:** nothing to do. People connect with a one-time code using the publisher's Outlook client.
     If an organization blocks sign-in by code, add your own Entra Web app here instead.
   Settings and secrets are stored encrypted in the `lockbox-data` volume and are never sent back to the browser.

## 2. Automatic updates from GitHub
In GitHub → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `HOSTINGER_HOST` | VPS IP |
| `HOSTINGER_USER` | `root` (or your SSH user) |
| `HOSTINGER_SSH_KEY` | a private SSH key whose public half is in the VPS `~/.ssh/authorized_keys` |
| `HOSTINGER_APP_DIR` | optional, defaults to `~/lockbox` |

Every change you make in Lovable syncs to GitHub's `main` branch, and `.github/workflows/deploy-hostinger.yml` pulls and rebuilds on the VPS. Mailbox connections survive updates (they live in the `lockbox-data` volume).

## 3. Windows installer from GitHub
The installer bundles the Lockbox screens and talks to Google/Microsoft directly: it needs no server.
Add these secrets: `LOCKBOX_GOOGLE_DESKTOP_CLIENT_ID`, `LOCKBOX_GOOGLE_DESKTOP_CLIENT_SECRET`, `LOCKBOX_MS_DESKTOP_CLIENT_ID` (the **Desktop** registrations, not the web ones).
Then GitHub → Actions → **Windows installer** → Run workflow, and download the `.exe` from the run. Pushing a tag like `v0.1.0` attaches it to a GitHub Release for public download.
The installer is unsigned, so Windows SmartScreen will warn until you add a code-signing certificate.

## 4. Docker images
`.github/workflows/docker-images.yml` publishes `ghcr.io/<you>/lockbox-mail` and `lockbox-web` on every push to `main`.
Set the repo **variable** `LOCKBOX_MS_DEVICE_CLIENT_ID` (your public Outlook client) so it is baked into the mail image.
Hostinger keeps building from source by default; to use the images instead, replace `build:` with `image:` in `docker-compose.yml`.

## Notes
- The Lockbox login protects mailbox access; each login name gets its own mailboxes. To add people, add more lines inside `basic_auth` in `deploy/Caddyfile`.
- Desktop users connect mail on their own PC (tokens in Windows Credential Manager); the server never sees them.
- Logs: `docker compose logs -f mail`.
