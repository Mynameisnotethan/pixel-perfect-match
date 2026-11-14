# Direct send and schedule for trusted AI keys (live fix)

## What's going on
The "Allow sending without per-email approval" setting and its backend check were added in the last change. Your Hostinger server returned `awaiting_approval`, which is what happens when either:
- the server is still running an image built before that change, or
- the setting is not ticked for your Outlook mailbox on the key ChatGPT uses.

I can't reach your server's logs or key settings from here. Step 1 below adds a way to tell which one it is.

## Changes

1. **Show which build and permissions are live**
   - The MCP `initialize` response and a new signed-in "About" line in AI Access show the build version.
   - `get_draft` / `schedule_send` results include `direct_send: true|false` for the draft's mailbox, so you (and ChatGPT) can see whether the key is trusted there. This adds no secrets.

2. **Schedule returns `queued`**
   - For a trusted key and mailbox, `schedule_send` returns `status: "queued"` with `send_at`, and never includes an approval URL.
   - Other keys keep `awaiting_approval` and the approval page.

3. **AI-scheduled emails show in Lockbox → Scheduled**
   - Each queued email shows its recipient, subject, local send time, status (Queued, Sending, Sent, Failed) and a **Cancel** button.
   - Cancel goes through the signed-in Lockbox screen (CSRF-protected on the server, native call on desktop). It stops the send, and the email goes back to Drafts.

4. **Safety at send time**
   - When a scheduled email is due, the worker re-checks the key. If the key was deleted, or Send / no-approval was turned off for that mailbox, it does not send. The item shows "Needs approval" in Scheduled instead.
   - Old approval requests stay pending. They are never released automatically: only drafts the agent explicitly sends or schedules after the setting is on are sent without approval.
   - The existing per-version ledger still prevents duplicate sends on retries, and `send_draft` returns `sent` only after Outlook accepts it.
   - Creating or editing a draft only saves it.

5. **Tool descriptions** for `send_draft` and `schedule_send` explain both paths: direct for trusted mailboxes, approval otherwise.

6. **Tests with a mock provider**: immediate send, queued schedule appears in the owner list and sends when due, cancel, revoked permission blocks a due send, untrusted key still requires approval, retries never double-send.

## Your five-minute check after redeploy
1. Redeploy on Hostinger, keeping `lockbox-data`. Confirm AI Access shows the new build version.
2. AI Access → Edit your key → make sure **Send emails** is on for your Outlook mailbox and tick **Allow sending without per-email approval**. Save.
3. In ChatGPT, disconnect and reconnect the Lockbox connection so it reloads the tools.
4. Ask ChatGPT to draft a self-addressed email and schedule it for 3 minutes from now. Expect `queued`, no approval link, and the email listed in Lockbox → Scheduled.
5. Wait for the send time. The email arrives in your Outlook inbox and shows as Sent in Scheduled.

I can't run the live ChatGPT test myself. Step 4 is that verification.

## Technical details
- `connectors/ai-drafts.mjs`: `createDraftService({ ..., permsForKey })`; `schedule()` returns `status: 'queued'` on the auto path; `runDue()` re-verifies `approval.by === 'key'` against `canAutoSend(permsForKey(keyId), mailbox)` before claiming. Add `ownerCancel(owner, id)`. `aiPreview` adds `direct_send`.
- `server/index.mjs`: pass `permsForKey` from the keystore. Add `POST /api/ai/drafts/:id/cancel` (session + CSRF). Add `version` to `/api/health` and the MCP serverInfo from the image build arg.
- `desktop/main.mjs` and the preload script: `aiDrafts:cancel` IPC.
- `src/cypht/mailbox-live.js`: `aiDrafts.cancel(id)`.
- `src/cypht/ai-draft-messages.js`: AI drafts with `send_at` and an approved or queued status map to `folder: 'scheduled'` with `scheduledAt`, `aiStatus`. Scheduled-view rows use the existing scheduled notice with a Cancel that calls the bridge.
- `connectors/ai-mcp.mjs`: description updates.
- Tests in `src/test/ai-autosend.test.ts` and `src/test/ai-draft-messages.test.ts`.
