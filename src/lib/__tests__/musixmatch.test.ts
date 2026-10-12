import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { musixmatchUrl } from '../../../electron/musixmatch';
import type { LyricsStageDesktopApi } from '../desktopTypes';
import type { TrackInfo } from '../types';

const richsync = JSON.stringify([
  {
    ts: 10,
    te: 13,
    l: [
      { c: 'Hello', o: 0 },
      { c: ' ', o: 0.6 },
      { c: 'darkness', o: 0.7 },
      { c: ' ', o: 1.5 },
      { c: 'my', o: 1.6 },
      { c: ' ', o: 1.9 },
      { c: 'old', o: 2.0 },
      { c: ' ', o: 2.3 },
      { c: 'friend', o: 2.4 },
    ],
  },
  { ts: 14, te: 16, l: [] },
  { ts: 17, te: 20, l: [{ c: "I've", o: 0 }, { c: ' ', o: 0.4 }, { c: 'come', o: 0.5 }] },
]);

describe('richsyncToLyrics', () => {
  it('turns word offsets into real word timings, gluing spaces to the word before', async () => {
    const { richsyncToLyrics } = await import('../musixmatch');
    const lyrics = richsyncToLyrics(richsync, 200_000)!;
    expect(lyrics.wordSynced).toBe(true);
    expect(lyrics.source).toBe('Musixmatch');
    const sung = lyrics.lines.filter((l) => !l.interlude);
    expect(sung).toHaveLength(2);
    expect(sung[0].text).toBe('Hello darkness my old friend');
    expect(sung[0].words.map((w) => [w.text, w.start])).toEqual([
      ['Hello ', 10_000],
      ['darkness ', 10_700],
      ['my ', 11_600],
      ['old ', 12_000],
      ['friend', 12_400],
    ]);
    // each word ends where the next starts, and the last word ends with its line
    expect(sung[0].words[0].end).toBe(10_700);
    expect(sung[0].words[4].end).toBe(13_000);
  });

  it('gives nothing for answers it cannot read', async () => {
    const { richsyncToLyrics } = await import('../musixmatch');
    expect(richsyncToLyrics('not json', 1000)).toBeNull();
    expect(richsyncToLyrics('[]', 1000)).toBeNull();
    expect(richsyncToLyrics(JSON.stringify([{ ts: 1, te: 2, l: [{ c: 5 }] }]), 1000)).toBeNull();
  });
});

describe('musixmatchUrl (what the desktop app will fetch)', () => {
  it('allows only the lyrics and token requests on Musixmatch', () => {
    expect(musixmatchUrl('/ws/1.1/macro.subtitles.get?q_track=a')).toMatch(/^https:\/\/apic-appmobile\.musixmatch\.com\/ws\/1\.1\/macro\.subtitles\.get\?/);
    expect(musixmatchUrl('/ws/1.1/token.get?app_id=x')).not.toBeNull();
    expect(musixmatchUrl('/ws/1.1/user.get?x=1')).toBeNull();
    expect(musixmatchUrl('https://evil.example/ws/1.1/token.get?x')).toBeNull();
    expect(musixmatchUrl('//evil.example/ws/1.1/token.get?x')).toBeNull();
    expect(musixmatchUrl(42)).toBeNull();
  });
});

const track: TrackInfo = {
  key: 'abc',
  id: 'abc',
  uri: 'spotify:track:abc',
  name: 'Hello',
  artists: ['Adele'],
  album: '25',
  artUrl: null,
  artThumbUrl: null,
  durationMs: 295_000,
};

