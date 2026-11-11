# Shipping Lockbox to a Hostinger VPS (via GitHub)

Result: `https://mail.yourdomain.com` runs Lockbox with live Gmail/Outlook, updates on every push to GitHub, and GitHub builds the Windows installer.

**Independent ownership:** every deployer uses their own GitHub copy, VPS, domain, Google/Microsoft registrations, and encrypted storage. The upstream project provides source code only; no mailbox traffic or credentials go through the original developer. Start with [the ownership and self-hosting checklist](./SELF_HOSTING.md).

```text
browser / desktop app ──https──> Caddy (certificate + login) ──> web  (Lockbox screens)
                                                           └──> mail (Gmail/Outlook, encrypted tokens in a volume)
```

## 1. Deploy on Hostinger (no command line)
1. Buy a **Hostinger VPS** (KVM 1 or bigger) with the **Ubuntu 24.04 + Docker** template. Shared "Web Hosting" plans will not work.
2. In your DNS, add an `A` record: `mail` → the VPS IP address. Wait until it resolves.
3. Hostinger panel → your VPS → **Docker Manager** → **Compose** → **From URL**, paste your GitHub repo link
   (private repo: make it public, or use the command-line route below).
4. In the **Environment** section add:
   - `LOCKBOX_DOMAIN` = `mail.yourdomain.com`
   - `LOCKBOX_LOGIN_USER` = your login name (this user is the admin)
   - `LOCKBOX_LOGIN_PASSWORD` = a long password
   - `LOCKBOX_MS_DEVICE_CLIENT_ID` = the public Outlook app ID (needed for Outlook sign-in by code)
5. Click **Deploy**. HTTPS is issued automatically; the encryption key is created on the `lockbox-data` volume. **Never delete that volume** — everyone would need to reconnect.
6. Open `https://mail.yourdomain.com` → Add mailbox → log in → **Setup**:
   - **Address:** your https address. Lockbox shows the exact Google callback URL with a Copy button.
   - **Gmail:** create a Google *Web application* client with that callback and paste its ID and secret.
   - **Outlook:** nothing more to do; connect with a one-time code. If an organization blocks it, add your own Entra Web app here.
7. Add mailbox → Connect Gmail / Connect Outlook → sign in with the mailbox owner's account.

**Command-line route** (private repos, or for automatic updates below):
```bash
ssh root@<vps-ip>
git clone https://github.com/<you>/<repo>.git ~/lockbox && cd ~/lockbox
cp .env.lockbox.example .env && nano .env      # same variables as step 4
docker compose up -d --build
```

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
- The Lockbox login protects mailbox access; each login name gets its own mailboxes. To add people, add more `name hash` lines inside `basic_auth` in `deploy/Caddyfile` (hash with `docker run --rm caddy:2-alpine caddy hash-password`).
- Desktop users connect mail on their own PC (tokens in Windows Credential Manager); the server never sees them.
- Logs: `docker compose logs -f mail`.
