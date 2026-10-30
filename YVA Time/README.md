# YVA Time

Windows desktop time tracker for YVA Staffing employees. Employees sign in with their
YVA OS account ("Sign in with YVA OS" — the app never sees a password). Details and the
security model are in `../YVALAW OS/CLAUDE.md` → "YVA Time".

```
npm install
npm test           # tracking-engine unit tests
npm run typecheck
npm start          # build + run (talks to https://yvastaffing.agency)
npm run dist       # Windows installer → release/YVA-Time-Setup.exe (run on Windows / CI)
```

Layout:

- `src/main/tracker.ts` — tracking engine (10-minute blocks, idle Keep/Remove, break, removed blocks); pure logic, unit-tested
- `src/main/controller.ts` — runs it: screenshots, uploads every minute, offline queue, UI snapshot
- `src/main/auth.ts` — PKCE sign-in through YVA OS `/connect-app`, encrypted session (Windows DPAPI)
- `src/main/api.ts` — `employee-me`, `tracker_blocks`, `tracker_screenshots`, private `screenshots` bucket
- `src/main/main.ts` — window, tray, `yvatime://` links, start with Windows
- `src/renderer/` — React UI; `src/preload/` — the `window.yva` bridge

Testing hooks (environment variables, never set in the installed app): `YVA_API_BASE`,
`YVA_USER_DATA`, `YVA_SYNC_MS`, `YVA_TEST_SHOT_OFFSET`, `YVA_TEST_NO_BROWSER`, `YVA_TEST_IDLE_FILE`.

Icons: `node "YVA Time/scripts/make-icons.mjs"` from the repo root regenerates them from the YVA logo.
