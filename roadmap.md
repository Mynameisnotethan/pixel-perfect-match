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
- [x] Wire web UI to live connections; Outlook sign-in by code; admin Setup wizard; standalone desktop screens; Docker image workflow.
- [x] First-run setup in the browser: one-time code from the mail container log, single administrator, backend sessions with CSRF, Caddy without Basic Auth, Hostinger needs only the domain.
- [ ] Live Gmail/Outlook verification — blocked on publisher OAuth registrations and Google restricted-scope approval.
- [ ] Build Windows installer on Windows and run live Gmail/Outlook acceptance test (needs your Google + Microsoft registrations)
- [ ] First Hostinger deploy + GitHub secrets (needs your VPS, domain, and provider registrations)

# Independent ownership

- [x] Confirm runtime has no shared Lockbox mailbox service or hardcoded provider credentials.
- [x] Document per-owner GitHub, Hostinger, domain, provider registrations, and encrypted storage.
- [x] Move the Outlook device client ID into post-deployment Setup; leave only domain and initial Lockbox login in Hostinger.
- [x] Make docker-compose.yml deployable from a bare raw file URL: images only, no build contexts or relative mounts; Caddyfile baked into lockbox-proxy.
- [ ] First Hostinger deploy: paste the raw compose URL, make the three ghcr.io packages public once, then add provider credentials in Setup.
- [x] AI Access: multiple per-account API keys + card layout
- [x] Keep every Hide by default switch on for new, incomplete, and reset settings while preserving deliberate exceptions
- [x] Remove the Hide by default Save button; save each unlocked change automatically

# AI API security verification

- [x] Verify real HTTP API-key authentication, read-only behavior, no-store responses, and revocation
- [x] Verify serialized API responses contain no hidden or unreviewed content

# Secure and efficient desktop storage

- [x] Encrypt saved desktop app data with an OS-vault key and authenticated encryption
- [x] Use lossless compression and one compact data file without dropping email, draft, or attachment fields
- [x] Migrate existing desktop browser storage into encrypted storage and remove plaintext copies
- [x] Add online-only mode that excludes messages, drafts, and queued sends from persistent storage
- [x] Clear transient Chromium cache on exit and install per Windows user without machine-wide access
- [ ] Build and verify the Windows installer and OS credential-vault behavior on Windows

# Interface and quality audit

- [x] Rename the Servers sidebar button to Mailboxes (plural, no apostrophe)
- [x] Run the full automated test suite and static lint audit; fix regressions found
- [x] Smoke-test navigation, mailbox connection, Compose, privacy controls, and AI Access in the browser
- [x] Record any remaining checks that require real provider accounts, Hostinger, or Windows
- [x] Fix account-folder navigation for provider IDs containing colons
- [x] Keep live mode free of sample reset/export paths; clear live browser caches on sign-out
- [x] Reconcile live refreshes, wire the Refresh button, and await credential removal before disconnect succeeds
- [x] Save privacy-rule changes immediately in order with retry instead of a cancellable debounce
- [x] Apply sent-mail privacy defaults inside Compose and block unsupported live scheduling explicitly
- [x] Preserve To/Cc/Bcc, plain/HTML bodies, and attachments through Gmail, Microsoft Graph, and SMTP
- [x] Allow the send endpoint to carry the composer's 25 MB attachment allowance without relaxing other request limits
- [x] Replace remaining Cypht browser-tab metadata and the Servers page heading with Lockbox/Mailboxes

# Message list interaction

- [x] Open the email when any empty part of a message row is clicked, not only its text
- [x] Keep the row's checkbox and flag controls working without opening the email
- [x] Cover the behaviour with a test and verify clicking, back, and draft rows in the browser
