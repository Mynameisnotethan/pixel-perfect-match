# Shipping Lockbox to a Hostinger VPS (via GitHub)

Result: `https://mail.yourdomain.com` runs Lockbox with live Gmail/Outlook, updates on every push to GitHub, and GitHub builds the Windows installer.

**Independent ownership:** every deployer uses their own GitHub copy, VPS, domain, Google/Microsoft registrations, and encrypted storage. The upstream project provides source code only; no mailbox traffic or credentials go through the original developer. Start with [the ownership and self-hosting checklist](./SELF_HOSTING.md).

```text
browser / desktop app ──https──> Caddy (HTTPS certificate) ──> web  (Lockbox screens)
                                                           └──> mail (sign-in, Gmail/Outlook, encrypted tokens in a volume)
```
Signing in happens **inside the Lockbox app**, not in Caddy: the mail server issues its own session cookie,
so no password or password hash is stored in the proxy.

## 1. Deploy on Hostinger (no command line)
1. Buy a **Hostinger VPS** (KVM 1 or bigger) with the **Ubuntu 24.04 + Docker** template. Shared "Web Hosting" plans will not work.
2. In your DNS, add an `A` record: `mail` → the VPS IP address. Wait until it resolves.
3. Hostinger panel → your VPS → **Docker Manager** → **Compose** → **From URL**, and paste the **raw link
   to `docker-compose.yml`**, not the GitHub page link:
   ```text
   https://raw.githubusercontent.com/Mynameisnotethan/pixel-perfect-match/main/docker-compose.yml
   ```
   A `https://github.com/<you>/<repo>/blob/main/docker-compose.yml` link is a web page, so Hostinger
   answers **"Docker project not found"**. Open the file on GitHub and use the **Raw** button, or build the
   link above by hand. Only this one file is downloaded, which is why every service runs from a published
   image instead of being built from the repository.
   If deploying a fork, replace `Mynameisnotethan/pixel-perfect-match` with your own owner/repository.
   Before deploying, confirm **Actions → Docker images** has succeeded and all three packages are public (section 4).
4. In the **Environment** section add only one value:
   - `LOCKBOX_DOMAIN` = `mail.yourdomain.com` — a bare hostname, no `https://` and no trailing slash.
     Hostinger's own VPS hostname works too if you have no domain yet.
5. Click **Deploy**. HTTPS is issued automatically; the encryption key is created on the `lockbox-data` volume. **Never delete that volume** — everyone would need to reconnect.
6. **Create the administrator in your browser.** Open `https://mail.yourdomain.com`. Because no account exists
   yet, Lockbox shows a one-time **Set up Lockbox** page. Copy the setup code from the mail container's logs
   (Hostinger: Docker Manager → this project → **mail** container → **logs**; command line: `docker compose logs mail`),
   paste it in, and choose the username and password you will use from now on. The code appears only in those
   logs, is never sent to the browser, and stops working for good the moment an account exists.
7. Sign in with that account → Add mailbox → **Setup**. Add **all mail-provider credentials here, after deployment**:
   - **Address:** your https address. Lockbox shows the exact provider callback URLs with Copy buttons.
   - **Gmail:** create a Google *Web application* client with that callback and paste its ID and secret.
   - **Outlook:** create your own Entra app, enable **Allow public client flows**, and paste its Application (client) ID. No secret is needed for sign-in by code. If an organization blocks codes, the optional Outlook web-app fields accept a separate ID and secret.
7. Add mailbox → Connect Gmail / Connect Outlook → sign in with the mailbox owner's account.

**Command-line route** (useful for automatic updates below, or if the panel route is unavailable):
```bash
ssh root@<vps-ip>
git clone https://github.com/<you>/<repo>.git ~/lockbox && cd ~/lockbox
cp .env.lockbox.example .env && nano .env      # only LOCKBOX_DOMAIN is needed
docker compose pull
docker compose up -d
docker compose logs mail                       # the one-time setup code is printed here
```

## 2. Automatic updates from GitHub
In GitHub → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `HOSTINGER_HOST` | VPS IP |
| `HOSTINGER_USER` | `root` (or your SSH user) |
| `HOSTINGER_SSH_KEY` | a private SSH key whose public half is in the VPS `~/.ssh/authorized_keys` |
| `HOSTINGER_APP_DIR` | optional, defaults to `~/lockbox` |

Every change you make in Lovable syncs to GitHub's `main` branch. The **Docker images** workflow builds and publishes all three images first. Only after that workflow succeeds on `main` does `.github/workflows/deploy-hostinger.yml` pull the images and restart the containers on the VPS. Failed or cancelled builds do not trigger a deployment. To retry, run **Docker images** on `main`; deployment follows its successful completion.

The SSH updater requires the **command-line route's Git checkout** and its configured `.env` on the VPS. **Compose from URL alone does not create that checkout**, so it does not automatically enable this updater. For a Docker Manager project, use Docker Manager to pull/redeploy its images instead. Do not start a second copy on the same ports.

`HOSTINGER_APP_DIR` may be an absolute path or a `~/` path; when omitted, it resolves to the SSH user's home directory plus `/lockbox`. Mailbox connections survive updates (they live in the `lockbox-data` volume).

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
- The Lockbox login protects mailbox access; each signed-in user gets their own mailboxes. The administrator
  is created once, in the browser, with the one-time setup code (step 6). If you are upgrading from the older
  setup that kept `LOCKBOX_LOGIN_USER` / `LOCKBOX_LOGIN_PASSWORD` in Hostinger, the mail container keeps those
  credentials as the administrator account on first start so existing mailboxes stay where they are; delete the
  variables once you are in.
- Sessions are HttpOnly cookies held by the browser and stored only as hashes on the volume; signing out ends
  one immediately, and an idle session expires after 12 hours. Repeated wrong passwords from one address are
  limited for a few minutes.
- Desktop users connect mail on their own PC (tokens in Windows Credential Manager); the server never sees them.
- Logs: `docker compose logs -f mail`. The setup code is the only secret the log ever prints.

## Connect an AI agent

1. In Lockbox open **AI Access**, then **Create API key**, and copy the key. It is shown only once.
2. Give your agent the address shown there (`https://YOUR-DOMAIN/api/ai/v1/messages`) and send the key as `Authorization: Bearer lbx_...`.
3. Agents get only emails you have opened in Lockbox. Hidden parts are replaced by their label, for example `[hidden: Financial info]`, and the access is read-only. `GET /api/ai/v1/messages?limit=25&mailbox=<id>` lists emails; `GET /api/ai/v1/messages/<id>` reads one. Message text is the mailbox preview text.
4. Delete a key on the same page to cut that agent off right away.

## Connect ChatGPT

ChatGPT's normal chat cannot reach your server, so use a Custom GPT Action. In AI Access, click **ChatGPT prompt** next to a key, paste it into ChatGPT, and follow the steps. The action imports `https://YOUR-DOMAIN/api/ai/v1/openapi.json`; paste the key only into the action's Authentication field (API Key, Bearer), never into chat.
