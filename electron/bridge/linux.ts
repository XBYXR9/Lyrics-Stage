// Linux: reads the Spotify app through MPRIS, the standard media-player
// interface on the desktop session bus (D-Bus).
//
// Known Spotify limitation: its Linux app always reports position 0, so we
// send `positionMs: null` and the page counts time from the start of each
// song. If a player ever reports a real position, we switch to trusting it.
import * as dbus from 'dbus-next';
import { MUSIC_APP_LABEL, type DesktopSnapshot, type DesktopTrack, type MusicApp } from '../../src/lib/desktopTypes';
import type { CommandReply, DesktopCommand, SpotifyBridge } from './types';

const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const NAME_RE = /^org\.mpris\.MediaPlayer2\.spotify/;
/** YouTube Music: its own app first, then a browser (any player that plays it shows up on the bus). */
const YOUTUBE_APP_RE = /^org\.mpris\.MediaPlayer2\.(youtube|youtube-music|youtubemusic|th-ch)/i;
const BROWSER_RE = /^org\.mpris\.MediaPlayer2\.(chromium|chrome|brave|vivaldi|opera|edge|msedge|firefox)/i;

/** Picks the player to follow among the names on the bus. Exported for tests. */
export function pickPlayerName(names: string[], app: MusicApp): string | null {
  if (app === 'spotify') return names.find((n) => NAME_RE.test(n)) ?? null;
  if (app === 'youtube') return names.find((n) => YOUTUBE_APP_RE.test(n)) ?? names.find((n) => BROWSER_RE.test(n)) ?? null;
  return null;
}

type VariantLike = { value: unknown } | undefined;

const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : Number(v) || 0);

/** Spotify's MPRIS track id ("/com/spotify/track/ID") or URL → "spotify:track:ID". */
export function mprisTrackUri(trackId: unknown, url: unknown): string | null {
  const fromId = typeof trackId === 'string' ? /\/com\/spotify\/track\/([A-Za-z0-9]+)$|^spotify:track:([A-Za-z0-9]+)$/.exec(trackId) : null;
  const id = fromId?.[1] ?? fromId?.[2] ?? (typeof url === 'string' ? /open\.spotify\.com\/track\/([A-Za-z0-9]+)/.exec(url)?.[1] : undefined);
  return id ? `spotify:track:${id}` : null;
}

/** Spotify sometimes reports covers on open.spotify.com; the i.scdn.co copy allows reading colors. */
export function normalizeArtUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  return url.replace(/^https?:\/\/open\.spotify\.com\/image\//, 'https://i.scdn.co/image/');
}

export interface MprisState {
  playing: boolean;
  /** 0–100, or null when the player doesn't say. */
  volume: number | null;
  track: DesktopTrack | null;
  /** Raw MPRIS track id (needed to seek). */
  trackId: string | null;
  positionMs: number;
}

/** Reads the result of Properties.GetAll("org.mpris.MediaPlayer2.Player"). Exported for tests. */
export function parseMpris(all: Record<string, VariantLike>): MprisState {
  const md = (all.Metadata?.value ?? {}) as Record<string, VariantLike>;
  const title = typeof md['xesam:title']?.value === 'string' ? (md['xesam:title']!.value as string) : '';
  const artists = md['xesam:artist']?.value;
  const trackId = typeof md['mpris:trackid']?.value === 'string' ? (md['mpris:trackid']!.value as string) : null;
  const volume = all.Volume?.value;
  return {
    playing: all.PlaybackStatus?.value === 'Playing',
    volume: typeof volume === 'number' && Number.isFinite(volume) ? Math.round(Math.min(1, Math.max(0, volume)) * 100) : null,
    trackId,
    positionMs: num(all.Position?.value) / 1000,
    track: title
      ? {
          uri: mprisTrackUri(trackId, md['xesam:url']?.value),
          title,
          artist: Array.isArray(artists) ? artists.join(', ') : String(artists ?? ''),
          album: String(md['xesam:album']?.value ?? ''),
          durationMs: num(md['mpris:length']?.value) / 1000,
          artUrl: normalizeArtUrl(md['mpris:artUrl']?.value),
        }
      : null,
  };
}

export class LinuxBridge implements SpotifyBridge {
  constructor(private readonly app: MusicApp = 'spotify') {}
  private bus: dbus.MessageBus | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private name: string | null = null;
  private player: dbus.ClientInterface | null = null;
  private props: dbus.ClientInterface | null = null;
  private lastTrackId: string | null = null;
  /** Spotify's Linux app always says 0; flips to true if a real position ever shows up. */
  private positionWorks = false;

