// Who may listen to the computer's sound ("Follow the real sound", Windows only).
// Kept apart from Electron so it can be tested.

/**
 * Only the app's own page, and only on Windows, where Electron can share a copy
 * of the sound going to the speakers. Anything else (another page, another
 * system) is refused.
 */
export function mayHearSound(platform: string, frameUrl: string | undefined, isAppUrl: (url: string) => boolean): boolean {
  return platform === 'win32' && !!frameUrl && isAppUrl(frameUrl);
}
