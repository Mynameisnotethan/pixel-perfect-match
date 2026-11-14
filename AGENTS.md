<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

- Cypht preview: original imported frontend lives in src/cypht (App.jsx kept as JS), mounted client-only from src/routes/index.tsx because it reads localStorage on init.
- Desktop app bundles the screens (desktop/vite.renderer.config.mjs → app:// scheme) and never loads a remote Lockbox URL; Docker Outlook uses device-code with a publisher public client, server settings live encrypted in /data via the Setup wizard. Why: no Lockbox-hosted service in the data path.
- docker-compose.yml must stay deployable from a bare file URL (Hostinger Compose-from-URL downloads only that file, never the repository): every service runs from a published image, so no `build:` contexts and no relative bind mounts; the Caddy site config is baked into the proxy image (Dockerfile.proxy) instead of mounted from deploy/. Why: the panel deploy route is the one non-technical owners can follow.
- Sign-in belongs to the mail backend, never to the proxy: sessions are HttpOnly cookies kept as hashes on the data volume, mutating requests must echo the CSRF token the server handed the browser, and the first-run setup code is printed only to the container log. Why: the proxy stores no password and a browser cannot claim someone else's identity.
- Gmail, Outlook and IMAP/SMTP mailboxes share one list (`mailboxes`) shown by both Add mailbox and Servers; IMAP passwords stay server/desktop-side (encrypted volume or OS vault) and the hosted server refuses unencrypted or private-network IMAP hosts. Why: one source of truth and no server-side request abuse.
- AI agent feed (connectors/ai-feed.mjs) redacts from hide-from-AI rules stored by Lockbox (server privacy.enc / desktop vault), never from caller input; emails without saved rules count as unreviewed and are withheld. Why: an agent must not see anything the owner hasn't cleared.
- Desktop renderer state persists through desktop/secure-store.mjs using an OS-vault AES key, lossless gzip and authenticated encryption; online-only mode excludes messages, drafts and queued sends. Why: preserve complete app data without leaving a plaintext email cache on disk.
- The Docker web image forwards any /api/* or /oauth/* request it receives to the mail service (LOCKBOX_MAIL_UPSTREAM, src/lib/mail-forward.ts). Why: Hostinger keeps the compose labels from first deploy, so routing must not depend on them being updated.
- The AI MCP endpoint (connectors/ai-mcp.mjs) is hand-written stateless JSON-RPC inside createAiRoutes, sharing the REST feed and key checks; OAuth tokens map to an lbx_ key and are re-verified per call. Why: one redaction path, no extra service, and deleting a key revokes every client.

- AI drafts/sending (connectors/ai-drafts.mjs) run only through MCP tools gated by per-key perms (missing = read-only); a send needs an owner approval tied to the draft's content hash from a trusted Lockbox screen (session+CSRF page or desktop native dialog), and a per-version send ledger prevents duplicates. Why: a tool argument must never be able to approve or double-send.
