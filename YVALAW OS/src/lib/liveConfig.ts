// Live updates switch (2026-11). While only one person uses YVA OS, the database (Supabase Free plan, Nano) is kept
// quiet: no Realtime connections, and background checks only every few minutes. Turn it on for the team by setting
// VITE_LIVE_UPDATES=on in Netlify (Site configuration → Environment variables) and redeploying.
//   on  → changes by teammates arrive at once (services/liveUpdates.ts), the bell gets new notifications pushed
//   off → data is re-read when you open a page (kept up to 1 minute), the bell checks every 10 minutes and when you
//         come back to the window, Home "working now" every 5 minutes
export const LIVE_UPDATES_ON = String(import.meta.env.VITE_LIVE_UPDATES ?? '').trim().toLowerCase() === 'on'
