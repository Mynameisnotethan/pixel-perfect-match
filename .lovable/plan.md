# Let ChatGPT draft and send email through Lockbox (with your approval)

Keeps the same MCP address (`/api/ai/v1/mcp`) and existing tools `list_messages` / `get_message`. Works on the VPS and desktop.

## What you get
- **New tools:** `create_draft`, `update_draft`, `send_draft`.
- **Per-key permissions** in Lockbox → AI Access → API keys → each key: **Read reviewed emails** (on), **Manage drafts** (off), **Send email** (off). Existing keys stay read-only until you turn more on.
- **Approval before every send:** ChatGPT gets an approval link to a signed-in Lockbox page showing exact From/To/CC/BCC/subject/body. Only your click there (signed-in session + CSRF) approves that exact version. Any edit cancels the approval.
- **No duplicate sends:** one send per approved version; retries return the original result. Unclear provider answers are marked "unknown" and checked against the Sent folder before any retry.
- **Reconnect prompt** on a mailbox in Mailboxes if Gmail/Outlook lacks draft or send permission; reading keeps working.

## Rules
- Replies only to reviewed messages, threaded with the original's headers/thread ID, to the sender only unless reply-all or extra recipients are asked for. Hidden content is never quoted; the AI only ever saw `[hidden: Label]`.
- Sending mailbox must belong to the key's owner; checked server-side on every call.
- Drafts made by AI appear in Lockbox Drafts and in the provider's drafts.

## Technical details
- `connectors/ai-keys`: add `perms: {read:true, drafts:false, send:false}`; missing = read-only. Key-edit endpoint (session + CSRF). OAuth scopes `mail.read`, `mail.draft`, `mail.send` capped by key perms; tokens re-check perms each call.
- `connectors/ai-drafts.mjs` (new): encrypted per-user draft store (server `drafts.enc` / desktop vault). Draft = {id, mailboxId, from, to, cc, bcc, subject, body, replyTo meta, version, contentHash}. Approval = {draftId, contentHash, approvedAt}; send requires hash match. Send ledger keyed by draftId+hash: `pending|sent|unknown` + provider message ID.
- Provider draft/send via existing Gmail (`drafts.create/update`, `drafts.send`, threadId + In-Reply-To/References) and Graph (`createReply`, `PATCH`, `send`); reconcile "unknown" by searching Sent for a Lockbox `X-Lockbox-Draft` header / internet message ID.
- Scopes check: Gmail needs `gmail.compose`/`gmail.send`; Graph needs `Mail.ReadWrite`/`Mail.Send`. Store granted scopes per mailbox; incremental consent reconnect.
- Approval page `/ai/approve/:id` in the web app; `send_draft` returns `approval_required` + link until approved.
- MCP `tools/list` shows only tools the key allows; `listChanged` notification not used, so ChatGPT must **refresh the connector** once after redeploy.
- Tests: perms (read-only can read, draft-only can't send), owner scoping, approval invalidated on edit, idempotent/duplicate sends, unknown reconciliation, reply threading/recipients, hidden-content not quoted, mocked Gmail/Graph. Real Gmail/Outlook sends can't be tested here; you'll verify after redeploy.
