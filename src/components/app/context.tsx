// What every page of the Spotify-style app can reach: the player, the library, and moving between pages.
import { createContext, useContext } from 'react';
import type { Catalog, Profile } from '../../lib/catalog';
import type { Engine } from '../../lib/engine';
import type { Router } from './nav';

export interface AppContextValue {
  engine: Engine;
  catalog: Catalog;
  router: Router;
  profile: Profile | null;
  /** Opens the lyrics (Lyrics Stage) with its animation. */
  openLyrics: () => void;
  onSignOut: () => void;
  /** Signs in with Spotify again (to give the app the permissions the library needs). */
  reconnect: () => void;
  /** This sign-in can't read the library yet. */
  needsReconnect: boolean;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside the app shell');
  return v;
}
