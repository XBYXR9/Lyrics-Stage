// The two hooks behind the beat effects, both used by the main screen:
//  - useRealSound: starts listening to the computer's sound (Windows, if the
//    user allowed it) and keeps the "song window" up to date.
//  - useBeatFlash: finds strong beats and paints the chosen flash style.
// See src/lib/beat.ts for the rules and src/lib/audioLevels.ts for the sound.
import { useEffect, useRef, type RefObject } from 'react';
import {
  readAudioLevels,
  setAudioStatus,
  setPlaybackWindow,
  setSoundDelay,
  startAudioLevels,
  stopAudioLevels,
  takeBeat,
} from '../lib/audioLevels';
import { BEAT_PREVIEW_EVENT, beatPlan, canFlash, emitBeat, flashShape, FLASH_MS, inSongWindow, shortPauseAt, type BeatPlan } from '../lib/beat';
import type { Clock } from '../lib/clock';
import { desktopApi } from '../lib/desktopTypes';
import { BAR_COUNT, estimatedBeat } from '../lib/pulse';
import type { BeatStyle } from '../lib/settings';
import type { Lyrics } from '../lib/types';
import { useFrame, useLatest } from './hooks';

/** What counts as "the song is playing": the clock is running, we're inside the song, and it isn't an ad. */
export interface SongWindow {
  clock: Clock;
  durationMs: number;
  /** False during an ad or when there is no song. */
  active: boolean;
}

const windowOpen = (w: SongWindow, now: number) =>
  w.active && inSongWindow({ playing: w.clock.playing, positionMs: w.clock.now(now), durationMs: w.durationMs });

/**
 * Windows desktop app, once the user has allowed it: listens to the computer's
 * sound. Chromium wants a click or key press before it shares sound, so if the
 * first try is refused it tries again on the next few. The sound only counts
 * inside the song's playback window, which this hook sets every frame.
 */
export function useRealSound(on: boolean, song: SongWindow, delayMs: number) {
  const latest = useLatest(song);
  useEffect(() => {
    if (!on || desktopApi()?.platform !== 'win32') return;
    let alive = true;
    let tries = 0;
    const events = ['pointerdown', 'keydown'] as const;
    const stopWaiting = () => events.forEach((e) => window.removeEventListener(e, retry));
    const attempt = async () => {
      tries++;
      if (await startAudioLevels()) {
        stopWaiting();
        return;
      }
      // Not allowed yet: wait for the next click or key press (a few times, then give up quietly).
      if (alive && tries < 4) {
        events.forEach((e) => window.addEventListener(e, retry, { once: true }));
        setAudioStatus('waiting', 'Click anywhere in the app and it will start listening.');
      }
    };
    const retry = () => {
      stopWaiting();
      if (alive) void attempt();
    };
    void attempt();
    return () => {
      alive = false;
      stopWaiting();
      stopAudioLevels();
    };
  }, [on]);

  useEffect(() => setSoundDelay(delayMs), [delayMs, on]);

  useFrame((now) => setPlaybackWindow(windowOpen(latest.current, now)), on);
  useEffect(() => () => setPlaybackWindow(false), [on]);
}

/** The elements the flash paints onto. */
export interface BeatTargets {
  /** Holds the flash layers; gets the --bf variables. */
  fx: RefObject<HTMLElement | null>;
  /** The lyrics area: the "kick" style nudges it. */
  kick: RefObject<HTMLElement | null>;
}

export interface BeatFlashOptions {
  style: BeatStyle;
  reduceMotion: boolean;
  /** The lyrics of the song playing now (for the short pauses). */
  lyrics: Lyrics | null;
  /** Is the no-lyrics scene on screen? */
  sceneShown: boolean;
  /** Bass beats heard in the real sound also flash while someone is singing. */
  whileSinging: boolean;
  /** Flashes may follow fast drum patterns (up to about seven a second) instead of at most three a second. */
  fast: boolean;
  song: SongWindow;
  offsetMs: number;
  /** 0..1, how energetic the song feels: sets the speed of the estimated rhythm. */
  energy: number;
}

/** Peak "kick" size of the lyrics for a full-strength beat, on top of the shape's own 0.4 peak. */
const KICK_SCALE = 0.06;

