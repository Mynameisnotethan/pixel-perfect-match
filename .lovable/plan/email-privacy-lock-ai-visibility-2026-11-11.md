# Email privacy lock (AI visibility)

## What you'll get
- **Lock button** in the open-email toolbar, next to Reply/Forward/Flag/etc. (received emails only). Clicking it highlights the button and opens a bar centered at the bottom of the email.
- **Bottom bar** with two icon buttons: Lock (default, on) and Unlock, plus Confirm and Cancel.
  - Lock mode: highlight text in the email and/or click attachments to select them, then Confirm to hide them.
  - Unlock mode: highlight hidden text and/or click hidden attachments, then Confirm to make them visible again.
- **Hidden look**: hidden text shows as `*` for every character, spaces included. Hidden attachments show as a greyed, striped tile with a lock icon and the name masked with `*`.
- **Inbox lock icon** beside every email's date:
  - Grey: not opened yet (AI can't see it)
  - Red: opened, everything hidden
  - Yellow: opened, some parts hidden
  - Green: opened, nothing hidden (fully visible to the AI)
- **New Settings page "AI Access"** in the left Settings group: generate, copy, regenerate and revoke a demo API key, plus a "What the AI sees" preview showing each email as the agent would receive it (hidden parts removed, grey emails excluded).

## Limits (demo only, as chosen)
The key is stored only in this browser; no outside AI agent can connect yet. A real connection would need an online backend later.

## Technical details
- Each message gets `hiddenRanges` (character ranges in the plain-text body) and `hiddenAttachments` (indexes); opening a message sets `reviewed: true`. Saved with existing localStorage data.
- Text selection mapped to body offsets via the Selection API over a rendered plain-text body while in lock mode; ranges merged/subtracted on confirm.
- Status helper `lockStatus(m)` → grey/red/yellow/green; `aiView(m)` builds the redacted payload. Unit tests added for both and for range merging.
- New `src/cypht/privacy.js` and `PrivacyBar.jsx`; edits to `App.jsx` (toolbar, list row, settings page) and `preview.css`.
