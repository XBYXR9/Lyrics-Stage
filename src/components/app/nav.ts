// Where the Spotify-style app is: which page is open, and the pages visited before it (for the Back button).
import { useCallback, useState } from 'react';

export type Route =
  | { view: 'home' }
  | { view: 'search'; q?: string }
  | { view: 'library' }
  | { view: 'liked' }
  | { view: 'queue' }
  | { view: 'settings' }
  | { view: 'playlist'; id: string }
  | { view: 'album'; id: string }
  | { view: 'artist'; id: string };

export type View = Route['view'];

/** A key that is the same for the same page (to start loading again when the page changes). */
export const routeKey = (r: Route) => ('id' in r ? `${r.view}:${r.id}` : r.view === 'search' ? `search:${r.q ?? ''}` : r.view);

export interface Router {
  route: Route;
  go: (route: Route) => void;
  back: () => void;
  canBack: boolean;
}

export function useRouter(initial: Route = { view: 'home' }): Router {
  const [stack, setStack] = useState<Route[]>([initial]);
  const go = useCallback(
    (route: Route) =>
      setStack((s) => {
        const top = s[s.length - 1];
        if (routeKey(top) === routeKey(route)) return s;
        // The main pages (home, search, library...) start a new trail; detail pages stack up.
        const detail = 'id' in route;
        return detail ? [...s.slice(-30), route] : [route];
      }),
    [],
  );
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  return { route: stack[stack.length - 1], go, back, canBack: stack.length > 1 };
}
