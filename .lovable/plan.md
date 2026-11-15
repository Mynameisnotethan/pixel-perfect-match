# Fix and prove direct send/schedule on the live Lockbox MCP

## What I already checked
- The live server responds, and the screens it serves include **Allow sending without per-email approval**.
- The published mail image (built 2026-11-15 00:01 UTC) reports build `2026.11.14-direct-send`, and its sending code is byte-identical to the project's code.
- With a mock Outlook, a key that has direct send turned on for `microsoft:ethenry1982@outlook.com` gets `sent` from `send_draft` and `queued` from `schedule_send`. This works for per-mailbox keys and for "All mailboxes" keys.

**Most likely cause (not yet confirmed on the VPS):** the key ChatGPT uses has no direct-send entry stored for that Outlook mailbox. There are three ways that can happen:
1. The setting was saved while the VPS still ran an older mail image. An older image silently drops the unknown setting when it saves the key.
2. ChatGPT's connection belongs to a different key from the one you edited. A ChatGPT connection stays attached to the key you pasted when you first connected it.
3. A later key edit wiped the setting. The editor drops direct send for any mailbox that hasn't finished loading on screen when you press Save.

Cause 3 is a real bug, and I'll fix it. Causes 1 and 2 can't be seen anywhere today, so the plan also makes them visible.

## Changes
1. **Show which key ChatGPT is using**
   - A new read-only MCP tool, `get_access`, is always available. It returns the build, the key's name and last 4 characters, how the client connected (API key or app sign-in), and for each mailbox whether it can see, draft, send and send directly. It never returns secrets or email content.
   - When `send_draft` or `schedule_send` still needs approval, the reply explains why. For example, "direct send is off for key "ChatGPT" (…ab12) on microsoft:ethenry1982@outlook.com" or "this key has no access to that mailbox".
   - In AI Access, each key lists its **Connected apps** (for example ChatGPT) with when each last used it, plus a Disconnect button.
2. **Make the setting stick**
   - The key editor keeps direct send and mailbox permissions for mailboxes that aren't loaded yet, instead of erasing them.
   - After Save, Lockbox reads the key back from the server. If direct send didn't stick (an older mail image), you see a clear warning instead of a silent failure.
   - Mailbox matching ignores upper/lower case, so `Microsoft:EtHenry…` and `microsoft:ethenry…` count as the same mailbox.
3. **Server log line**: each send or schedule decision is logged with a request id, the key's last 4 characters, the mailbox and the result (`sent`, `queued` or approval needed). No content and no secrets.
4. **Live check script**: `scripts/check-mcp-tools.mjs` gets two new options:
   - `--access` prints the `get_access` result.
   - `--schedule-test` creates a self-addressed draft, schedules it one hour ahead, confirms `queued` and that it shows in Scheduled, then cancels it. It never sends anything.

Approval stays exactly as it is for keys and mailboxes without the setting. Old pending test approvals are not touched. Creating or editing a draft still never sends.

## Tests (mock provider)
- Through the MCP endpoint with an API key and with an app-sign-in token mapped to a trusted key: `send_draft` returns `sent` (exactly once) and `schedule_send` returns `queued` with the time. The queued item appears in the owner's Scheduled list and the timer sends it once.
- A key without the setting gets an approval reply that includes the reason.
- Saving with the mailbox not yet loaded keeps the setting. Mailbox ids in different case still match.
- `get_access` shows no secrets.

## What you'll do after I build (I can't sign in to your VPS)
1. Wait for the Docker images workflow on GitHub to finish. Then redeploy in Hostinger → Docker Manager and keep `lockbox-data`.
2. Lockbox → AI Access → Edit your ChatGPT key. Turn on **Send emails** and **Allow sending without per-email approval** for ethenry1982@outlook.com, then Save. Check that the key row says "sends without approval (1)" and lists ChatGPT under Connected apps. If ChatGPT is listed under a different key, enable the setting on that key, or reconnect ChatGPT with this one.
3. In ChatGPT, refresh or reconnect the Lockbox connector so it picks up `get_access`. Ask it to run `get_access`: it should show build `2026.11.15-…` and direct send true for Outlook.
4. Optional PowerShell check (the key is typed in hidden, never shown):
   ```text
   $env:LOCKBOX_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host "Key" -AsSecureString)))
   node .\scripts\check-mcp-tools.mjs --url https://srv1790211.hstgr.cloud/api/ai/v1/mcp --access --schedule-test --to ethenry1982@outlook.com
   Remove-Item Env:LOCKBOX_KEY
   ```
   Share only the printed status lines (build, direct_send, queued, cancelled).

## Technical details
- Files: `connectors/ai-mcp.mjs` (`get_access` tool, approval reason, version bump), `connectors/ai-drafts.mjs` (reason codes, decision log), `connectors/ai-perms.mjs` (case-insensitive ids, keep unknown mailboxes), `connectors/keystore.mjs` + `server/index.mjs` + `desktop/main.mjs` (list the app connections attached to each key, disconnect), `src/cypht/AiKeys.jsx` (preserve on save, read-back warning, Connected apps), `scripts/check-mcp-tools.mjs`, docs, and tests under `src/test/`.
- An app connection's token stays mapped to a key, and that key's permissions are still re-read on every call. Disconnecting an app deletes its tokens.
