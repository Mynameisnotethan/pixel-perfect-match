# Source and third-party notices

## Cypht

Source: https://github.com/cypht-org/cypht

Copyright belongs to the original authors and contributors. See the preserved `LICENSE` and original source notices. The upstream project identifies its license as LGPL-2.1; that license is included unchanged.

Reused files:

- `src/styles/upstream-core.css` is copied byte-for-byte from `modules/core/site.css`.
- `src/styles/upstream-theme.css` derives from `modules/themes/assets/default/css/default.css`. Its relative vendor @import was removed because Bootstrap is imported from the npm package in src/main.jsx; all other source lines are retained.
- The upstream `logo.svg` / `logo_dark.svg` wordmarks are no longer shipped. The interface now shows the Lockbox mark supplied by the project owner, served from `src/assets/*.asset.json` pointers.
- `reference/cypht-upstream-source.zip` preserves every `cypht-master/` entry from the supplied upstream snapshot.

New React components, sample data, documentation, and integration styles were added for this preview. Source is provided in this package; no upstream PHP files were changed. The derived frontend is distributed under the accompanying LGPL-2.1 terms. This project is not represented as an official Cypht release.

## npm dependencies

React and React DOM: https://github.com/facebook/react — MIT.

Bootstrap: https://github.com/twbs/bootstrap — MIT. The preserved default theme also contains its original Bootstrap attribution.

Bootstrap Icons: https://github.com/twbs/icons — MIT.

Vite: https://github.com/vitejs/vite — MIT.

@vitejs/plugin-react: https://github.com/vitejs/vite-plugin-react — MIT.

Dependency versions are recorded in package-lock.json; their packages include applicable notices. Running npm ci downloads those dependencies. No node_modules directory or precompiled dependency bundles are shipped in this ZIP.
