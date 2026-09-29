// Loads Spotify's Web Playback SDK, which turns this browser tab into a
// Spotify device ("Lyrics Stage") you can play music on. Needs Premium.

export interface SdkTrack {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string; uri: string }[];
  album: { name: string; uri: string; images: { url: string; width?: number | null }[] };
}

export interface SdkState {
  paused: boolean;
  position: number;
  duration: number;
  timestamp?: number;
  track_window: {
    current_track: SdkTrack | null;
    next_tracks: SdkTrack[];
    previous_tracks: SdkTrack[];
  };
}

export interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: 'ready' | 'not_ready', cb: (d: { device_id: string }) => void): boolean;
  addListener(event: 'player_state_changed', cb: (s: SdkState | null) => void): boolean;
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    cb: (e: { message: string }) => void,
  ): boolean;
  addListener(event: 'autoplay_failed', cb: () => void): boolean;
  getCurrentState(): Promise<SdkState | null>;
  togglePlay(): Promise<void>;
  activateElement(): Promise<void>;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SdkPlayer;
    };
  }
}

let loading: Promise<void> | null = null;

export function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error('Could not load the Spotify player script.'));
    };
    document.body.appendChild(script);
  });
  return loading;
}

/** Position right now, accounting for time since the state snapshot was taken. */
export function sdkPosition(state: SdkState): number {
  const ts = state.timestamp;
  if (!state.paused && ts && Math.abs(Date.now() - ts) < 30_000) {
    return Math.min(state.duration, state.position + Math.max(0, Date.now() - ts));
  }
  return state.position;
}
