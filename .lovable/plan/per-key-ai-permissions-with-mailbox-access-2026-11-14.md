# Per-key AI permissions with mailbox access

## What changes for you
- The **Allow AI drafts** button disappears from the Mailboxes page.
- Each API key in **Settings → AI Access** gets an **Edit** button. The checkboxes in the key table go away and become a short summary instead (for example "2 mailboxes · Read, Drafts").
- **Edit** opens a centered window for that key with:
  - **Mailboxes**: a list of your connected mailboxes, each with its own switch. You can also choose **All mailboxes, including ones added later**.
  - For each allowed mailbox: **See emails**, **Draft emails** and **Send emails**. Send needs Draft to be on, and Draft needs the mailbox to be allowed.
  - **Save** and **Cancel**.
- New keys start with no write access: read-only on all mailboxes, the same as today.
- If you turn on drafting or sending for an older Gmail or Outlook connection that was set up before drafting existed, the window shows "Sign in again to allow drafting" with a button next to that mailbox. That one-time sign-in replaces the old Mailboxes button. New connections already include it.
- IMAP mailboxes show drafting and sending as not available yet. Reading still works.

## What the AI sees
- It lists and opens only reviewed emails from the mailboxes that key can **see**. Hidden parts stay hidden, as they do now.
- The draft tools appear only if the key can draft in at least one mailbox. The send tool appears only if the key can send from at least one mailbox. A draft or send for a mailbox the key isn't allowed to use is refused.
- The owner still has to approve every send, as now.
- After you change a key, disconnect and reconnect it in ChatGPT so it picks up the new tool list.

## Technical details
- Permission shape stored on the key record: `{ mailboxes: 'all' | { [mailboxId]: { read, drafts, send } } }`. `normalizePerms` migrates existing `{ read, drafts, send }` flags to `mailboxes: 'all'` with the same flags. Default is all mailboxes, read-only.
- `connectors/ai-feed.mjs`: filter feed messages by the `read` permission of each message's account. A message from an account the key can't read gets a 404 from `get_message`.
- `connectors/ai-mcp.mjs` `toolsFor`: show the draft and send tools if any mailbox allows them. `connectors/ai-drafts.mjs`: check the target mailbox's `drafts`/`send` flags on create, update and send. Replying is allowed only when the key can read the source mailbox.
- Server and desktop key stores (`setPerms`/`inspect`) accept and validate the new shape. Unknown mailbox IDs are dropped.
- `src/cypht/AiKeys.jsx`: add the summary column, the Edit button and a modal that receives `mailboxes` from App. The reconnect action reuses `connectMailbox`.
- `src/cypht/App.jsx`: remove the Allow AI drafts button and pass the mailboxes and connect handler to AI Access.
- Tests: per-mailbox read filtering, tool visibility, refused draft and send on a disallowed mailbox, legacy permission migration, and the edit modal saving permissions.
- Update the AGENTS.md rule for AI drafts and permissions, plus the docs.
