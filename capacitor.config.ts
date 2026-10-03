import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the web build (dist) inside a native shell. See docs/ANDROID.md.
const config: CapacitorConfig = {
  appId: 'io.github.xbyxr9.lyricsstage',
  appName: 'Lyrics Stage',
  webDir: 'dist',
  android: {
    // Nothing in the app needs plain http.
    allowMixedContent: false,
  },
  plugins: {
    // The app is dark: light icons and clock in the status and navigation bars.
    SystemBars: { style: 'DARK', initialViewportFitValueHint: 'cover' },
  },
};

export default config;