/**
 * Finds strong beats (in the real sound if we're listening, otherwise the
 * estimated rhythm), announces them on the beat bus, and paints the chosen
 * flash style. Beats only count inside the song's window, and flashes follow
 * the safety rules in beat.ts: never more than three a second (unless fast beats were asked for), tinted and soft.
 */
export function useBeatFlash(targets: BeatTargets, o: BeatFlashOptions): BeatPlan {
  const plan = beatPlan({
    style: o.style,
    reduceMotion: o.reduceMotion,
    lyricsKind: o.lyrics?.kind ?? null,
    sceneShown: o.sceneShown,
    whileSinging: o.whileSinging,
  });
  const latest = useLatest({ ...o, plan });
  const memory = useRef({ prevT: -1, at: -Infinity, strength: 0, dark: true });
  const scratch = useRef(new Float32Array(BAR_COUNT));

  const paint = (level: number, ring: number, ringScale: number) => {
    const fx = targets.fx.current;
    if (fx) {
      fx.style.setProperty('--bf', level.toFixed(3));
      fx.style.setProperty('--bf-ring', ring.toFixed(3));
      fx.style.setProperty('--bf-rs', ringScale.toFixed(3));
    }
    const kick = targets.kick.current;
    if (kick) kick.style.transform = latest.current.style === 'kick' && level > 0 ? `scale(${(1 + level * KICK_SCALE).toFixed(4)})` : '';
  };

  // The glow and ring are centred on the lyrics area (the cover and player take room on the left), measured when a flash starts.
  const centre = () => {
    const fx = targets.fx.current;
    const area = targets.kick.current;
    if (!fx || !area) return;
    const f = fx.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    fx.style.setProperty('--bf-x', `${(a.left + a.width / 2 - f.left).toFixed(0)}px`);
    fx.style.setProperty('--bf-y', `${(a.top + a.height / 2 - f.top).toFixed(0)}px`);
  };

  // Settings asks for a sample of the chosen style.
  useEffect(() => {
    const onPreview = () => {
      const m = memory.current;
      const now = performance.now();
      const { reduceMotion, style, fast } = latest.current;
      if (reduceMotion || style === 'off' || !canFlash(now, m.at, fast)) return;
      centre();
      m.at = now;
      m.strength = 1;
    };
    window.addEventListener(BEAT_PREVIEW_EVENT, onPreview);
    return () => window.removeEventListener(BEAT_PREVIEW_EVENT, onPreview);
  }, []);

  // Nothing left half-painted when the effect is switched off or the style changes.
  useEffect(() => {
    memory.current.dark = true;
    paint(0, 0, 0.35);
    return () => paint(0, 0, 0.35);
  }, [o.style, plan.detect, o.reduceMotion]);

  useFrame((now) => {
    const m = memory.current;
    const { plan: p, song, lyrics, offsetMs, energy, fast } = latest.current;
    const open = windowOpen(song, now);
    const t = song.clock.now(now) + offsetMs;

    if (p.detect) {
      // A strong beat this frame: heard in the music if we can, otherwise estimated.
      const heard = open && readAudioLevels(scratch.current);
      const real = takeBeat(); // always taken, so an old beat can't fire later
      let beat = 0;
      if (open) beat = heard ? real : estimatedBeat(m.prevT, t, energy);
      m.prevT = t;
      if (beat > 0) {
        emitBeat(beat);
        // Every bass beat in the real sound glows anywhere in the song (harder beats brighter); the estimated rhythm
        // isn't the real beat, so it stays in the pauses.
        const here = (p.anywhere && heard) || p.flashIn === 'always' || (p.flashIn === 'pauses' && !!lyrics && shortPauseAt(lyrics.lines, t));
        if (here && canFlash(now, m.at, fast)) {
          centre();
          m.at = now;
          m.strength = beat;
        }
      }
    }

    const age = now - m.at;
    if (age >= FLASH_MS) {
      if (!m.dark) {
        m.dark = true;
        paint(0, 0, 0.35);
      }
      return;
    }
    m.dark = false;
    const shape = flashShape(age, m.strength);
    paint(shape.glow, shape.ring, shape.ringScale);
  });

  return plan;
}
