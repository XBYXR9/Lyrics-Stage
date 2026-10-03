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

/**
 * What goes along with the sound in the share: the app's own page (the default,
 * nothing on screen is captured), or a screen source, which some Windows setups
 * need before they hand over the sound. Only these two are accepted; the video
 * is thrown away by the page at once either way.
 */
export type SoundVideoSource = 'frame' | 'screen';

export function parseSoundSource(raw: unknown): SoundVideoSource {
  return raw === 'screen' ? 'screen' : 'frame';
}
