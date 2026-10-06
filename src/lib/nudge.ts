// A temporary timing nudge for the song that is playing (keys , and .). It
// doesn't touch Spotify: only when the lyrics show. It resets with the next song, unless "Remember for each song" is on
// (see songMemory.ts), when it comes back the next time that song plays.

/** The most a song can be nudged either way. */
export const MAX_NUDGE_MS = 30_000;

/** `ms` moved by `deltaMs` (positive = lyrics earlier), kept within ±30 s. */
export const nudgeBy = (ms: number, deltaMs: number) => Math.max(-MAX_NUDGE_MS, Math.min(MAX_NUDGE_MS, Math.round(ms + deltaMs)));

/** In words: "lyrics 2.5 s later than before", or "timing back to normal". */
export function describeNudge(ms: number): string {
  if (ms === 0) return 'Lyrics timing back to normal for this song';
  return `This song: lyrics ${(Math.abs(ms) / 1000).toFixed(1)}s ${ms > 0 ? 'earlier' : 'later'}`;
}
