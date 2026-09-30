import { describe, expect, it } from 'vitest';
import { isNewerVersion, parseLatestRelease, updateChannel, updateMode } from '../updateCheck';

describe('app updates', () => {
  it('compares versions number by number', () => {
    expect(isNewerVersion('0.2.0', '0.1.2')).toBe(true);
    expect(isNewerVersion('v0.10.0', '0.9.3')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(false);
    expect(isNewerVersion('0.2', '0.2.0')).toBe(false);
  });

  it('updates itself on Windows and the Linux AppImage, and only points to the download elsewhere', () => {
    expect(updateMode('win32', undefined)).toBe('auto');
    expect(updateMode('linux', '/home/me/Lyrics-Stage.AppImage')).toBe('auto');
    expect(updateMode('linux', undefined)).toBe('notify'); // .deb
    expect(updateMode('darwin', undefined)).toBe('notify'); // unsigned macOS builds can't replace themselves
  });

  it('gives Windows on Arm its own update file', () => {
    expect(updateChannel('win32', 'arm64')).toBe('latest-arm64');
    expect(updateChannel('win32', 'x64')).toBeNull();
    expect(updateChannel('linux', 'arm64')).toBeNull();
    expect(updateChannel('darwin', 'arm64')).toBeNull();
  });

  it("reads GitHub's latest release", () => {
    const page = 'https://github.com/XBYXR9/Lyrics-Stage/releases/tag/v0.3.0';
    expect(parseLatestRelease({ tag_name: 'v0.3.0', html_url: page })).toEqual({ version: '0.3.0', url: page });
    expect(parseLatestRelease({ tag_name: 'v0.3.0', html_url: page, prerelease: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'nightly', html_url: page })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'v0.3.0', html_url: 'https://evil.example/x' })).toBeNull();
    expect(parseLatestRelease(null)).toBeNull();
  });
});
