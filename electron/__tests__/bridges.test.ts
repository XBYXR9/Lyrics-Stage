import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/lib/desktopTypes';
import { splitJsonLines } from '../bridge/child';
import { mprisTrackUri, normalizeArtUrl, parseMpris } from '../bridge/linux';
import { JXA_LOOP, macCommandScript, parseMacLine } from '../bridge/mac';
import { encodePowerShell, parseWindowsLine, SMTC_SCRIPT } from '../bridge/windows';

describe('macOS (AppleScript)', () => {
  it('reads a playing track', () => {
    const s = parseMacLine({
      running: true,
      state: 'playing',
      at: 1000,
      position: 12.5,
      track: { id: 'spotify:track:abc123DEF456', name: 'Yellow', artist: 'Coldplay', album: 'Parachutes', duration: 266773, artwork: 'https://i.scdn.co/image/x' },
    });
    expect(s).toMatchObject({ source: 'applescript', running: true, playing: true, positionMs: 12500, at: 1000, canSeek: true });
    expect(s.track).toEqual({
      uri: 'spotify:track:abc123DEF456',
      title: 'Yellow',
      artist: 'Coldplay',
      album: 'Parachutes',
      durationMs: 266773,
      artUrl: 'https://i.scdn.co/image/x',
    });
  });

  it('explains the Automation permission when macOS blocks it', () => {
    const s = parseMacLine({ error: 'Error: Not authorized to send Apple events to Spotify. (-1743)' });
    expect(s.problem).toMatch(/Privacy & Security → Automation/);
  });

  it('handles Spotify closed or missing', () => {
    expect(parseMacLine({ running: false }).running).toBe(false);
    expect(parseMacLine({ installed: false }).problem).toMatch(/isn’t installed/);
  });

  it('builds safe AppleScript commands', () => {
    expect(macCommandScript({ type: 'playpause' })).toBe('tell application "Spotify" to playpause');
    expect(macCommandScript({ type: 'seek', positionMs: 61234 })).toBe('tell application "Spotify" to set player position to 61.234');
    expect(macCommandScript({ type: 'openUri', uri: 'spotify:track:abc123DEF456' })).toBe(
      'tell application "Spotify" to play track "spotify:track:abc123DEF456"',
    );
  });

  it('has no template placeholders left in the JXA loop', () => {
    expect(JXA_LOOP).not.toContain('${');
    expect(JXA_LOOP).toContain("Application('Spotify')");
  });
});

describe('Windows (media controls)', () => {
  it('reads a track and keeps the cover between updates', () => {
    const first = parseWindowsLine(
      { running: true, playing: true, title: 'Yellow', artist: 'Coldplay', album: 'Parachutes', durationMs: 266773, positionMs: 5000, at: 1, canSeek: true, artChanged: true, art: 'data:image/png;base64,AAA' },
      null,
    );
    expect(first.snapshot).toMatchObject({ source: 'smtc', running: true, playing: true, positionMs: 5000, canSeek: true });
    expect(first.snapshot.track?.artUrl).toBe('data:image/png;base64,AAA');
    const second = parseWindowsLine({ running: true, playing: true, title: 'Yellow', durationMs: 266773, positionMs: 5250 }, first.art);
    expect(second.snapshot.track?.artUrl).toBe('data:image/png;base64,AAA');
  });

  it('clamps the position to the song length', () => {
    const { snapshot } = parseWindowsLine({ running: true, title: 'X', durationMs: 1000, positionMs: 5000 }, null);
    expect(snapshot.positionMs).toBe(1000);
  });

  it('reports Spotify closed', () => {
    expect(parseWindowsLine({ running: false }, null).snapshot.running).toBe(false);
  });

  it('encodes the script for -EncodedCommand (UTF-16LE base64)', () => {
    const enc = encodePowerShell('Write-Output 1');
    expect(Buffer.from(enc, 'base64').toString('utf16le')).toBe('Write-Output 1');
    expect(SMTC_SCRIPT).toContain("ParameterType.Name -eq 'IAsyncOperation`1'");
    expect(SMTC_SCRIPT).not.toContain('${');
  });
});

describe('Linux (MPRIS)', () => {
  const v = (value: unknown) => ({ value });
  it('reads Spotify metadata', () => {
    const state = parseMpris({
      PlaybackStatus: v('Playing'),
      Position: v(0n),
      Metadata: v({
        'mpris:trackid': v('/com/spotify/track/3AJwUDP919kvQ9QcozQPxg'),
        'mpris:length': v(266773000n),
        'mpris:artUrl': v('https://open.spotify.com/image/ab67616d0000b273'),
        'xesam:title': v('Yellow'),
        'xesam:artist': v(['Coldplay', 'Guest']),
        'xesam:album': v('Parachutes'),
      }),
    });
    expect(state.playing).toBe(true);
    expect(state.trackId).toBe('/com/spotify/track/3AJwUDP919kvQ9QcozQPxg');
    expect(state.track).toEqual({
      uri: 'spotify:track:3AJwUDP919kvQ9QcozQPxg',
      title: 'Yellow',
      artist: 'Coldplay, Guest',
      album: 'Parachutes',
      durationMs: 266773,
      artUrl: 'https://i.scdn.co/image/ab67616d0000b273',
    });
  });

  it('works out track URIs and cover URLs', () => {
    expect(mprisTrackUri('spotify:track:abc', undefined)).toBe('spotify:track:abc');
    expect(mprisTrackUri('/org/mpris/MediaPlayer2/Track/1', 'https://open.spotify.com/track/xyz')).toBe('spotify:track:xyz');
    expect(mprisTrackUri(null, null)).toBeNull();
    expect(normalizeArtUrl('')).toBeNull();
  });

  it('returns no track when nothing is loaded', () => {
    expect(parseMpris({ PlaybackStatus: v('Stopped'), Metadata: v({}) }).track).toBeNull();
  });
});

describe('command validation (from the page)', () => {
  it('accepts known commands and rejects anything else', () => {
    expect(validateCommand({ type: 'next' })).toEqual({ type: 'next' });
    expect(validateCommand({ type: 'seek', positionMs: 1234.4 })).toEqual({ type: 'seek', positionMs: 1234 });
    expect(validateCommand({ type: 'seek', positionMs: -1 })).toBeNull();
    expect(validateCommand({ type: 'openUri', uri: 'spotify:track:abc123DEF456' })).not.toBeNull();
    expect(validateCommand({ type: 'openUri', uri: 'spotify:track:x" & do shell script "rm' })).toBeNull();
    expect(validateCommand({ type: 'openUri', uri: 'https://evil.example' })).toBeNull();
    expect(validateCommand({ type: 'rm -rf' })).toBeNull();
    expect(validateCommand(null)).toBeNull();
  });
});

describe('splitJsonLines', () => {
  it('handles lines split across chunks and skips junk', () => {
    const got: unknown[] = [];
    const feed = splitJsonLines((o) => got.push(o));
    feed('{"a":1}\n{"b"');
    feed(':2}\nnot json\n\n');
    expect(got).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
