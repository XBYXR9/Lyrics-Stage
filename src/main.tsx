import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loopbackAddress } from './lib/devAddress';
import { isNativeApp } from './lib/nativeApp';
import './styles/app.css';
import './styles/lyrics.css';

// Spotify only allows 127.0.0.1 (not "localhost") as a local redirect address,
// and logins are saved per address, so the website moves there. Not the Android app (see devAddress.ts).
const moveTo = loopbackAddress(window.location.href, isNativeApp());
if (moveTo) {
  window.location.replace(moveTo);
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
