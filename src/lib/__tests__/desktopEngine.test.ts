import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopEngine } from '../desktopEngine';
import type { DesktopCommand, DesktopSnapshot, LyricsStageDesktopApi } from '../desktopTypes';
import { BlendBiasLearner } from '../blendBias';
import { clearTimingLog, timingReport } from '../timingLog';

function fakeApi() {
  const sent: DesktopCommand[] = [];
  let listener: ((s: DesktopSnapshot) => void) | null = null;
  const api: LyricsStageDesktopApi = {
    isDesktop: true,
    platform: 'linux',
    version: 'test',
    onSnapshot: (cb) => {
      listener = cb;
      return () => (listener = null);
    },
    command: async (c) => {
      sent.push(c);
      return { ok: true };
    },
    openSpotify: vi.fn(async () => {}),
    openMusicApp: vi.fn(async () => {}),
    setMusicApp: async () => {},
    setAlwaysOnTop: async () => {},
    setSoundSource: async () => {},
    onUpdate: () => () => {},
    installUpdate: async () => {},
    signInWithSpotify: async () => ({ error: 'cancelled' }),
    cancelSpotifyLogin: async () => {},
  };
  return { api, sent, emit: (s: DesktopSnapshot) => listener?.(s) };
}

const track = (title: string, durationMs = 200_000) => ({
  uri: `spotify:track:${title.replace(/\W/g, '')}123456`,
  title,
  artist: 'Artist',
  album: 'Album',
  durationMs,
  artUrl: null,
});

