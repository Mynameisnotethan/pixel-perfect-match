# Lockbox

Self-hosted email with per-message controls for hiding selected information from AI access. Lockbox includes a browser app, an optional Windows desktop app, and Docker services for connecting Gmail and Outlook directly to an installation controlled by its owner.

## Own your deployment

Every independent installation uses its own GitHub copy, server, domain, Google/Microsoft app registrations, and encrypted mailbox storage. The upstream repository supplies source code only; there is no shared Lockbox mailbox service.

Start with **[Run your own Lockbox](docs/SELF_HOSTING.md)** for the per-owner Hostinger checklist and ownership boundaries.

## Documentation

- [Self-hosting and ownership](docs/SELF_HOSTING.md)
- [Hostinger deployment and GitHub automation](docs/HOSTINGER_DEPLOY.md)
- [Google and Microsoft mailbox setup](docs/MAILBOX_SETUP.md)
- [Original Cypht preview notes](CYPHT_README.md)

## Local development

Requires Node.js and npm.

```sh
npm install
npm run dev
```

The Lovable preview uses simulated mailbox connections. Live web mailbox connections run through the self-hosted Docker deployment; desktop connections use the desktop app's local system credential store.

## Verification status

The application builds and its automated tests cover the mailbox helpers, but real Google/Microsoft sign-in, a production Hostinger deployment, and the Windows installer still require testing with the owner's accounts and registrations.
