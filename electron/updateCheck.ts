// The small decisions behind app updates, kept apart from Electron so they can be tested.

/** Where new versions are published (GitHub Releases). Keep in sync with `build.publish` in package.json. */
export const RELEASES = { owner: 'XBYXR9', repo: 'Lyrics-Stage' } as const;

/**
 * How this copy of the app can update:
 * - "auto": download in the background and install on restart (Windows, Linux AppImage).
 * - "notify": say a new version is out and link to the download page. macOS only lets
 *   signed apps replace themselves (our builds aren't signed yet), and a Linux .deb
 *   install belongs to the system's package manager.
 */
export function updateMode(platform: string, appImagePath: string | undefined): 'auto' | 'notify' {
  if (platform === 'win32') return 'auto';
  if (platform === 'linux' && appImagePath) return 'auto';
  return 'notify';
}

/**
 * Both Windows builds would publish their update info as latest.yml, so the
 * Windows on Arm build publishes latest-arm64.yml instead (see release.yml)
 * and reads that one. Every other build uses the default ("latest").
 */
export function updateChannel(platform: string, arch: string): string | null {
  return platform === 'win32' && arch === 'arm64' ? 'latest-arm64' : null;
}

const parts = (v: string) =>
  v
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);

/** Is `candidate` a newer version than `current`? ("0.10.0" > "0.9.3"; a leading "v" is fine.) */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Reads GitHub's "latest release" answer: the version and its page. */
export function parseLatestRelease(json: unknown): { version: string; url: string } | null {
  const o = (json ?? {}) as Record<string, unknown>;
  if (o.draft === true || o.prerelease === true) return null;
  const tag = typeof o.tag_name === 'string' ? o.tag_name.trim() : '';
  const url = typeof o.html_url === 'string' ? o.html_url : '';
  if (!/^v?\d+\.\d+/.test(tag) || !url.startsWith('https://github.com/')) return null;
  return { version: tag.replace(/^v/i, ''), url };
}
