# Connect Lockbox to ChatGPT with a copyable prompt per API key

## Why ChatGPT failed
ChatGPT's chat sandbox (the code tool it uses) can't reach arbitrary websites; its network blocked looking up your server's address, so the request never reached Lockbox. Your key and server were not the problem. ChatGPT can only call outside services through a **Custom GPT Action** (or a skill that runs where it has internet), and Actions need a description file of the API (an OpenAPI schema). Lockbox doesn't publish one yet.

Also: the key you pasted into ChatGPT should be deleted in AI Access and replaced.

## What to build
1. **Public API description** at `https://YOUR-DOMAIN/api/ai/v1/openapi.json` (and the desktop address). It lists the two read-only operations: list emails, read one email. No email data, no key needed to read it. ChatGPT can import it straight into a Custom GPT Action.
2. **"Copy ChatGPT prompt" button on each API key** in AI Access. It copies a ready-made prompt containing:
   - The server address and the schema link
   - Step-by-step: create a Custom GPT → Actions → Import from URL → Authentication: API key, Bearer, paste your key there (not in chat)
   - Instructions telling ChatGPT how to use the mailbox: read-only, respect `[hidden: Label]` markers, never guess hidden content, page with `limit`
   - Also a "skill" version (instructions file) for agents that support skills and have internet.
   The prompt never includes the key itself, so it's safe to paste; the key is entered only in the secure Authentication field.
3. Key name shown in the prompt so you know which key a GPT uses; deleting the key cuts that GPT off.
4. Desktop: same button, with a note that ChatGPT on the web can't reach `127.0.0.1` — desktop keys work only with agents running on that computer.

## Technical details
- `connectors/ai-feed.mjs`: serve `GET /api/ai/v1/openapi.json` (OpenAPI 3.1, bearerAuth, operations `listMessages`, `getMessage`, servers set from configured public URL). Already forwarded via `/api/*`.
- New `src/cypht/ai-prompt.js`: `buildChatGptPrompt({ endpoint, keyName })` — pure, tested.
- AI Access key rows in `src/cypht/App.jsx`: add copy button + toast.
- Tests: schema route returns 200 without auth and contains no message data; prompt contains endpoint and schema URL and never contains a `lbx_` key.
- Docs: ChatGPT section in `docs/HOSTINGER_DEPLOY.md`.
- Needs redeploy (pull latest images) on Hostinger after merge.