  start(onSnapshot: (s: DesktopSnapshot) => void) {
    const tick = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        onSnapshot(await this.read());
      } finally {
        this.busy = false;
      }
    };
    void tick();
    this.timer = setInterval(tick, 400);
  }

  stop() {
    clearInterval(this.timer);
    this.bus?.disconnect();
    this.bus = null;
  }

  private base(): DesktopSnapshot {
    return { source: 'mpris', running: false, playing: false, track: null, positionMs: null, at: Date.now(), canSeek: true };
  }

  private getBus(): dbus.MessageBus {
    if (!this.bus) {
      const bus = dbus.sessionBus();
      bus.on('error', () => this.reset(true));
      this.bus = bus;
    }
    return this.bus;
  }

  private reset(dropBus = false) {
    this.name = null;
    this.player = null;
    this.props = null;
    if (dropBus) {
      try {
        this.bus?.disconnect();
      } catch {
        /* ignore */
      }
      this.bus = null;
    }
  }

  /** Finds Spotify on the session bus (it can come and go). */
  private async connect(): Promise<boolean> {
    const bus = this.getBus();
    const dbusObj = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
    const names: string[] = await dbusObj.getInterface('org.freedesktop.DBus').ListNames();
    const name = pickPlayerName(names, this.app);
    if (!name) {
      this.reset();
      return false;
    }
    if (name !== this.name || !this.player || !this.props) {
      const obj = await bus.getProxyObject(name, MPRIS_PATH);
      this.player = obj.getInterface(PLAYER_IFACE);
      this.props = obj.getInterface('org.freedesktop.DBus.Properties');
      this.name = name;
    }
    return true;
  }

  private async read(): Promise<DesktopSnapshot> {
    if (this.app === 'apple') return { ...this.base(), problem: 'Apple Music doesn’t have an app for Linux. Choose Spotify or YouTube Music in Settings.' };
    try {
      if (!(await this.connect())) return this.base();
      const all = (await this.props!.GetAll(PLAYER_IFACE)) as Record<string, VariantLike>;
      const at = Date.now();
      const state = parseMpris(all);
      this.lastTrackId = state.trackId;
      if (state.positionMs > 0) this.positionWorks = true;
      return {
        ...this.base(),
        running: true,
        playing: state.playing,
        track: state.track,
        positionMs: this.positionWorks ? state.positionMs : null,
        volume: state.volume,
        at,
      };
    } catch (err) {
      this.reset(/connect|ENOENT|ECONNREFUSED|closed/i.test(String(err)));
      const noBus = !process.env.DBUS_SESSION_BUS_ADDRESS && !process.env.XDG_RUNTIME_DIR;
      return { ...this.base(), problem: noBus ? `Can’t reach the desktop session (D-Bus) to find ${MUSIC_APP_LABEL[this.app]}.` : undefined };
    }
  }

  async command(c: DesktopCommand): Promise<CommandReply | void> {
    if (!(await this.connect().catch(() => false)) || !this.player) {
      throw new Error(`${MUSIC_APP_LABEL[this.app]} didn’t respond. Is it open?`);
    }
    const p = this.player;
    switch (c.type) {
      case 'playpause':
        return p.PlayPause();
      case 'play':
        return p.Play();
      case 'pause':
        return p.Pause();
      case 'next':
        return p.Next();
      case 'previous':
        return p.Previous();
      case 'seek': {
        // MPRIS ignores a seek for any track but the current one, so re-read it (it may have just changed).
        const now = parseMpris((await this.props!.GetAll(PLAYER_IFACE)) as Record<string, VariantLike>);
        const trackId = now.trackId ?? this.lastTrackId;
        if (!trackId) throw new Error('Nothing is playing.');
        return p.SetPosition(trackId, BigInt(Math.round(c.positionMs * 1000)));
      }
      case 'openUri':
        return p.OpenUri(c.uri);
      case 'volume': {
        // Some Spotify versions don't report (or ignore) the volume over MPRIS, so read back what really happened.
        const read = async () => parseMpris((await this.props!.GetAll(PLAYER_IFACE)) as Record<string, VariantLike>).volume;
        const target = Math.min(100, Math.max(0, ((await read()) ?? 50) + c.delta));
        await this.props!.Set(PLAYER_IFACE, 'Volume', new dbus.Variant('d', target / 100));
        const volume = await read();
        return volume === null ? {} : { volume };
      }
    }
  }
}