describe('fetchMusixmatchWords', () => {
  const calls: string[] = [];
  let tokenAnswers: number[] = [];
  beforeEach(() => {
    vi.resetModules();
    calls.length = 0;
    tokenAnswers = [];
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const macro = (status: number, withRich: boolean, length = 295) =>
      JSON.stringify({
        message: {
          header: { status_code: status },
          body: {
            macro_calls: {
              'matcher.track.get': { message: { body: { track: { has_richsync: withRich, instrumental: false, track_length: length } } } },
              'track.richsync.get': { message: { header: { status_code: 200 }, body: { richsync: { richsync_body: richsync, richsync_length: length } } } },
            },
          },
        },
      });
    const api = {
      isDesktop: true,
      musixmatchGet: async (path: string) => {
        calls.push(path);
        if (path.includes('token.get')) return { status: 200, body: JSON.stringify({ message: { body: { user_token: `tok${calls.length}` } } }) };
        const next = tokenAnswers.shift() ?? 200;
        if (next === 401) return { status: 200, body: JSON.stringify({ message: { header: { status_code: 401 } } }) };
        if (next === 999) return { status: 200, body: macro(200, true, 180) };
        if (next === 404) return { status: 200, body: macro(200, false) };
        return { status: 200, body: macro(200, true) };
      },
    } as unknown as LyricsStageDesktopApi;
    vi.stubGlobal('window', { lyricsStage: api });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks for a token, then for the song, and returns real word timings', async () => {
    const { fetchMusixmatchWords } = await import('../musixmatch');
    const lyrics = await fetchMusixmatchWords(track);
    expect(lyrics?.wordSynced).toBe(true);
    expect(calls[0]).toContain('token.get');
    expect(calls[1]).toContain('macro.subtitles.get');
    expect(calls[1]).toContain('q_track=Hello');
    expect(calls[1]).toContain('usertoken=tok1');
  });

  it('gets a new token once when the old one has run out', async () => {
    const { fetchMusixmatchWords } = await import('../musixmatch');
    tokenAnswers = [401, 200];
    const lyrics = await fetchMusixmatchWords(track);
    expect(lyrics?.wordSynced).toBe(true);
    expect(calls.filter((c) => c.includes('token.get'))).toHaveLength(2);
  });

  it('gives nothing when the song has no word timing, or is another recording', async () => {
    const { fetchMusixmatchWords } = await import('../musixmatch');
    tokenAnswers = [404];
    expect(await fetchMusixmatchWords(track)).toBeNull();
    tokenAnswers = [999];
    expect(await fetchMusixmatchWords(track)).toBeNull();
  });
});

describe('getLyrics with Musixmatch word timing', () => {
  const lrclib = { id: 1, trackName: 'Hello', artistName: 'Adele', albumName: '25', duration: 295, instrumental: false, plainLyrics: null, syncedLyrics: '[00:10.00]Hello darkness my old friend\n[00:14.00]I\'ve come' };
  let mxmCalls = 0;
  beforeEach(() => {
    vi.resetModules();
    mxmCalls = 0;
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: () => null,
      length: 0,
    });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(lrclib), { status: 200 }));
    vi.stubGlobal('window', {
      lyricsStage: {
        isDesktop: true,
        musixmatchGet: async (path: string) => {
          mxmCalls++;
          if (path.includes('token.get')) return { status: 200, body: JSON.stringify({ message: { body: { user_token: 't' } } }) };
          return {
            status: 200,
            body: JSON.stringify({
              message: {
                header: { status_code: 200 },
                body: {
                  macro_calls: {
                    'matcher.track.get': { message: { body: { track: { has_richsync: true, instrumental: false, track_length: 295 } } } },
                    'track.richsync.get': { message: { header: { status_code: 200 }, body: { richsync: { richsync_body: richsync, richsync_length: 295 } } } },
                  },
                },
              },
            }),
          };
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stays with LRCLIB, and never calls Musixmatch, while the setting is off', async () => {
    const { getLyrics } = await import('../lyrics');
    const lyrics = await getLyrics(track);
    expect(lyrics.source).toBe('LRCLIB');
    expect(lyrics.wordSynced).toBe(false);
    expect(mxmCalls).toBe(0);
  });

  it('uses Musixmatch’s real word timing when the setting is on', async () => {
    const { updateSettings } = await import('../settings');
    updateSettings({ musixmatchWords: true });
    const { getLyrics } = await import('../lyrics');
    const lyrics = await getLyrics(track);
    expect(lyrics.source).toBe('Musixmatch');
    expect(lyrics.wordSynced).toBe(true);
  });
});
