// Demo mode: three made-up songs (original lyrics, no audio) that run on a
// fake clock. It lets you try every lyric style — and see an Automix-style
// blend — without connecting Spotify. It's also handy for development.

import { BaseEngine, clampVolume, type DeviceInfo, type Engine } from './engine';
import { buildSynced } from './lrc';
import { classifyTransition } from './transitions';
import type { Lyrics, TrackInfo, TransitionInfo } from './types';

interface DemoSong {
  track: TrackInfo;
  /** When set, the next song blends in at this position (like Automix). */
  automixAtMs?: number;
  /** Where the next song starts when blending in (Automix often skips intros). */
  nextStartMs?: number;
}

/**
 * Builds a word-timed line. Each word gets `beat` ms (a bit more for long
 * words); a trailing "~" on a word holds it (a sustained note).
 */
function sung(atSec: number, text: string, beat: number) {
  let t = atSec * 1000;
  const words = text.split(' ').map((raw, i, arr) => {
    const hold = raw.endsWith('~');
    const word = raw.replace(/~$/, '');
    const letters = word.replace(/[^\p{L}]/gu, '').length;
    const dur = hold ? beat * 4 : beat * (0.75 + Math.min(letters, 8) * 0.08);
    const w = { text: i < arr.length - 1 ? `${word} ` : word, start: Math.round(t), end: Math.round(t + dur) };
    t += dur;
    return w;
  });
  return { start: words[0].start, end: words[words.length - 1].end, text: words.map((w) => w.text).join(''), words };
}

/** A line with only a start time (word timing gets estimated, like most real songs). */
const line = (atSec: number, text: string) => ({ start: atSec * 1000, text });

function neonTideLyrics(): Lyrics {
  const b = 290;
  return buildSynced(
    [
      sung(4.0, 'City lights are calling out my name', b),
      sung(7.6, 'Running through the static of the rain', b),
      sung(11.2, 'Every heartbeat turning into gold', b),
      sung(14.8, "We're the stories that were never told~", b),
      sung(18.8, '(Oh-oh) Ride the neon tide', b + 60),
      sung(22.0, 'Nothing left to hide tonight~', b + 40),
      sung(25.8, '(Oh-oh) Ride the neon tide', b + 60),
      sung(29.0, 'Let the city be our guide~', b + 40),
      sung(33.0, 'Feel the bassline shaking up the floor', b),
      sung(36.6, 'Open every window, every door~', b),
      sung(47.0, 'Ride the neon tide', b + 80),
      sung(50.4, 'Ride the neon tide', b + 80),
      sung(53.8, "We don't need to say goodbye~", b + 20),
      sung(58.4, 'Ride the neon tide~', b + 100),
    ],
    'Demo (word-synced)',
    70000,
  );
}

function paperMoonLyrics(): Lyrics {
  return buildSynced(
    [
      line(6.0, 'Paper moon above the radio'),
      line(12.5, 'Humming songs that only we would know'),
      line(19.0, 'Hold the quiet like a candle glow'),
      line(25.5, 'يا قمر الليل، خليك معانا'),
      line(31.0, 'Stay a little longer, stay'),
      line(36.0, ''),
      line(46.0, 'Every word I never got to say'),
      line(52.5, 'Drifting softly on the airwaves home'),
      line(59.0, 'Paper moon, you never walk alone'),
      line(66.0, ''),
    ],
    'Demo (line-synced)',
    76000,
  );
}

function sidewalkLyrics(): Lyrics {
  return buildSynced(
    [
      line(2.0, 'Tick tock, sidewalk talk, beat drop, never stop'),
      line(4.6, "Pen on the pad and I'm jumping every block"),
      line(7.2, 'Quick step, no sweat, full tank, no regret'),
      line(9.8, 'Talking in rhythm is the only way I get'),
      line(12.4, 'Static on the sidewalk, crackle when I walk'),
      line(15.0, 'Every little heartbeat keeping up the clock'),
      line(17.6, 'Left right, day night, lights bright, hold tight'),
      line(20.2, 'Moving like a comet with the city in my sight'),
      line(22.8, ''),
      line(28.0, 'Static! (Static!) Turn it up, turn it up'),
      line(30.6, "Can't stop now 'cause we never get enough"),
      line(33.2, 'Static! (Static!) Every corner, every cup'),
      line(35.8, 'Raise the volume till the sun comes up'),
      line(38.4, 'Tick tock, sidewalk talk, beat drop, never stop'),
      line(41.0, "One more round and then we're going to the top"),
      line(43.6, ''),
    ],
    'Demo (line-synced)',
    52000,
  );
}

