// Lets the lyrics page ask Musixmatch for word timings. The page can't do it itself (the service doesn't allow web pages
// to call it), so this process does, but only for the two requests the page needs, never for any other address.
const ORIGIN = 'https://apic-appmobile.musixmatch.com';
const ALLOWED = ['/ws/1.1/macro.subtitles.get?', '/ws/1.1/token.get?'];

export interface MusixmatchAnswer {
  status: number;
  body: string;
}

/** The full address for a page's request, or null when it asks for anything other than the allowed two. Exported for tests. */
export function musixmatchUrl(pathAndQuery: unknown): string | null {
  if (typeof pathAndQuery !== 'string' || pathAndQuery.length > 3000) return null;
  if (!ALLOWED.some((p) => pathAndQuery.startsWith(p))) return null;
  const url = new URL(pathAndQuery, ORIGIN);
  return url.origin === ORIGIN ? url.toString() : null;
}

export const MUSIXMATCH_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'X-Cookie': 'x-mxm-token-guid=',
  'x-mxm-app-version': '10.1.1',
};

export async function musixmatchGet(pathAndQuery: unknown): Promise<MusixmatchAnswer> {
  const url = musixmatchUrl(pathAndQuery);
  if (!url) return { status: 400, body: '' };
  try {
    const res = await fetch(url, { headers: MUSIXMATCH_HEADERS, signal: AbortSignal.timeout(15_000) });
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: '' };
  }
}
