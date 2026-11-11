# Run your own Lockbox

Lockbox is self-hosted software, not a shared mail service. The original developer supplies source code only. Each person or organization that deploys it owns and controls the entire installation.

## Who owns what

| Item | Owner for each deployment |
|---|---|
| GitHub copy and updates | The deployer, ideally through their own fork |
| Hostinger VPS and Docker containers | The deployer |
| Domain and HTTPS certificate | The deployer |
| Google Cloud and Microsoft Entra app registrations | The deployer |
| Lockbox login and administrator Setup page | The deployer |
| Mailbox tokens and encryption key | The deployer, on that server's `lockbox-data` volume |
| Mailbox contents and provider consent | Each person who connects their own Google or Microsoft account |

There is no Lockbox-hosted mailbox API, token service, database, analytics endpoint, or shared credential in the application. A deployment connects only to its own containers and to Google/Microsoft for sign-in and mail. GitHub supplies source code, Hostinger supplies the VPS, and Caddy obtains the HTTPS certificate; those are the deployer's chosen providers rather than a central Lockbox service.

## One-time setup for each independent installation

### 1. Make your own source copy

Fork the repository into your own GitHub account, or clone and push it to a repository you control. Use **your** repository URL for deployment. Do not put passwords, OAuth client secrets, tokens, or the contents of `.env` into GitHub.

### 2. Create your infrastructure

1. Rent your own **Hostinger VPS** with Ubuntu 24.04 and Docker. Shared web hosting cannot run this stack.
2. Use your own domain. Create an `A` record such as `mail.example.com` pointing to your VPS.
3. In Hostinger, open **Docker Manager → Compose → From URL** and enter the **raw** link to your copy of
   `docker-compose.yml`: `https://raw.githubusercontent.com/<your-username>/<your-repo>/main/docker-compose.yml`.
   A `github.com/.../blob/...` page link is not a Compose file and Hostinger reports "Docker project not found".
4. The stack runs from images your repository builds on GitHub. Make those packages public once
   (**github.com/<you>?tab=packages** → each `lockbox-*` package → **Package settings** → **Change visibility** →
   **Public**), or set `LOCKBOX_IMAGE_ORG` to a username whose public images you want to run.

### 3. Deploy with only the server login settings

In Hostinger's **Environment** section, enter only:

| Name | Value |
|---|---|
| `LOCKBOX_DOMAIN` | Your full hostname, such as `mail.example.com` |
| `LOCKBOX_LOGIN_USER` | Your Lockbox administrator login |
| `LOCKBOX_LOGIN_PASSWORD` | A new, long password for this installation |

Click **Deploy**. Keep Hostinger's `lockbox-data` volume: it contains the automatically generated encryption key, encrypted provider settings, and encrypted mailbox tokens. Deleting it requires every mailbox to reconnect.

### 4. Add your own Google credentials after deployment

Open your Lockbox address, choose **Add mailbox**, sign in with the Lockbox administrator login, and open **Setup**.

1. Save your public Lockbox address and copy the Google callback address shown by Setup.
2. In your own Google Cloud project, enable the Gmail API and configure the consent screen.
3. Create a **Web application** OAuth client and register that exact callback address.
4. Paste your Google client ID and secret into Setup and save.

The credentials are saved in your server's encrypted settings. They are not sent to the original developer. While your Google consent screen is in Testing, add each mailbox owner as a test user; Google may expire test grants after seven days. Public use of restricted Gmail scopes requires Google's verification process.

### 5. Add your own Outlook credentials after deployment

Stay in **Setup → Outlook**. In your own Microsoft Entra account:

1. Create an app registration supporting organizational and personal Microsoft accounts.
2. Add delegated Microsoft Graph permissions: `User.Read`, `Mail.Read`, `Mail.Send`, `offline_access`, `openid`, and `email`.
3. Enable **Allow public client flows**. This public client ID identifies your application; it does not give anyone access to your mailbox.
4. Paste its Application (client) ID into **Outlook application (client) ID** in Setup and select **Save Outlook sign-in**. No client secret is needed for sign-in by code.

This registration belongs to you. Do not use the original developer's client ID. If an organization blocks sign-in by code, expand **Use an Outlook web app instead** and enter a separate web app's ID and secret there.

### 6. Connect mailboxes

Each mailbox user selects **Connect Gmail** or **Connect Outlook**, then signs in to **their own** provider account and approves access. Their provider account is separate from the Lockbox login.

The installation stores that user's encrypted tokens on its own VPS. No other installation can read them. An organization may require its Microsoft administrator to approve consent.

## What other people need to do

For a deployment you operate for your family or organization, you do the server and provider-registration steps once. Each mailbox user then only signs in and connects their own account.

For a completely independent owner, they repeat the one-time setup on infrastructure and provider registrations they control. Nothing needs to run on your VPS afterward.

## Backups and updates

- Back up the `lockbox-data` and `caddy-data` volumes on the owner's VPS. Keep backups private because they contain encrypted account data and encryption material.
- Update from the owner's GitHub repository. Review changes before deploying them.
- Never commit Hostinger passwords, OAuth secrets, mailbox tokens, or encryption keys.

For the detailed command-line deployment, automatic updates, optional Windows builds, and troubleshooting, see [HOSTINGER_DEPLOY.md](./HOSTINGER_DEPLOY.md) and [MAILBOX_SETUP.md](./MAILBOX_SETUP.md).
