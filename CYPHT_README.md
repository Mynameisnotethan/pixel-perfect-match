# Cypht — editable Lovable preview

A runnable React recreation of Cypht's interface, using its original core stylesheet, default teal theme, and logos. Opens straight into a populated sample inbox so you can edit the app in a frontend preview.

## Open in Lovable

1. Start a new project using Lovable's **Upload code** / code-import option.
2. Upload `cypht-lovable-preview.zip`. Its root contains `package.json` and `index.html`.
3. Paste the contents of `LOVABLE_PROMPT.md` into the project chat.
4. Let Lovable install dependencies and open its preview. Then describe the changes you want.

Code import creates/adapts a project; GitHub sync is a separate feature. Depending on the platform's current runtime, Lovable may adapt the Vite entry point to its supported React framework. The prompt instructs it to retain these existing screens and styles.

This package was built and checked locally. It has not been imported into your Lovable account here, so platform-side rendering remains to be verified after upload.

## Run locally

Requires Node.js **22.12 or later** (Node 24 LTS is suitable) and npm. Internet access is needed for the first dependency install.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. The app requires no environment variables or server credentials. On Windows, you can double-click `start-preview.cmd`; on macOS/Linux, run `bash start-preview.sh`.

```sh
npm run build
npm run preview
```

For a new GitHub repository, upload the extracted source files, including package.json and package-lock.json, at the repository root. Do not upload node_modules or dist. This ZIP contains no Git history and has not created a repository in your account.

## What works in this preview

- Everything inbox and individual account folders, unread, flagged, drafts, sent, archive, junk, and trash.
- Search, sort, page size, source filtering, selection, bulk actions, and restoring messages to Inbox.
- Reading messages, toggling flags, read/unread, reply/forward composition, automatic draft recovery, demo Undo Send, and browser-local demo scheduling.
- Gmail-style floating composer with multiple drafts, recipient chips, rich text, links, emoji, signatures, templates, and local inline images.
- Attachments are stored as browser data for the demo, subject to browser storage limits and a 25 MB total composer limit.
- Local contacts with add/edit/delete and composing to a contact.
- Local calendar with month navigation and add/remove events.
- Sample account configuration with add/edit/remove. No provider login is performed.
- Light/dark themes, compact rows, reading pane, time-zone display, export, and resetting sample data.
- Responsive navigation for narrower previews.

Changes are kept in browser localStorage under the `cypht-preview:v1:` prefix. No mail-provider requests are made. Reset only removes this app's preview data.

## Scope and limitations

This is an editable frontend recreation, **not a complete 1:1 functional port**. It does not run Cypht's original PHP backend. Real mailbox authentication, delivery, synchronization, OAuth, Sieve, PGP, RSS retrieval, all upstream modules/themes, and provider calendar/contact sync are not implemented. The preview must never report successful real delivery. Compose's Send button moves a sample message into Sent and reports that no email was sent.

Desktop installation is deferred until after interface editing. This package contains neither an Electron wrapper nor a native installer. A desktop shell alone would not implement real mail access.

Original source is preserved as `reference/cypht-upstream-source.zip`, containing the exact `cypht-master/` files from the earlier downloaded repository snapshot. It is reference material, not a frontend build input. The snapshot is not guaranteed to be the latest upstream revision.

## Where to edit

| File | Purpose |
| --- | --- |
| `src/App.jsx` | Screens, controls, dialogs, and local preview state |
| `src/data.js` | Sample messages, accounts, contacts, default settings |
| `src/styles/preview.css` | Editable layout and integration styles |
| `src/styles/upstream-core.css` | Original Cypht core CSS, unchanged |
| `src/styles/upstream-theme.css` | Original default-theme CSS, with its vendor import removed |
| `public/assets/` | Original Cypht logos |
| `reference/cypht-upstream-source.zip` | Original PHP source and license |
| `LOVABLE_PROMPT.md` | Import-and-preview instructions to paste into Lovable |

See `LICENSE` and `THIRD_PARTY_NOTICES.md` for source attribution.
