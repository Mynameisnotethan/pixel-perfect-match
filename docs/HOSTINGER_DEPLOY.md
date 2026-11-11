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
3. Hostinger panel → your VPS → **Docker Manager** → **Compose** → **From URL**, and paste the **raw link
   to `docker-compose.yml`**, not the GitHub page link:
   ```text
   https://raw.githubusercontent.com/<your-username>/<your-repo>/main/docker-compose.yml
   ```
   A `https://github.com/<you>/<repo>/blob/main/docker-compose.yml` link is a web page, so Hostinger
   answers **"Docker project not found"**. Open the file on GitHub and use the **Raw** button, or build the
   link above by hand. Only this one file is downloaded, which is why every service runs from a published
   image instead of being built from the repository.
4. In the **Environment** section add only the three values needed to start and protect the installation:
   - `LOCKBOX_DOMAIN` = `mail.yourdomain.com`
   - `LOCKBOX_LOGIN_USER` = your login name (this user is the admin)
   - `LOCKBOX_LOGIN_PASSWORD` = a long password
5. Click **Deploy**. HTTPS is issued automatically; the encryption key is created on the `lockbox-data` volume. **Never delete that volume** — everyone would need to reconnect.
6. Open `https://mail.yourdomain.com` → Add mailbox → log in → **Setup**. Add **all mail-provider credentials here, after deployment**:
   - **Address:** your https address. Lockbox shows the exact provider callback URLs with Copy buttons.
   - **Gmail:** create a Google *Web application* client with that callback and paste its ID and secret.
   - **Outlook:** create your own Entra app, enable **Allow public client flows**, and paste its Application (client) ID. No secret is needed for sign-in by code. If an organization blocks codes, the optional Outlook web-app fields accept a separate ID and secret.
7. Add mailbox → Connect Gmail / Connect Outlook → sign in with the mailbox owner's account.

**Command-line route** (useful for automatic updates below, or if the panel route is unavailable):
```bash
ssh root@<vps-ip>
git clone https://github.com/<you>/<repo>.git ~/lockbox && cd ~/lockbox
cp .env.lockbox.example .env && nano .env      # same variables as step 4
docker compose pull
docker compose up -d
```

## 2. Automatic updates from GitHub
In GitHub → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `HOSTINGER_HOST` | VPS IP |
| `HOSTINGER_USER` | `root` (or your SSH user) |
| `HOSTINGER_SSH_KEY` | a private SSH key whose public half is in the VPS `~/.ssh/authorized_keys` |
| `HOSTINGER_APP_DIR` | optional, defaults to `~/lockbox` |

Every change you make in Lovable syncs to GitHub's `main` branch, and `.github/workflows/deploy-hostinger.yml`
pulls the new images and restarts the containers on the VPS. Mailbox connections survive updates (they live in the `lockbox-data` volume).

## 3. Windows installer from GitHub
The installer bundles the Lockbox screens and talks to Google/Microsoft directly: it needs no server.
Add these secrets: `LOCKBOX_GOOGLE_DESKTOP_CLIENT_ID`, `LOCKBOX_GOOGLE_DESKTOP_CLIENT_SECRET`, `LOCKBOX_MS_DESKTOP_CLIENT_ID` (the **Desktop** registrations, not the web ones).
Then GitHub → Actions → **Windows installer** → Run workflow, and download the `.exe` from the run. Pushing a tag like `v0.1.0` attaches it to a GitHub Release for public download.
The installer is unsigned, so Windows SmartScreen will warn until you add a code-signing certificate.

## 4. Docker images (what Hostinger actually runs)
`.github/workflows/docker-images.yml` publishes three images on every push to `main`:
`ghcr.io/<you>/lockbox-mail`, `lockbox-web`, and `lockbox-proxy` (Caddy with the login config baked in).
The images contain no provider credentials; each installation adds its own through Setup after deployment.

**Make the packages public once**, otherwise the VPS cannot download them and the deploy fails with a
permission error: open `https://github.com/<you>?tab=packages`, click each `lockbox-*` package →
**Package settings** → **Change visibility** → **Public**.

`docker-compose.yml` reads `ghcr.io/${LOCKBOX_IMAGE_ORG:-mynameisnotethan}/...`. Leave `LOCKBOX_IMAGE_ORG`
empty to run the upstream images, or set it to your own GitHub username so the containers run images built
from your repository. `LOCKBOX_IMAGE_TAG` pins a tag instead of `latest`.

## Notes
- The Lockbox login protects mailbox access; each login name gets its own mailboxes. To add people, add more `name hash` lines inside `basic_auth` in `deploy/Caddyfile` (hash with `docker run --rm caddy:2-alpine caddy hash-password`).
- Desktop users connect mail on their own PC (tokens in Windows Credential Manager); the server never sees them.
- Logs: `docker compose logs -f mail`.
