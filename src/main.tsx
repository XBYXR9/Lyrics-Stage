import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';
import './styles/lyrics.css';

// Spotify only allows 127.0.0.1 (not "localhost") as a local redirect address,
// and logins are saved per address — so always use 127.0.0.1.
if (window.location.hostname === 'localhost') {
  window.location.replace(window.location.href.replace('//localhost', '//127.0.0.1'));
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
