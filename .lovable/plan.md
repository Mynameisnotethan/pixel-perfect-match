# AI agent access with your API keys (desktop + Hostinger)

## The problem today
- API keys can be created, but nothing answers when an AI agent uses one.
- Your hide-from-AI choices (locks, labels, defaults, "reviewed") are saved only inside the browser you used. Your server and the desktop app can't see them, so they couldn't enforce them for an agent.

## What changes
1. **Hide rules saved to your own Lockbox.** On Hostinger they're stored encrypted on your server, tied to your account. On the desktop they're stored in the computer's secure vault. The screens save to it automatically, so another browser or device shows the same locks.
2. **An AI endpoint agents can call** with `Authorization: Bearer lbx_...`:
   - List recent emails (only reviewed ones; grey/unopened never appear).
   - Read one email.
   - Each response is the same redacted "What the AI sees" view: hidden parts become `[hidden: Financial info]`, hidden attachments show no name or contents.
   - Read-only. Agents can't send, delete or change locks.
3. **Safe by default.** If the rules can't be loaded, the email isn't returned. An unknown or deleted key gets "not authorized". A key only sees mailboxes on its owner's account. Rate limit per key, and "last used" is updated.
4. **Desktop app.** Same endpoint at `http://127.0.0.1:<port>` and only on this computer, available only while Lockbox is open. Keys are created on the AI Access page like on the server and are stored as fingerprints in the vault.
5. **AI Access page.** Shows the address to give your agent (your domain, or the local desktop address), a copy button, and a short example. The preview stays demo-only and is clearly marked.

## Not verifiable here
I can't run it on your Hostinger server or a Windows PC. I'll test it on a local copy of the server with fake mailboxes. The test will check that hidden text never appears in what the agent gets back.

## Technical details
- Move `aiView`/`applyDefaults`/`lockStatus` into a shared module (`connectors/privacy-core.mjs`) used by browser, server and desktop. `src/cypht/privacy.js` re-exports it.
- Per-user privacy store `server/privacy-store.mjs` (encrypted `/data/privacy.enc`) holding `{ rules: {messageId: {...hidden ranges, reviewed}}, defaults, labels }`. Endpoints: `GET/PUT /api/privacy` (session + CSRF). App.jsx syncs in live mode, with debounced PUT; demo mode keeps using localStorage.
- AI routes `GET /api/ai/v1/messages?limit=&mailbox=` and `GET /api/ai/v1/messages/:id`. Bearer key goes to `aiKeys.verify` to get the owner, then their mailboxes are synced through the existing connectors, then `aiView` with stored rules, dropping nulls. Rule message IDs use the existing `${box.id}:${item.id}` IDs. Body is the provider snippet unless/until full body fetch exists (state this in the docs).
- Add `/api/ai/v1/*` to the Caddy `@mail` matcher (Dockerfile.proxy). No CORS. Never log keys. Simple in-memory rate limit of 60 requests a minute per key.
- Desktop: `desktop/main.mjs` starts an `http` server on 127.0.0.1 (fixed default port, configurable) with the same handlers, plus a key store and privacy store in keytar. New IPC `privacy:get/put`, `aiKeys:*`, exposed via preload; `liveBridge` gains `privacy` and `aiEndpoint()`.
- Tests: hidden subject/name/body text and attachment names are absent from AI responses; grey emails are excluded; a bad key gives 401; user A's key can't see user B's mail; a missing rules file returns nothing.
- Docs: add an "Connect an AI agent" section to HOSTINGER_DEPLOY and SELF_HOSTING. Add a rule to AGENTS.md: the server enforces redaction from server-stored rules and never trusts the client.
