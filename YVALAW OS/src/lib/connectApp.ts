// Remembers /connect-app?… across the login screen, so "Sign in with YVA OS" from the
// desktop app still works when the person wasn't logged in to YVA OS yet.
export const CONNECT_RETURN_KEY = 'yva_connect_return'

export function rememberConnectReturn(pathname: string, search: string) {
  if (pathname === '/connect-app') sessionStorage.setItem(CONNECT_RETURN_KEY, pathname + search)
}

/** Where to go after logging in: the saved connect page, or the home page */
export function afterLoginPath(): string {
  const saved = sessionStorage.getItem(CONNECT_RETURN_KEY)
  return saved && saved.startsWith('/connect-app?') ? saved : '/'
}