/** Draws a simple generated album cover. */
function cover(draw: (ctx: CanvasRenderingContext2D, s: number) => void): string {
  const s = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, s);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function makeSongs(): DemoSong[] {
  const neon = cover((ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#0b0630');
    g.addColorStop(1, '#1a0b4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = i % 2 ? '#ff2bd6' : '#20e3ff';
      ctx.lineWidth = 10;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.moveTo(0, 300 + i * 26);
      ctx.bezierCurveTo(s * 0.3, 250 + i * 30, s * 0.6, 360 + i * 22, s, 290 + i * 28);
      ctx.stroke();
    }
    ctx.shadowBlur = 50;
    ctx.fillStyle = '#ff5cf0';
    ctx.beginPath();
    ctx.arc(s * 0.68, s * 0.3, 70, 0, Math.PI * 2);
    ctx.fill();
  });
  const moon = cover((ctx, s) => {
    const g = ctx.createRadialGradient(s * 0.5, s * 0.35, 20, s * 0.5, s * 0.5, s * 0.8);
    g.addColorStop(0, '#f6e7c8');
    g.addColorStop(0.5, '#e0a96d');
    g.addColorStop(1, '#6b3b2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#fff8ea';
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.38, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8b27a';
    ctx.beginPath();
    ctx.arc(s * 0.56, s * 0.34, 100, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3d2419';
    ctx.fillRect(s * 0.3, s * 0.72, s * 0.4, s * 0.14);
  });
  const street = cover((ctx, s) => {
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#ff3b1f';
    for (let i = 0; i < 7; i++) ctx.fillRect(i * 80 - 20, 0, 36, s);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 150px Impact, Anton, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ST4T1C', s / 2, s * 0.62);
  });

  const loop = cover((ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#04281f');
    g.addColorStop(1, '#0b6b5c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#7dffd9';
    ctx.lineWidth = 8;
    for (let i = 1; i < 6; i++) {
      ctx.globalAlpha = 1 - i * 0.15;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, i * 62, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8fff8';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 38, 0, Math.PI * 2);
    ctx.fill();
  });

  const make = (key: string, name: string, artist: string, album: string, art: string, lyrics: Lyrics, durationMs: number): TrackInfo => ({
    key: `demo:${key}`,
    id: null,
    uri: `demo:${key}`,
    name,
    artists: [artist],
    album,
    artUrl: art,
    artThumbUrl: art,
    durationMs,
    localLyrics: lyrics,
  });

  return [
    {
      track: make('neon', 'Neon Tide', 'The Demo Lights', 'Afterglow Avenue', neon, neonTideLyrics(), 70000),
      automixAtMs: 63500,
      nextStartMs: 2500,
    },
    { track: make('moon', 'Paper Moon Radio', 'Lua & the Static', 'Night Frequencies', moon, paperMoonLyrics(), 76000) },
    {
      track: make('street', 'Sidewalk Static', 'MC Placeholder', 'Loop City', street, sidewalkLyrics(), 52000),
      automixAtMs: 46000,
      nextStartMs: 1500,
    },
    // No words at all: shows the beat scene.
    {
      track: make('loop', 'Midnight Loop', 'Synthetic Sleep', 'Instrumentals', loop, { kind: 'instrumental', lines: [], wordSynced: false, source: 'demo' }, 64000),
    },
  ];
}

export class DemoEngine extends BaseEngine implements Engine {
  readonly kind = 'demo';
  readonly isDemo = true;
  readonly searchMode = 'results';
  readonly canPlayHere = true;
  private songs: DemoSong[] = [];
  private index = 0;
  private queued: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;

  start() {
    if (this.timer) return;
    if (!this.songs.length) this.songs = makeSongs();
    if (!this.state.track) this.switchTo(0, 0, { kind: 'initial', overlapMs: 0, startOffsetMs: 0 }, true);
    this.update({
      device: { id: 'demo', name: 'Demo (no sound)', type: 'Computer', isActive: true, isThisBrowser: true },
      browserPlayer: { status: 'ready', deviceId: 'demo' },
    });
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 200);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private nextIndex() {
    return this.queued ?? (this.index + 1) % this.songs.length;
  }

  private tick() {
    const now = performance.now();
    const since = now - this.lastTick;
    this.lastTick = now;
    if (!this.clock.playing) return;
    const song = this.songs[this.index];
    const pos = this.clock.raw(now);
    if (song.automixAtMs && pos >= song.automixAtMs) {
      this.handOver(song.nextStartMs ?? 0, since);
    } else if (pos >= song.track.durationMs) {
      this.handOver(0, since);
    }
  }

  /** Move to the next song and classify the hand-over just like the real engine does. */
  private handOver(startMs: number, sinceLastReportMs: number) {
    const prev = this.songs[this.index].track;
    const transition = classifyTransition({
      prevDurationMs: prev.durationMs,
      prevPositionMs: this.clock.raw(),
      newPositionMs: startMs + sinceLastReportMs / 2,
      sinceLastReportMs,
      wasPlaying: this.clock.playing,
    });
    this.switchTo(this.nextIndex(), startMs, transition, this.clock.playing);
  }

  private switchTo(i: number, positionMs: number, transition: TransitionInfo, playing: boolean) {
    const prev = this.state.track;
    const ghost = prev ? this.clock.fork(transition.kind === 'blend') : null;
    this.index = i;
    this.queued = null;
    const song = this.songs[i];
    this.clock.set(positionMs, playing, performance.now(), song.track.durationMs);
    const typical = transition.kind === 'blend' ? transition.overlapMs : this.state.typicalBlendMs;
    this.update({
      track: song.track,
      status: playing ? 'playing' : 'paused',
      isPlaying: playing,
      nextTrack: this.songs[this.nextIndex()].track,
      typicalBlendMs: typical,
      change: { seq: this.state.change.seq + 1, track: song.track, previous: prev, transition, ghost },
    });
  }

  async togglePlay() {
    const playing = !this.clock.playing;
    this.clock.set(this.clock.now(), playing);
    this.update({ isPlaying: playing, status: playing ? 'playing' : 'paused' });
  }

  async next() {
    this.switchTo(this.nextIndex(), 0, { kind: 'skip', overlapMs: 0, startOffsetMs: 0 }, this.clock.playing);
  }

  async previous() {
    if (this.clock.now() > 3000) {
      this.clock.set(0, this.clock.playing);
      return;
    }
    const i = (this.index - 1 + this.songs.length) % this.songs.length;
    this.switchTo(i, 0, { kind: 'skip', overlapMs: 0, startOffsetMs: 0 }, this.clock.playing);
  }

  async seek(positionMs: number) {
    this.clock.set(positionMs, this.clock.playing);
  }

  async playTrack(uri: string) {
    const i = this.songs.findIndex((s) => s.track.uri === uri);
    if (i >= 0) this.switchTo(i, 0, { kind: 'skip', overlapMs: 0, startOffsetMs: 0 }, true);
  }

  async addToQueue(uri: string) {
    const i = this.songs.findIndex((s) => s.track.uri === uri);
    if (i >= 0) {
      this.queued = i;
      this.update({ nextTrack: this.songs[i].track });
    }
  }

  async search(query: string): Promise<TrackInfo[]> {
    const q = query.trim().toLowerCase();
    return this.songs
      .map((s) => s.track)
      .filter((t) => !q || `${t.name} ${t.artists.join(' ')} ${t.album}`.toLowerCase().includes(q));
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return this.state.device ? [this.state.device] : [];
  }

  async transferTo() {}

  /** The demo has no sound, but the buttons should still respond. */
  async changeVolume(delta: number) {
    this.update({ volume: clampVolume((this.state.volume ?? 70) + delta) });
  }

  async enableBrowserPlayer() {}
}
