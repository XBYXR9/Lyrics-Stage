// A pretend Spotify app for Linux development and tests.
//
// It appears on the D-Bus session bus exactly like Spotify's Linux app
// (org.mpris.MediaPlayer2.spotify) — including Spotify's quirk of always
// reporting position 0 — and plays through a short list of real songs, so the
// desktop app can be tried without Spotify:
//
//   node scripts/fake-spotify.mjs            # in one terminal
//   npm run app:dev                          # in another
//
// Songs switch 6 s before they "end", like an Automix/Crossfade blend. Seek
// near the end of a song (click the progress bar) to see a blend quickly.
import dbus from 'dbus-next';

const { Interface } = dbus.interface;
const { Variant } = dbus;

const SONGS = [
  { id: '3AJwUDP919kvQ9QcozQPxg', title: 'Yellow', artists: ['Coldplay'], album: 'Parachutes', ms: 266773 },
  { id: '0VjIjW4GlUZAMYd2vXMi3b', title: 'Blinding Lights', artists: ['The Weeknd'], album: 'After Hours', ms: 200040 },
  { id: '1dGr1c8CrMLDpV6mPbImSI', title: 'Lover', artists: ['Taylor Swift'], album: 'Lover', ms: 221306 },
];
const BLEND_MS = 6000;

class Player extends Interface {
  constructor() {
    super('org.mpris.MediaPlayer2.Player');
    this.index = 0;
    this.playing = true;
    this.startedAt = Date.now();
    this.pausedAt = 0;
    this.log = [];
  }
  get song() {
    return SONGS[this.index];
  }
  get PlaybackStatus() {
    return this.playing ? 'Playing' : 'Paused';
  }
  get Metadata() {
    const s = this.song;
    return {
      'mpris:trackid': new Variant('o', `/com/spotify/track/${s.id}`),
      'mpris:length': new Variant('t', BigInt(s.ms * 1000)),
      'mpris:artUrl': new Variant('s', ''),
      'xesam:title': new Variant('s', s.title),
      'xesam:artist': new Variant('as', s.artists),
      'xesam:album': new Variant('s', s.album),
      'xesam:url': new Variant('s', `https://open.spotify.com/track/${s.id}`),
    };
  }
  // Like the real Spotify Linux app: position is always 0.
  get Position() {
    return BigInt(0);
  }
  PlayPause() {
    this.log.push('PlayPause');
    if (this.playing) this.pausedAt = Date.now();
    else this.startedAt += Date.now() - this.pausedAt;
    this.playing = !this.playing;
  }
  Play() {
    if (!this.playing) this.PlayPause();
  }
  Pause() {
    if (this.playing) this.PlayPause();
  }
  Next() {
    this.log.push('Next');
    this.index = (this.index + 1) % SONGS.length;
    this.startedAt = Date.now();
  }
  Previous() {
    this.log.push('Previous');
    this.index = (this.index - 1 + SONGS.length) % SONGS.length;
    this.startedAt = Date.now();
  }
  SetPosition(trackId, position) {
    this.log.push(`SetPosition ${trackId} ${position}`);
    if (trackId === `/com/spotify/track/${this.song.id}`) this.startedAt = Date.now() - Number(position) / 1000;
  }
  OpenUri(uri) {
    this.log.push(`OpenUri ${uri}`);
  }
  tick() {
    if (this.playing && Date.now() - this.startedAt >= this.song.ms - BLEND_MS) this.Next();
  }
}

Player.configureMembers({
  properties: {
    PlaybackStatus: { signature: 's', access: 'read' },
    Metadata: { signature: 'a{sv}', access: 'read' },
    Position: { signature: 'x', access: 'read' },
  },
  methods: {
    PlayPause: {},
    Play: {},
    Pause: {},
    Next: {},
    Previous: {},
    SetPosition: { inSignature: 'ox' },
    OpenUri: { inSignature: 's' },
  },
});

const bus = dbus.sessionBus();
const player = new Player();
bus.export('/org/mpris/MediaPlayer2', player);
await bus.requestName('org.mpris.MediaPlayer2.spotify', 0);
setInterval(() => player.tick(), 200);
process.on('SIGUSR2', () => console.log(JSON.stringify(player.log)));
console.log(`Fake Spotify is playing "${player.song.title}" on the session bus.`);
