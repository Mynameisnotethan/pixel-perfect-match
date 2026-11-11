# Hide-from-AI lock for Compose, Sent and Scheduled emails

## What you'll get

**1. Sent and Scheduled emails**
- The lock button shows up in the email view toolbar, next to Reply and Forward, the same way it does on received emails.
- Lock mode works the same way: field locks, highlighting, Lock/Unlock, labels, Hide all and the Hide/Reveal button.
- Since you wrote these emails, the editable fields are **Subject**, **To** (recipient names and addresses) and **Message**, plus attachments. The **From** line is your own account, so it isn't hideable.
- In the dashboard, a coloured lock appears beside the date on Sent and Scheduled emails, using the same colours: red, yellow or green. These emails count as reviewed from the start, so they never show grey.

**2. Compose window**
- A lock button sits in the composer's bottom toolbar, next to the formatting, attach and emoji buttons.
- Clicking it switches the composer to a "Privacy" view. You see the Subject, To and Message as read-only text with the same field locks, highlighting and bottom bar, and you can mark attachments too.
- Press Done to go back to editing. If you change the text after hiding parts of it, the hidden parts follow the edited text as closely as possible. Any hidden part whose text was deleted is dropped.
- The lock button turns yellow or red when something is hidden, so you can tell at a glance.
- When you send or schedule, the hidden parts move to the Sent or Scheduled email. Drafts keep them too.

**3. AI Access page**
- "What the AI sees" now includes Sent and Scheduled emails, with hidden parts shown as `*` or `[hidden: Label]`.
- New switches under "Automatically hide from AI" for **sent emails**: Subject, Recipients, Message body and Attachments. These apply to every sent or scheduled email unless you unlock a part on one email.

## Not included
- Drafts don't appear in the AI view. They keep their hidden parts only so those carry over when you send.
- The AI connection stays demo-only.

## Technical details
- `privacy.js`: add a `to` field (`hiddenToRanges`) to the privacy fields. `isReceived` stays for received-only logic. Add `isOutgoing` (sent/scheduled) and a `fieldsFor(message)` helper that returns subject/sender/email/body for received mail and subject/to/body for outgoing mail. `lockStatus`, `aiView`, `applyDefaults` and `hideEntireMessage` use `fieldsFor`, and `applyDefaults` reads a separate `aiDefaults.sent` object. Outgoing mail is treated as reviewed.
- `App.jsx`: show the reader lock and dashboard lock for outgoing mail; render the To row with `PrivacyText` in lock mode; pull the reader lock-mode state and `confirmPrivacy`/`hideAll`/field toggle into a reusable `usePrivacyEditor(target, onPatch)` hook so the composer can use it too.
- `Compose.jsx`: add the lock tool and a Privacy view that renders plain-text Subject/To/Body using `PrivacyText` and `PrivacyBar`; store the ranges on the draft. When the editor text changes, remap the ranges with a small diff helper (`remapRanges(oldText, newText, ranges)` in `privacy.js`, keeping only matched spans). Copy the ranges onto the sent or scheduled message in the existing send path.
- Move `PrivacyText` from `App.jsx` into its own module so both files can import it.
- Tests in `src/test/privacy.test.ts`: outgoing status colours, the To field in the AI view, `remapRanges` keeping or dropping spans, and sent-email defaults.
- Update `roadmap.md`.