describe('DesktopEngine', () => {
  let now = 0;
  beforeEach(() => {
    now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000_000 + now);
  });
  afterEach(() => vi.restoreAllMocks());

  const snap = (over: Partial<DesktopSnapshot>): DesktopSnapshot => ({
    source: 'applescript',
    running: true,
    playing: true,
    track: track('Song A'),
    positionMs: 0,
    at: Date.now(),
    canSeek: true,
    ...over,
  });

  it('follows the Spotify app and detects an Automix blend', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ positionMs: 190_000 }));
    expect(engine.getState().track?.name).toBe('Song A');
    expect(engine.getState().change.transition.kind).toBe('initial');
    // 4 s later Spotify switches, with ~6 s of Song A still left and Song B starting 8 s in (Automix intro skip).
    now += 4000;
    emit(snap({ positionMs: 194_000 }));
    now += 250;
    emit(snap({ track: track('Song B'), positionMs: 8_000 }));
    const { change } = engine.getState();
    expect(change.track?.name).toBe('Song B');
    expect(change.transition.kind).toBe('blend');
    expect(engine.getState().spotifyApp).toEqual({ running: true, problem: undefined, exactPosition: true });
    engine.stop();
  });

  it('counts time itself when the Spotify app gives no position (Linux)', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ source: 'mpris', positionMs: null }));
    now += 3000;
    emit(snap({ source: 'mpris', positionMs: null }));
    expect(engine.clock.now()).toBe(3000);
    expect(engine.getState().spotifyApp?.exactPosition).toBe(false);
    // Paused in Spotify → our clock stops too.
    emit(snap({ source: 'mpris', positionMs: null, playing: false }));
    now += 5000;
    expect(engine.clock.now()).toBe(3000);
  });

  it('keeps the last song paused when Spotify closes', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ positionMs: 1000 }));
    emit(snap({ running: false, track: null, positionMs: null }));
    expect(engine.getState().track?.name).toBe('Song A');
    expect(engine.getState().status).toBe('paused');
    expect(engine.getState().spotifyApp?.running).toBe(false);
  });

  it('sends controls to the Spotify app and opens Spotify search', async () => {
    const { api, sent, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ positionMs: 1000 }));
    await engine.togglePlay();
    await engine.next();
    await engine.seek(42_000);
    expect(sent).toEqual([{ type: 'playpause' }, { type: 'next' }, { type: 'seek', positionMs: 42_000 }]);
    expect(engine.clock.now()).toBe(42_000);
    await engine.search('yellow');
    expect(api.openSpotify).toHaveBeenCalledWith('yellow');
    await expect(engine.addToQueue()).rejects.toThrow(/Spotify app/);
  });

  it('shows a cover that arrives a moment after the song change (Windows)', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api, async () => null);
    engine.start();
    emit(snap({ positionMs: 1000 }));
    expect(engine.getState().track?.artUrl).toBeNull();
    emit(snap({ positionMs: 1250, track: { ...track('Song A'), artUrl: 'data:image/jpeg;base64,AAA' } }));
    expect(engine.getState().track?.artUrl).toBe('data:image/jpeg;base64,AAA');
    expect(engine.getState().track?.name).toBe('Song A');
    expect(engine.getState().change.seq).toBe(1); // still the same song, no transition
  });

  it('updates the song length when it arrives after the title (Windows)', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api, async () => null);
    engine.start();
    emit(snap({ positionMs: 0, track: track('Song A', 0) }));
    expect(engine.getState().track?.durationMs).toBe(0);
    emit(snap({ positionMs: 250, track: track('Song A', 185_000) }));
    expect(engine.getState().track?.durationMs).toBe(185_000);
    expect(engine.getState().change.seq).toBe(1);
  });

  it('looks up a cover when the player gives none, once per song', async () => {
    const { api, emit } = fakeApi();
    const finder = vi.fn(async () => 'https://covers.example/a.jpg');
    const engine = new DesktopEngine(api, finder);
    engine.start();
    emit(snap({ positionMs: 1000 }));
    emit(snap({ positionMs: 1250 }));
    await vi.waitFor(() => expect(engine.getState().track?.artUrl).toBe('https://covers.example/a.jpg'));
    emit(snap({ positionMs: 1500 }));
    expect(finder).toHaveBeenCalledTimes(1);
    expect(finder).toHaveBeenCalledWith({ name: 'Song A', artists: ['Artist'], album: 'Album' });
    // The player's own cover still wins if it shows up later.
    emit(snap({ positionMs: 1750, track: { ...track('Song A'), artUrl: 'data:image/png;base64,BBB' } }));
    expect(engine.getState().track?.artUrl).toBe('data:image/png;base64,BBB');
  });

  it("looks up a cover when the player's picture doesn't load", async () => {
    const { api, emit } = fakeApi();
    const finder = vi.fn(async () => 'https://covers.example/a.jpg');
    const engine = new DesktopEngine(api, finder);
    engine.start();
    const broken = 'data:image/jpeg;base64,BROKEN';
    emit(snap({ positionMs: 1000, track: { ...track('Song A'), artUrl: broken } }));
    expect(finder).not.toHaveBeenCalled();
    engine.coverFailed(broken);
    await vi.waitFor(() => expect(engine.getState().track?.artUrl).toBe('https://covers.example/a.jpg'));
    // The player keeps sending the broken picture: it stays replaced.
    emit(snap({ positionMs: 1250, track: { ...track('Song A'), artUrl: broken } }));
    expect(engine.getState().track?.artUrl).toBe('https://covers.example/a.jpg');
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('changes the volume and shows the level Spotify reports', async () => {
    const { api, emit, sent } = fakeApi();
    api.command = async (c) => {
      sent.push(c);
      return { ok: true, volume: 40 };
    };
    const engine = new DesktopEngine(api, async () => null);
    engine.start();
    emit(snap({ volume: 50 }));
    expect(engine.getState().volume).toBe(50);
    await engine.changeVolume(-10);
    expect(sent).toContainEqual({ type: 'volume', delta: -10 });
    expect(engine.getState().volume).toBe(40);
    // A late snapshot with the old level doesn't undo the change.
    emit(snap({ volume: 50, positionMs: 250 }));
    expect(engine.getState().volume).toBe(40);
  });

  it('turns failed commands into errors', async () => {
    const { api } = fakeApi();
    api.command = async () => ({ ok: false, error: 'Nope' });
    const engine = new DesktopEngine(api);
    await expect(engine.next()).rejects.toThrow('Nope');
  });
});

/** Gives an engine what it would have learned from earlier blends (see blendBias.ts). */
function teach(engine: DesktopEngine, samples: { b: number; first: number; old: number }[]) {
  const learner = (engine as unknown as { biasLearner: BlendBiasLearner }).biasLearner;
  samples.forEach((s) => learner.record(s));
}

/** Two blends where what was left of the old song (5.9 s) was the error, as with a Crossfade of that length. */
const LEARNED_BLEND_LENGTH = [
  { b: 5900, first: 14000, old: 5875 },
  { b: 5800, first: 13900, old: 5900 },
];

