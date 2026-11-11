# Compose update

- [x] Replace the old Compose dialog with a Gmail-style floating, minimizable, expandable demo composer.
- [x] Add recipient chips and contact suggestions, rich text, attachments, links, emoji, signatures, and draft recovery.
- [x] Add clearly labelled demo sending, undo, scheduling, and scheduled-message management.
- [x] Verify the main Compose flows on desktop and narrow screens; document provider-only limitations.

# AI privacy refinements

- [x] Keep the original email readable outside lock mode and show its privacy colour in the reader toolbar.
- [x] Allow partial hiding of the subject, sender name, and sender email, including AI-view redaction and status calculation.
- [x] Verify body and header hiding, unlocking, persistence, and normal reading in the browser; run privacy tests.

# Quick privacy controls

- [x] Add a one-tap hide/reveal lock to each selectable subject, sender, email, and body field.
- [x] Add Hide all to the privacy bar while retaining range selection and attachment controls.
- [x] Remove the privacy-bar hint and privacy confirmation notifications; verify quick controls and existing selection flows.

# Lock-mode layout

- [x] Replace overlapping dashed outlines with organized, labelled privacy fields and grouped controls.
- [x] Verify selection, quick hide/reveal, and the narrow-screen layout.

# AI defaults and labels

- [x] Add auto-hide switches (subject, name, email, body, attachments) to AI Access.
- [x] Add coloured, named labels for hidden text; AI sees "[hidden: Label]".

# Label management in AI Access

- [x] Add a new-label form (name + colour) to the AI Access page.
- [x] Allow renaming, recolouring, and deleting any label, plus restoring the defaults.
- [x] Keep the bottom-bar picker in sync and clear a deleted label from the pending selection.
- [x] Verify create, duplicate refusal, rename, use in the AI view, delete, and restore in the browser.
- [x] Hide-from-AI lock in Compose, Sent and Scheduled emails (+ sent-email AI defaults)

# Branding

- [x] Replace every Cypht logo with the supplied Lockbox mark (light + dark wordmarks).
- [x] Set the browser-tab icon from the mark's padlock and drop the default icon.

# Gmail / Outlook mailbox connection

- [x] Add Mailbox screen with Connect Gmail / Connect Outlook, clearly labelled demo mode and connection states.
- [x] Shared OAuth (PKCE, refresh, reconnect), Gmail API and Graph sync/send in `connectors/`.
- [x] Desktop shell (loopback OAuth, OS vault) and Docker backend (HTTPS callbacks, encrypted volume store).
- [x] Setup guide for Google Cloud, Microsoft Entra and self-hosters.
- [ ] Live verification and wiring the UI to live connections — blocked on OAuth client registrations.
