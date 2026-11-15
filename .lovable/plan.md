# Two permanent download links (Windows + Mac)

## Result
After you publish a release (e.g. tag `v0.1.0`) on GitHub, these two links always point to the newest version:

- Windows: `https://github.com/<you>/<repo>/releases/latest/download/Lockbox-Setup.exe`
- Mac: `https://github.com/<you>/<repo>/releases/latest/download/Lockbox.dmg`

## Changes
1. **Fixed file names** — set installer names in the desktop build settings so every release produces exactly `Lockbox-Setup.exe` and `Lockbox.dmg` (no version numbers), keeping the links stable.
2. **Mac build** — add Mac settings (universal build for Intel and Apple Silicon, Applications drag-in window) and a new "Mac installer" GitHub workflow mirroring the Windows one: runs from the Actions tab or on `v*` tags, attaches `Lockbox.dmg` to the release. Unsigned (no paid Apple account), so first launch needs right-click → Open.
3. **Windows workflow** — unchanged except it uploads the renamed `Lockbox-Setup.exe`.
4. **Docs** — add a short "Download links" section to the desktop guide: how to create the release (Releases → Draft new release → tag `v0.1.0` → Publish), wait for both builds, then copy the two links; plus the Mac first-launch tip and Windows "More info → Run anyway" tip.

## What you do after
Publish a release on GitHub with tag `v0.1.0`, wait ~10 minutes, then share the two links. I can't create the release or confirm the builds succeed from here.

## Technical details
- `desktop/package.json` build: `win.artifactName: "Lockbox-Setup.${ext}"`, `mac: { target: [{target:"dmg", arch:["universal"]}], category: "public.app-category.productivity", artifactName: "Lockbox.${ext}" }`, `dmg` layout.
- `.github/workflows/mac-installer.yml` on `macos-latest`, same secrets, `CSC_IDENTITY_AUTO_DISCOVERY=false`, `npm run dist:mac -- --universal`, upload `desktop/release/*.dmg` via `softprops/action-gh-release@v2`.
- keytar is native; electron-builder rebuilds it for the universal target.
