// What the app remembers for each song: its lyric style and its timing nudge. Saved in this browser only.
import { useSyncExternalStore } from 'react';
import type { StyleChoice } from './types';

export interface SongPrefs {
  style?: StyleChoice;
  /** The timing nudge (ms, positive = lyrics earlier). */
  nudgeMs?: number;
  /** When it was last used (to forget the oldest first). */
  at: number;
}

const KEY = 'ls.songs.v1';
/** How many songs are remembered. */
export const MAX_REMEMBERED_SONGS = 300;

type Memory = Record<string, SongPrefs>;

function load(): Memory {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Memory) : {};
  } catch {
    return {};
  }
}

let memory: Memory = load();
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* not remembered */
  }
  listeners.forEach((l) => l());
}

/** Keeps the newest `max` songs. Exported for tests. */
export function trimMemory(m: Memory, max = MAX_REMEMBERED_SONGS): Memory {
  const keys = Object.keys(m);
  if (keys.length <= max) return m;
  const keep = keys.sort((a, b) => (m[b].at ?? 0) - (m[a].at ?? 0)).slice(0, max);
  return Object.fromEntries(keep.map((k) => [k, m[k]]));
}

export function getSongPrefs(key: string | null | undefined): SongPrefs | null {
  return key ? (memory[key] ?? null) : null;
}

/** Remembers something about a song. A nudge of 0 is forgotten (it is the default). */
export function rememberSong(key: string, patch: Partial<Omit<SongPrefs, 'at'>>) {
  const next: SongPrefs = { ...memory[key], ...patch, at: Date.now() };
  if (next.nudgeMs === 0) delete next.nudgeMs;
  if (next.style === undefined && next.nudgeMs === undefined) {
    delete memory[key];
    memory = { ...memory };
  } else {
    memory = trimMemory({ ...memory, [key]: next });
  }
  save();
}

export function forgetSong(key: string) {
  if (!memory[key]) return;
  const { [key]: _gone, ...rest } = memory;
  memory = rest;
  save();
}

export function forgetAllSongs() {
  memory = {};
  save();
}

export const rememberedSongCount = () => Object.keys(memory).length;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The remembered choices for a song (null when there are none), updating when they change. */
export function useSongPrefs(key: string | null | undefined): SongPrefs | null {
  return useSyncExternalStore(subscribe, () => getSongPrefs(key));
}

/** How many songs are remembered, updating when it changes. */
export function useRememberedCount(): number {
  return useSyncExternalStore(subscribe, rememberedSongCount);
}
