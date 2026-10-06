import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { applyColorTheme } from '../lib/colorTheme';
import { useSettings } from '../lib/settings';
import { getTranslation, cachedTranslation, type Translation } from '../lib/translate';
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
  const { colorTheme, customColor } = useSettings();
  // The chosen color theme goes over the cover's colors (nothing changes with "Album colors").
  const raw = !url ? FALLBACK_PALETTE : state.palette;
  const palette = useMemo(() => applyColorTheme(raw, colorTheme, customColor), [raw, colorTheme, customColor]);
  if (!url) return { palette, ready: true };
  // Keep showing the previous palette until the new one is ready (no flash).
  return { palette, ready: state.url === url };
}

export interface TranslationResult {
  /** One entry per lyric line, or null while there is nothing to show (off, loading, or it failed). */
  lines: string[] | null;
  loading: boolean;
}

/**
 * The translation of a song's lyric lines into the language chosen in Settings. Nothing is asked for while the
 * setting is off. When the song is already in that language, there is nothing to show.
 */
export function useTranslation(track: TrackInfo | null, lyrics: Lyrics | null): TranslationResult {
  const { translate, translateTo } = useSettings();
  const key = track?.key ?? null;
  const lines = lyrics && lyrics.kind === 'synced' ? lyrics.lines : null;
  const [state, setState] = useState<{ id: string; result: Translation | null; loading: boolean }>({ id: '', result: null, loading: false });
  const id = `${key}|${translateTo}|${lines?.length ?? 0}`;

  useEffect(() => {
    if (!translate || !key || !lines || !lines.length) return;
    const hit = cachedTranslation(key, translateTo, lines.length);
    if (hit) {
      setState({ id, result: hit, loading: false });
      return;
    }
    const abort = new AbortController();
    setState({ id, result: null, loading: true });
    getTranslation(key, lines, translateTo, abort.signal).then(
      (result) => !abort.signal.aborted && setState({ id, result, loading: false }),
      () => !abort.signal.aborted && setState({ id, result: null, loading: false }),
    );
    return () => abort.abort();
  }, [translate, key, translateTo, lines]);

  if (!translate || state.id !== id) return { lines: null, loading: translate && !!lines };
  const from = state.result?.from.toLowerCase().split('-')[0] ?? '';
  const sameLanguage = !!from && from === translateTo.toLowerCase().split('-')[0];
  return { lines: sameLanguage ? null : (state.result?.lines ?? null), loading: state.loading };
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
