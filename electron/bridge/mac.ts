// macOS: talks to the Spotify app through AppleScript, which Spotify supports
// officially. We run one small JavaScript-for-Automation (JXA) loop that
// prints the player state 4 times a second; commands are separate
// one-line AppleScripts.
//
// The first time, macOS asks: "Lyrics Stage wants to control Spotify". The
// user has to allow it (System Settings → Privacy & Security → Automation).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MUSIC_APP_LABEL, type DesktopSnapshot, type MusicApp } from '../../src/lib/desktopTypes';
import { JsonLineProcess } from './child';
import type { CommandReply, DesktopCommand, SpotifyBridge } from './types';

const run = promisify(execFile);

export const JXA_LOOP = String.raw`
ObjC.import('Foundation');
const out = $.NSFileHandle.fileHandleWithStandardOutput;
function emit(o) { out.writeData($(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
let sp = null;
while (true) {
  if (!sp) {
    try { sp = Application('Spotify'); } catch (e) { emit({ installed: false, at: Date.now() }); delay(5); continue; }
  }
  try {
    if (!sp.running()) { emit({ running: false, at: Date.now() }); delay(1); continue; }
    const snap = { running: true, state: String(sp.playerState()), track: null, position: null, at: 0 };
    try {
      const t = sp.currentTrack;
      const id = t.id();
      if (id) snap.track = { id: id, name: t.name(), artist: t.artist(), album: t.album(), duration: t.duration(), artwork: null };
      // Some songs (local files, older Spotify versions) have no cover URL; that mustn't hide the song.
      if (snap.track) { try { snap.track.artwork = t.artworkUrl(); } catch (e) {} }
    } catch (e) {}
    try { snap.position = sp.playerPosition(); } catch (e) {}
    try { snap.volume = sp.soundVolume(); } catch (e) {}
    snap.at = Date.now();
    emit(snap);
  } catch (e) {
    emit({ error: String(e), at: Date.now() });
    delay(2);
    continue;
  }
  delay(0.25);
}
`;

/** The same loop for the Music app (Apple Music): no song id or cover link, and the length is in seconds. */
export const JXA_LOOP_MUSIC = String.raw`
ObjC.import('Foundation');
const out = $.NSFileHandle.fileHandleWithStandardOutput;
function emit(o) { out.writeData($(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
let mu = null;
while (true) {
  if (!mu) {
    try { mu = Application('Music'); } catch (e) { emit({ installed: false, at: Date.now() }); delay(5); continue; }
  }
  try {
    if (!mu.running()) { emit({ running: false, at: Date.now() }); delay(1); continue; }
    const snap = { running: true, state: String(mu.playerState()), track: null, position: null, at: 0 };
    try {
      const t = mu.currentTrack;
      const name = t.name();
      if (name) snap.track = { id: null, name: name, artist: t.artist(), album: t.album(), duration: t.duration() * 1000, artwork: null };
    } catch (e) {}
    try { snap.position = mu.playerPosition(); } catch (e) {}
    try { snap.volume = mu.soundVolume(); } catch (e) {}
    snap.at = Date.now();
    emit(snap);
  } catch (e) {
    emit({ error: String(e), at: Date.now() });
    delay(2);
    continue;
  }
  delay(0.25);
}
`;

/** The name of the app in AppleScript. */
const scriptName = (app: MusicApp) => (app === 'apple' ? 'Music' : 'Spotify');

const permissionHelp = (app: MusicApp) =>
  `Allow Lyrics Stage to control ${MUSIC_APP_LABEL[app]}: open System Settings → Privacy & Security → Automation, and turn on ${scriptName(app)} under Lyrics Stage.`;

