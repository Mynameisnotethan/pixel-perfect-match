# AI Access: hidden by default, protected settings, cleanup

## What you'll get

1. **Everything hidden by default** — A new person (or a new browser or account with no saved choices) starts with every "Hide by default" switch turned on: subject, sender name, sender email, body and attachments for received emails, plus subject, recipients, body and attachments for sent and scheduled emails. People who already saved their own choices keep them.

2. **Settings locked until you confirm** — The "Hide by default" switches are greyed out, with a **Change settings** button.
   - Clicking it opens a warning: "Changing these settings can let AI agents see parts of your emails that are hidden now." To continue, the person must type `Lock` into a box. The Continue button stays off until the word matches exactly.
   - The switches then become editable. Changes take effect only after you click **Save**. **Cancel** discards your changes, and the section locks again after you save or cancel.

3. **"What the AI sees" removed** — The preview card and its tab are removed from the AI Access page. Agents still get the same redacted view of your emails.

4. **Lock icon in the sidebar** — "AI Access" in the sidebar uses a lock icon instead of the robot.

5. **Matching scroll bars** — Every scroll area (sidebar, email list, email reader, composer, popups and the AI Access page) uses one thin teal scroll bar style, in light and dark mode.

## Technical details
- `App.jsx`: a `fullDefaults` constant is used as the initial value of `useSaved('ai-defaults')` and whenever the server returns no saved defaults. The AI Access section keeps local draft state, and the `Lock` dialog uses the existing dialog styling. Save sends the draft to `setAiDefaults`, which syncs it to the server. The preview card and tab are deleted, and the `nav('ai', …)` icon changes to `lock-fill`.
- `preview.css`: global `scrollbar-width: thin; scrollbar-color` plus `::-webkit-scrollbar*` rules that use theme variables. Per-element scroll bar overrides are removed.
- Tests: new-user defaults hide all fields; Save is blocked until `Lock` is typed exactly; Cancel leaves the saved defaults unchanged.
