// Spotify only allows 127.0.0.1 (not "localhost") as a local redirect address,
// and logins are saved per address, so the web version always runs at
// 127.0.0.1. Opened at http://localhost:5173 while developing, it moves there.
//
// The Android app must never do this: inside the app the page is served from
// https://localhost (that is how the app's web view works), and there is
// nothing at 127.0.0.1 on a phone, so moving there leaves a blank page.

/** Where the page should move to, or null to stay where it is. */
export function loopbackAddress(href: string, inApp: boolean): string | null {
  if (inApp) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // Only the plain-http development address; anything served over https is not the dev server.
  if (url.protocol !== 'http:' || url.hostname !== 'localhost') return null;
  url.hostname = '127.0.0.1';
  return url.href;
}
