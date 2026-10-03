// Is the Spotify app on this computer the one playing the song? (Desktop app, signed in to Spotify.)
//
// If it is, pausing and resuming it through the operating system is much quicker than asking Spotify's
// servers, which then ask the player: the gap in the music is a fraction of a second shorter.

/** The little we keep of what the Spotify app on this computer last reported. */
export interface LocalSnapshot {
  uri: string | null;
  playing: boolean;
  running: boolean;
  /** When it was taken (epoch ms). */
  at: number;
}

/** A report older than this might be about something else by now. */
const FRESH_MS = 3000;

/**
 * True when the Spotify app on this computer has just reported that it is playing exactly this song, so it is the
 * player (a phone or speaker playing the same song would leave this computer's app paused or on another song).
 */
export function localIsPlaying(snap: LocalSnapshot | null, trackUri: string, nowMs: number): boolean {
  if (!snap || !snap.running || !snap.playing || !snap.uri) return false;
  return snap.uri === trackUri && nowMs - snap.at >= 0 && nowMs - snap.at <= FRESH_MS;
}