/** Turns one line from the JXA loop into a snapshot. Exported for tests. */
export function parseMacLine(raw: unknown, app: MusicApp = 'spotify'): DesktopSnapshot {
  const o = (raw ?? {}) as Record<string, unknown>;
  const base: DesktopSnapshot = {
    source: 'applescript',
    running: false,
    playing: false,
    track: null,
    positionMs: null,
    at: typeof o.at === 'number' ? o.at : Date.now(),
    canSeek: true,
  };
  if (o.installed === false) {
    return {
      ...base,
      problem: app === 'apple' ? 'The Music app isn’t available on this Mac.' : 'Spotify isn’t installed. Get it from spotify.com/download.',
    };
  }
  if (typeof o.error === 'string') {
    return /-1743|not authori[sz]ed/i.test(o.error) ? { ...base, running: true, problem: permissionHelp(app) } : base;
  }
  if (o.running !== true) return base;
  const t = o.track as Record<string, unknown> | null;
  return {
    ...base,
    running: true,
    playing: o.state === 'playing',
    track: t
      ? {
          uri: typeof t.id === 'string' ? t.id : null,
          title: String(t.name ?? ''),
          artist: String(t.artist ?? ''),
          album: String(t.album ?? ''),
          durationMs: Number(t.duration) || 0,
          artUrl: typeof t.artwork === 'string' && t.artwork ? t.artwork : null,
        }
      : null,
    positionMs: typeof o.position === 'number' ? Math.max(0, o.position * 1000) : null,
    volume: typeof o.volume === 'number' ? Math.round(o.volume) : null,
  };
}

/** The AppleScript for one command. Exported for tests. */
export function macCommandScript(c: DesktopCommand, app: MusicApp = 'spotify'): string {
  const name = scriptName(app);
  const tell = (what: string) => `tell application "${name}" to ${what}`;
  switch (c.type) {
    case 'playpause':
      return tell('playpause');
    case 'play':
      return tell('play');
    case 'pause':
      return tell('pause');
    case 'next':
      return tell('next track');
    case 'previous':
      return tell('previous track');
    case 'seek':
      return tell(`set player position to ${(c.positionMs / 1000).toFixed(3)}`);
    case 'openUri':
      // The URI is validated (letters and digits only) before it gets here. Only Spotify takes one.
      return tell(`play track "${c.uri}"`);
    case 'volume':
      // Spotify's own volume (0–100); prints the new level. `delta` is a whole number (validated).
      return [
        `tell application "${name}"`,
        `  set v to (sound volume) + (${Math.round(c.delta)})`,
        '  if v > 100 then set v to 100',
        '  if v < 0 then set v to 0',
        '  set sound volume to v',
        '  return v',
        'end tell',
      ].join('\n');
  }
}

export class MacBridge implements SpotifyBridge {
  private loop: JsonLineProcess | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly app: MusicApp = 'spotify') {}

  start(onSnapshot: (s: DesktopSnapshot) => void) {
    if (this.app === 'youtube') {
      // A browser or the YouTube Music app can't be asked what is playing through AppleScript.
      const say = () =>
        onSnapshot({
          source: 'applescript',
          running: false,
          playing: false,
          track: null,
          positionMs: null,
          at: Date.now(),
          canSeek: false,
          problem: 'YouTube Music can’t be followed on a Mac yet. Choose Spotify or Apple Music in Settings.',
        });
      say();
      this.timer = setInterval(say, 2000);
      return;
    }
    const script = this.app === 'apple' ? JXA_LOOP_MUSIC : JXA_LOOP;
    this.loop = new JsonLineProcess('osascript', ['-l', 'JavaScript', '-e', script], (o) => onSnapshot(parseMacLine(o, this.app)));
    this.loop.start();
  }

  stop() {
    this.loop?.stop();
    clearInterval(this.timer);
  }

  async command(c: DesktopCommand): Promise<CommandReply | void> {
    if (this.app === 'youtube') throw new Error('YouTube Music can’t be controlled from here on a Mac.');
    if (c.type === 'openUri' && this.app !== 'spotify') throw new Error(`Open songs from ${MUSIC_APP_LABEL[this.app]} itself.`);
    try {
      const { stdout } = await run('osascript', ['-e', macCommandScript(c, this.app)], { timeout: 5000 });
      if (c.type === 'volume') {
        const volume = Number(String(stdout).trim());
        return Number.isFinite(volume) ? { volume } : {};
      }
    } catch (err) {
      const msg = String((err as { stderr?: string }).stderr || err);
      throw new Error(/-1743|not authori[sz]ed/i.test(msg) ? permissionHelp(this.app) : `${MUSIC_APP_LABEL[this.app]} didn’t respond. Is the app open?`);
    }
  }
}
