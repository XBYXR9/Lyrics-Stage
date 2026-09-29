import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Engine, EngineState } from '../lib/engine';
import { getLyrics } from '../lib/lyrics';
import { FALLBACK_PALETTE, getPalette } from '../lib/palette';
import type { Lyrics, Palette, TrackInfo } from '../lib/types';

export function useEngineState(engine: Engine): EngineState {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

/**
 * Calls `cb` on every animation frame. The latest `cb` is always used, so it
 * can read fresh props without restarting the loop.
 */
export function useFrame(cb: (now: number) => void, enabled = true) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!enabled) return;
    let id = 0;
    const loop = (now: number) => {
      ref.current(now);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [enabled]);
}

/** Keeps a ref in sync with the latest value (handy inside animation loops). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface LyricsResult {
  lyrics: Lyrics | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

export function useLyrics(track: TrackInfo | null): LyricsResult {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string | null; lyrics: Lyrics | null; error: boolean }>({
    key: null,
    lyrics: null,
    error: false,
  });
  const key = track?.key ?? null;

  useEffect(() => {
    if (!track) return;
    let alive = true;
    getLyrics(track).then(
      (lyrics) => alive && setState({ key: track.key, lyrics, error: false }),
      () => alive && setState({ key: track.key, lyrics: null, error: true }),
    );
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const ready = state.key === key && key !== null;
  return {
    lyrics: ready ? state.lyrics : null,
    loading: key !== null && !ready,
    error: ready && state.error,
    retry: () => {
      setState((s) => ({ ...s, key: null }));
      setNonce((n) => n + 1);
    },
  };
}

export function usePalette(url: string | null | undefined): { palette: Palette; ready: boolean } {
  const [state, setState] = useState<{ url: string | null; palette: Palette }>({ url: null, palette: FALLBACK_PALETTE });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void getPalette(url).then((palette) => alive && setState({ url, palette }));
    return () => {
      alive = false;
    };
  }, [url]);
  if (!url) return { palette: FALLBACK_PALETTE, ready: true };
  // Keep showing the previous palette until the new one is ready (no flash).
  return { palette: state.palette, ready: state.url === url };
}

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
