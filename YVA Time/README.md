# YVA Time

Windows desktop time tracker for YVA Staffing employees. Employees sign in with their
YVA OS account ("Sign in with YVA OS" — the app never sees a password). Details and the
security model are in `../YVALAW OS/CLAUDE.md` → "YVA Time".

```
npm install
npm test           # tracking-engine unit tests
npm run typecheck
npm start          # build + run (talks to https://yvastaffing.agency)
npm run dist       # Windows installer → release/YVA-Time-Setup.exe + latest.yml (run on Windows / CI)
```

## Releasing a new version (installed apps update themselves)

1. Change `"version"` in `package.json` (e.g. `0.3.1`) and merge it to `main`.
2. GitHub → Actions → "YVA Time — Windows installer" → **Run workflow** with **Publish** ticked
   (or push the tag `yva-time-v0.3.1`). It builds the installer and publishes a GitHub Release with
   `YVA-Time-Setup.exe`, its `.blockmap` and `latest.yml`. Each version can be published only once.
3. Installed apps check every 4 hours (and 30 s after starting), download it in the background and
   show **Restart to update**; otherwise it installs the next time the app quits.

Updates come from this repository's GitHub Releases, so the repository must stay public (or the app
needs a token) and only YVA Time should publish Releases here. Download link for new staff:
`https://github.com/YVALaw/YVALaw/releases/latest/download/YVA-Time-Setup.exe`.

## Code signing (removes Windows' "unknown publisher" warning)

Signing switches on by itself once these exist in GitHub → repository Settings → Secrets and
variables → Actions (`electron-builder.config.cjs` reads them):

- **Azure Trusted Signing** (recommended, about $10/month; YVA Staffing must pass Microsoft's
  business identity check): secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
  (an app registration with the "Trusted Signing Certificate Profile Signer" role) and variables
  `YVA_SIGN_ENDPOINT` (e.g. `https://eus.codesigning.azure.net`), `YVA_SIGN_ACCOUNT`,
  `YVA_SIGN_PROFILE`, `YVA_SIGN_PUBLISHER` (the certificate's name, e.g. `YVA Staffing LLC`).
- **Or a certificate file** from a certificate authority: secrets `WIN_CSC_LINK` (the .pfx as base64)
  and `WIN_CSC_KEY_PASSWORD`.

Once signed, updates must keep the same publisher name (electron-updater checks it).

Layout:

- `src/main/tracker.ts` — tracking engine (10-minute blocks, idle Keep/Remove, break, removed blocks); pure logic, unit-tested
- `src/main/controller.ts` — runs it: screenshots, check-in + uploads every minute, offline queue, UI snapshot
- `src/main/auth.ts` — PKCE sign-in through YVA OS `/connect-app`; the sign-in records this computer
  (`desktop_devices`) and returns the app's own session, stored encrypted (Windows DPAPI)
- `src/main/api.ts` — `employee-me`, `tracker_blocks` (seconds, activity, first/last second),
  `tracker_screenshots`, private `screenshots` bucket, computer check-in
- `src/main/updater.ts` — automatic updates from GitHub Releases (installed app only)
- `src/main/reminders.ts` — shift start/end reminders (pure logic, unit-tested)
- `src/main/main.ts` — window, tray, `yvatime://` links, start with Windows, notifications
- `src/renderer/` — React UI; `src/preload/` — the `window.yva` bridge

Testing hooks (environment variables, never set in the installed app): `YVA_API_BASE`,
`YVA_USER_DATA`, `YVA_SYNC_MS`, `YVA_TEST_SHOT_OFFSET`, `YVA_TEST_NO_BROWSER`, `YVA_TEST_IDLE_FILE`.

Icons: `node "YVA Time/scripts/make-icons.mjs"` from the repo root regenerates them from the YVA logo.
