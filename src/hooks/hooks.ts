import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Engine, EngineState } from '../lib/engine';
import { getLyrics, hasCachedLyrics } from '../lib/lyrics';
import { FALLBACK_PALETTE, getPalette } from '../lib/palette';
import { recordFrame, type RecordFrame } from '../lib/record';
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

/** How long to wait for the song's length before searching for lyrics without it. */
const LENGTH_WAIT_MS = 1500;

export function useLyrics(track: TrackInfo | null): LyricsResult {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string | null; lyrics: Lyrics | null; error: boolean }>({
    key: null,
    lyrics: null,
    error: false,
  });
  const key = track?.key ?? null;
  // The song's length helps pick the right version of the lyrics, and the
  // desktop app can learn it a moment after the title: look up again when it changes.
  const lengthSec = track ? Math.round(track.durationMs / 1000) : 0;

  useEffect(() => {
    if (!track) return;
    let alive = true;
    const load = () =>
      getLyrics(track).then(
        (lyrics) => alive && setState({ key: track.key, lyrics, error: false }),
        () => alive && setState({ key: track.key, lyrics: null, error: true }),
      );
    // No length yet: give the player a moment to report it before searching without it.
    const timer = lengthSec > 0 || hasCachedLyrics(track) ? void load() : setTimeout(load, LENGTH_WAIT_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, lengthSec, nonce]);

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

/**
 * Keeps something on screen while it plays an exit animation. `mounted` stays
 * true for `exitMs` after `visible` turns false; `leaving` is true during that
 * time. With exitMs = 0 it goes away at once. Used for the player panel when
 * "lyrics only" is switched on.
 */
export function usePresence(visible: boolean, exitMs: number): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true); // coming back: show right away
  useEffect(() => {
    if (visible || !mounted) return;
    if (exitMs <= 0) {
      setMounted(false);
      return;
    }
    const id = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(id);
  }, [visible, mounted, exitMs]);
  return { mounted: mounted || visible, leaving: !visible && mounted };
}

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Keeps the screen on while `on` is true (a phone would otherwise go dark in the
 * middle of a song). Asks again when the app comes back to the front, since the
 * system lets go of it whenever the screen is switched off.
 */
export function useKeepAwake(on: boolean) {
  useEffect(() => {
    if (!on || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const ask = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* not allowed right now (e.g. low battery): the screen just turns off as usual */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    void ask();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}

/** The 9:16 frame of the recording view, kept up to date while the window changes size. */
export function useRecordFrame(active: boolean): RecordFrame {
  const [frame, setFrame] = useState(() => recordFrame(window.innerWidth, window.innerHeight));
  useEffect(() => {
    if (!active) return;
    const update = () =>
      setFrame((old) => {
        const next = recordFrame(window.innerWidth, window.innerHeight);
        return next.width === old.width && next.height === old.height ? old : next;
      });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [active]);
  return frame;
}
