// Where links that people open from an email or message (invites, new sign-in links,
// password resets) send them. Always the real site — even when an admin is working on a
// Netlify preview or localhost — because Supabase only accepts addresses on its
// Authentication → URL Configuration → Redirect URLs list (https://yvastaffing.agency/os/**).
export const APP_URL = ((import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || 'https://yvastaffing.agency/os/').replace(/\/*$/, '/')
