# AI Access page: cleaner layout and multiple personal API keys

## What you'll get

### 1. Better organized page
The AI Access page becomes a set of clear cards with tabs/sections at the top:
- **API keys** — your keys (new, see below)
- **Hide by default** — received and sent/scheduled switches side by side in two tidy columns
- **Hidden text labels** — the existing label list and Edit labels button
- **What the AI sees** — the preview, collapsible, with a count of emails included

Each card has a title, one line of explanation and consistent spacing, matching the teal Lockbox style. Works on phone widths too.

### 2. Multiple API keys, NocoDB style
- A **Create API key** button opens a small form: give the key a **name** (e.g. "Claude agent", "Zapier") and create it.
- The full key is shown **once** right after creating it, with a Copy button and a warning "You won't see this again".
- A table lists your keys: name, a masked preview (`lbx_••••a3f9`), created date, last used, and a **Delete** button (with confirmation).
- Keys can't be viewed again later; if lost, delete and create a new one.

### 3. Keys belong only to your account
- On your Hostinger server, keys are stored by the mail server under the signed-in user. Each person only sees and manages their own keys; other users' keys never appear and can't be deleted by you.
- Only a fingerprint of each key is saved (like a password), so the real key is never stored.
- An existing old single demo key is not carried over.
- In the Lovable preview (no server), keys are kept in the browser and labelled as demo.

## Limits
This adds key management only. An outside AI agent actually reading your mail with a key (an agent connection endpoint) is not part of this step — I can add it next if you want.

## Technical details
- Server (`server/index.mjs`, new `server/apikeys.mjs`): encrypted `apikeys.enc` on the data volume, `{ [userId]: [{ id, name, prefix, last4, hash(sha256), createdAt, lastUsedAt }] }`. Routes `GET/POST /api/ai/keys`, `DELETE /api/ai/keys/:id`, all requiring session + CSRF, scoped to `user`. Caddy routes `/api/ai/*` to mail backend.
- Key format `lbx_` + 32 random bytes base64url; plaintext returned only in the POST response.
- Bridge: `aiKeys.list/create/remove` in `mailbox-live.js` (web) with a localStorage demo implementation for preview.
- UI: new `src/cypht/AiKeys.jsx`; AI Access section in `App.jsx` restructured into cards; styles in `preview.css`.
- Tests: per-user isolation (user B can't list/delete A's keys), plaintext never returned by list, hash-only storage, CSRF required, demo create/delete.
