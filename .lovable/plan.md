# Redesign the API keys section (AI Access)

Goal: replace the cramped table with clean, readable key cards that fit both wide and narrow screens. No behavior changes — same create, copy, edit, prompt, MCP setup, disconnect and delete actions.

## What changes

1. **Header**
   - Title "API keys" with a small key-count pill, short description underneath, "Create API key" button on the right.
   - Server build shown as a subtle chip instead of a loose line.

2. **Create form**
   - Inline card with the name field and Create/Cancel, matching the rest of AI Access.

3. **New-key notice**
   - Amber callout with a warning icon, the key in a monospace box and a clear Copy button.

4. **Connection address / demo note**
   - Soft info panel with an icon; address and Copy button on one row; the curl example collapsed under "Show example".

5. **Key list: cards instead of a table**
   - Each key is a card:
     - Top row: key name (bold) + masked key `lbx_••••1c56` as a monospace chip.
     - Permission badges: mailbox scope ("All mailboxes"), then See / Draft / Send as colored pills (Send in a distinct accent so it stands out, since it sends without approval).
     - Meta line: "Created Nov 13, 2026 · Last used Never".
     - Connected apps as small chips with a Disconnect link.
     - Actions on the right: Edit (primary outline), ChatGPT prompt and MCP setup grouped as icon+label buttons, Delete as a red icon button kept apart from the rest.
   - Cards stack on narrow screens, actions wrap below.

6. **Empty state**
   - Centered key icon, "No API keys yet", and a Create button.

## Technical details
- Edit only `src/cypht/AiKeys.jsx` markup (the `ai-keys` return block) and the `.ai-key*` rules in `src/cypht/styles/preview.css`; reuse existing teal accent and theme variables, no hardcoded new colors beyond existing tokens.
- Keep existing aria-labels so tests still pass; run the test suite and browser-check at desktop and 779px width.
