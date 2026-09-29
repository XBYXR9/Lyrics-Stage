// A smooth song-position clock.
//
// Spotify only tells us the song position every second or so. Between updates
// we keep counting locally, and when a new update disagrees a little we "slew"
// (gently speed up / slow down) instead of jumping, so the lyric animation never
// stutters. Big differences (a seek) jump immediately.

export interface Clock {
  /** Current song position in ms. */
  now(at?: number): number;
  readonly playing: boolean;
}

const HARD_JUMP_MS = 700;

export class PlaybackClock implements Clock {
  private anchorPos = 0;
  private anchorTime = 0;
  private slew = 0;
  private slewMs = 1;
  playing = false;
  durationMs = 0;

  now(at: number = performance.now()): number {
    const pos = this.raw(at);
    return this.durationMs > 0 ? Math.min(Math.max(pos, 0), this.durationMs) : Math.max(pos, 0);
  }

  /** Like now(), but can run past the end of the song (used to time song switches). */
  raw(at: number = performance.now()): number {
    let pos = this.anchorPos;
    if (this.playing) {
      const dt = Math.max(0, at - this.anchorTime);
      pos += dt + this.slew * Math.min(1, dt / this.slewMs);
    }
    return pos;
  }

  /** Jump straight to a position (new song, seek, play/pause). */
  set(positionMs: number, playing: boolean, measuredAt: number = performance.now(), durationMs?: number) {
    const t = performance.now();
    if (durationMs !== undefined) this.durationMs = durationMs;
    this.anchorPos = positionMs + (playing ? Math.max(0, t - measuredAt) : 0);
    this.anchorTime = t;
    this.slew = 0;
    this.playing = playing;
  }

  /** Feed a position report. Small drifts are smoothed out, big ones jump. */
  sync(positionMs: number, playing: boolean, measuredAt: number = performance.now()) {
    const t = performance.now();
    const target = positionMs + (playing ? Math.max(0, t - measuredAt) : 0);
    const shown = this.now(t);
    const error = target - shown;
    if (playing !== this.playing || !playing || Math.abs(error) > HARD_JUMP_MS) {
      this.set(positionMs, playing, measuredAt);
      return;
    }
    this.anchorPos = shown;
    this.anchorTime = t;
    this.slew = error;
    // Correct over ~3x the error, between a quarter and a whole second.
    this.slewMs = Math.min(1000, Math.max(250, Math.abs(error) * 3));
  }

  /**
   * A copy that keeps running on its own. Used to let the previous song's
   * lyrics keep moving while they fade out during an Automix/crossfade blend.
   */
  fork(keepRunning: boolean): Clock {
    const copy = new PlaybackClock();
    copy.set(this.now(), keepRunning && this.playing, performance.now(), this.durationMs);
    return copy;
  }
}

/** A clock that is stuck at one position (used for paused ghosts & previews). */
export class FixedClock implements Clock {
  readonly playing = false;
  private pos: number;
  constructor(pos: number) {
    this.pos = pos;
  }
  now() {
    return this.pos;
  }
}