describe('Spotify reporting the position ahead after a blend', () => {
  let now = 0;
  beforeEach(() => {
    now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000_000 + now);
  });
  afterEach(() => vi.restoreAllMocks());

  const snap = (over: Partial<DesktopSnapshot>): DesktopSnapshot => ({
    source: 'applescript',
    running: true,
    playing: true,
    track: track('Song A'),
    positionMs: 0,
    at: Date.now(),
    canSeek: true,
    ...over,
  });

  /**
   * Song A is 6 s from its end when Spotify mixes into Song B, whose audio starts 8 s in (Automix skips the
   * intro). From then on Spotify reports Song B's position ahead by the length of the blend.
   */
  function blendIntoB(learned: { b: number; first: number; old: number }[] = LEARNED_BLEND_LENGTH, ahead = 5875) {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    teach(engine, learned);
    engine.start();
    emit(snap({ positionMs: 190_000 }));
    now += 4000;
    emit(snap({ positionMs: 194_000 }));
    now += 250;
    // The audio of Song B is at 8 s right now.
    emit(snap({ track: track('Song B'), positionMs: 8_000 + ahead }));
    const overlap = engine.getState().change.transition.overlapMs;
    let truth = 8_000;
    /** Time passes; Spotify reports `truth + ahead`. */
    const play = (ms: number, ahead: number) => {
      for (let t = 0; t < ms; t += 250) {
        now += 250;
        truth += 250;
        emit(snap({ track: track('Song B'), positionMs: truth + ahead }));
      }
    };
    return { engine, emit, overlap, play, truth: () => truth, setTruth: (v: number) => (truth = v) };
  }

  it('takes off the blend length once earlier blends showed that to be the error, so the lyrics stay in time', () => {
    const b = blendIntoB();
    expect(b.engine.getState().change.transition.kind).toBe('blend');
    expect(b.overlap).toBe(5875);
    b.play(8000, b.overlap);
    expect(Math.abs(b.engine.clock.now() - b.truth())).toBeLessThan(300);
    b.engine.stop();
  });

  it('takes nothing off before it has measured anything: the blend length is not the error', () => {
    // On a real setup the blend lasted 9.5 to 12 s, and Spotify's error was about a second. Taking the blend length off made
    // the lyrics 11 s late.
    const b = blendIntoB([], 1000);
    expect(b.overlap).toBeGreaterThan(5000);
    b.play(8000, 1000);
    expect(Math.abs(b.engine.clock.now() - (b.truth() + 1000))).toBeLessThan(300); // follows what Spotify says
    b.engine.stop();
  });

  it('takes off what earlier blends measured, which was about a second', () => {
    const b = blendIntoB(
      [
        { b: 1200, first: 59_300, old: 12_000 },
        { b: 800, first: 8_700, old: 12_000 },
        { b: 1000, first: 20_800, old: 9_500 },
      ],
      1000,
    );
    b.play(8000, 1000);
    expect(Math.abs(b.engine.clock.now() - b.truth())).toBeLessThan(300);
    b.engine.stop();
  });

  it('can be switched off', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    teach(engine, LEARNED_BLEND_LENGTH);
    engine.setBlendTimingFix(false);
    engine.start();
    emit(snap({ positionMs: 190_000 }));
    now += 4000;
    emit(snap({ positionMs: 194_000 }));
    now += 250;
    emit(snap({ track: track('Song B'), positionMs: 8_000 + 5875 }));
    now += 2000;
    emit(snap({ track: track('Song B'), positionMs: 10_000 + 5875 }));
    // Without the fix the clock follows exactly what Spotify reports (ahead).
    expect(engine.clock.now()).toBeGreaterThan(15_000);
    engine.stop();
  });

  it('stops taking it off once Spotify refreshes its state (pause and resume)', () => {
    const b = blendIntoB();
    b.play(3000, b.overlap);
    // The user pauses and resumes: Spotify reports the right position again.
    now += 250;
    b.setTruth(b.truth() + 250);
    b.emit(snap({ track: track('Song B'), playing: false, positionMs: b.truth() }));
    now += 1000;
    b.emit(snap({ track: track('Song B'), playing: true, positionMs: b.truth() }));
    b.play(4000, 0);
    expect(Math.abs(b.engine.clock.now() - b.truth())).toBeLessThan(300);
    b.engine.stop();
  });

  it('stops taking it off when the reported position jumps back to the right place on its own', () => {
    const b = blendIntoB();
    b.play(3000, b.overlap);
    b.play(4000, 0); // Spotify corrected itself: the reports drop by the blend length
    expect(Math.abs(b.engine.clock.now() - b.truth())).toBeLessThan(300);
    b.engine.stop();
  });

  it('stops taking it off after you seek', async () => {
    const b = blendIntoB();
    b.play(3000, b.overlap);
    await b.engine.seek(100_000);
    b.setTruth(100_000);
    b.play(3000, 0);
    expect(Math.abs(b.engine.clock.now() - b.truth())).toBeLessThan(300);
    b.engine.stop();
  });

  it('leaves a skip and a normal song ending alone', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ positionMs: 30_000 }));
    now += 250;
    emit(snap({ track: track('Song B'), positionMs: 500 })); // skipped to the next song
    expect(engine.getState().change.transition.kind).toBe('skip');
    now += 2000;
    emit(snap({ track: track('Song B'), positionMs: 2500 }));
    expect(Math.abs(engine.clock.now() - 2500)).toBeLessThan(300);

    // Song B plays to its very end and Song C follows: a natural change, no blend.
    now += 250;
    emit(snap({ track: track('Song B'), positionMs: 199_900 }));
    now += 250;
    emit(snap({ track: track('Song C'), positionMs: 150 }));
    expect(engine.getState().change.transition.kind).toBe('natural');
    now += 2000;
    emit(snap({ track: track('Song C'), positionMs: 2150 }));
    expect(Math.abs(engine.clock.now() - 2150)).toBeLessThan(300);
    engine.stop();
  });

  it('writes what it saw to the timing log, to look at a timing problem afterwards', () => {
    clearTimingLog();
    const b = blendIntoB();
    b.play(2000, b.overlap);
    // the user pauses and resumes: the correction is dropped, and the log says why
    now += 250;
    b.setTruth(b.truth() + 250);
    b.emit(snap({ track: track('Song B'), playing: false, positionMs: b.truth() }));
    const report = timingReport([]);
    expect(report).toMatch(/CHANGE desktop: "Song A" .* -> "Song B" .*kind=blend overlap=5\.9/);
    expect(report).toContain('bias=5.9');
    expect(report).toMatch(/bias 5\.9 dropped: pause or resume/);
    expect(report).toMatch(/desktop "Song B" reported=/);
    b.engine.stop();
  });

  it('ignores stale reports of the old song while Spotify mixes into the next one', () => {
    clearTimingLog();
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    teach(engine, LEARNED_BLEND_LENGTH);
    engine.start();
    const A = track('Song A', 200_000);
    const B = track('Song B', 180_000);
    const report = (t: typeof A, pos: number) => emit(snap({ track: t, positionMs: pos }));
    report(A, 190_000);
    now += 4000;
    report(A, 194_000);
    // Song B takes over at 8 s in, then Spotify answers with Song A twice more (stale) between answers about Song B.
    let truthA = 194_000;
    let truthB = 8_000;
    const seqs: number[] = [];
    for (const which of ['B', 'B', 'A', 'B', 'B', 'A', 'B', 'B']) {
      now += 500;
      truthA += 500;
      truthB += 500;
      report(which === 'A' ? A : B, which === 'A' ? truthA : truthB + 5875);
      seqs.push(engine.getState().change.seq);
    }
    expect(seqs).toEqual([2, 2, 2, 2, 2, 2, 2, 2]); // one change (1 = first song, 2 = Song B), never flipped back
    expect(engine.getState().track?.name).toBe('Song B');
    expect(Math.abs(engine.clock.now() - truthB)).toBeLessThan(300);
    expect(timingReport([])).toMatch(/ignored a stale report of "Song A"/);
    engine.stop();
  });

  it('also ignores a stale report of the old song whose position is frozen where it was left', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    const A = track('Song A', 200_000);
    const B = track('Song B', 180_000);
    emit(snap({ track: A, positionMs: 190_000 }));
    now += 4000;
    emit(snap({ track: A, positionMs: 194_000 }));
    now += 500;
    emit(snap({ track: B, positionMs: 8_000 + 5875 }));
    const seq = engine.getState().change.seq;
    // later, Song A is reported again with the position it had when it was left (it never moved)
    now += 6000;
    emit(snap({ track: A, positionMs: 194_500 }));
    now += 500;
    emit(snap({ track: B, positionMs: 8_000 + 5875 + 6500 }));
    expect(engine.getState().change.seq).toBe(seq);
    expect(engine.getState().track?.name).toBe('Song B');
    engine.stop();
  });

  it('still follows you when you really go back to the song you just left', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    const A = track('Song A', 200_000);
    const B = track('Song B', 180_000);
    emit(snap({ track: A, positionMs: 190_000 }));
    now += 4000;
    emit(snap({ track: A, positionMs: 194_000 }));
    now += 500;
    emit(snap({ track: B, positionMs: 8_000 + 5875 }));
    expect(engine.getState().track?.name).toBe('Song B');
    // you press "previous": Song A starts again from its beginning
    now += 2000;
    emit(snap({ track: A, positionMs: 300 }));
    expect(engine.getState().track?.name).toBe('Song A');
    expect(engine.getState().change.seq).toBe(3);
    expect(Math.abs(engine.clock.now() - 300)).toBeLessThan(300);
    engine.stop();
  });
});
