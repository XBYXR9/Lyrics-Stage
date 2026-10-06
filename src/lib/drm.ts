// Can this window play copy-protected audio (DRM)? Spotify's music is protected, so the app's own player only works
// where the browser has a content decryption module: Widevine (Chrome, Edge, Firefox, and the desktop app's Electron
// when it is a build with Widevine) or FairPlay (Safari).
let answer: Promise<boolean> | null = null;

const SYSTEMS = ['com.widevine.alpha', 'com.apple.fps', 'com.apple.fps.1_0'];

/** Asks the browser once (the answer is kept). */
export function canPlayProtectedAudio(): Promise<boolean> {
  answer ??= (async () => {
    if (typeof navigator === 'undefined' || typeof navigator.requestMediaKeySystemAccess !== 'function') return false;
    const config: MediaKeySystemConfiguration[] = [
      {
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"', robustness: '' }],
      },
    ];
    for (const system of SYSTEMS) {
      try {
        await navigator.requestMediaKeySystemAccess(system, config);
        return true;
      } catch {
        /* not this one */
      }
    }
    return false;
  })();
  return answer;
}
