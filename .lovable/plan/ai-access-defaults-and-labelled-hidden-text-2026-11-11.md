# AI Access defaults and labelled hidden text

## What you'll get

### 1. Default hiding rules on the AI Access page
A new "Automatically hide from AI" section with on/off switches:
- Subject (header)
- Sender name
- Sender email
- Message body
- Attachments

When a switch is on, that part of **every received email** is hidden from the AI unless you have specifically unlocked it on that email. The inbox lock colours and the "What the AI sees" preview update immediately. Turning a switch off returns to your per-email choices.

### 2. Labels and colours for hidden text
- When you Confirm a lock (or tap a field lock / Hide all), you can pick a **label** first: a small picker in the bottom bar with presets (Financial info, Personal info, Password, Address, Phone number, Other) plus "Custom…" to type your own name.
- Each label has a colour. Presets come with colours; custom labels let you pick from a palette. Labels you create are remembered for next time.
- In lock mode, hidden text shows as `*` in that label's colour, with the label name on hover. Hidden attachments get the colour as well.
- Unlabelled hides still work as before (grey).

### 3. What the AI sees
Instead of `[hidden]`, the AI receives the label, e.g. `Please pay [hidden: Financial info] by Friday`. It knows the kind of information but never the text itself. Parts hidden by the default rules show as `[hidden: Subject]`, `[hidden: Body]`, etc.

## Limits
Still demo-only: everything is kept in this browser and no outside AI agent can connect yet.

## Technical details
- New saved settings `ai-defaults` `{subject, sender, email, body, attachments}` and `privacy-labels` `[{id, name, color}]`.
- Hidden ranges become `[start, end, labelId?]`; merge/subtract keep label per range (adjacent same-label ranges merge). Old saved ranges stay valid.
- Per-email override: `unlockedFields` / unlocked attachment indexes so Unlock beats a default rule.
- `lockStatus` and `aiView` take the defaults and labels into account; `redact` outputs `[hidden: Label]`.
- Edits: `privacy.js`, `PrivacyBar.jsx` (label picker), `App.jsx` (AI Access settings, colours), `preview.css`; tests extended for defaults, overrides, labelled redaction and status colours.
