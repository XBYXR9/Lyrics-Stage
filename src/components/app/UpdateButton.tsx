// The desktop app's update button, shown in the sidebar and on the Settings page (nothing in the browser or on a phone).
import { useAppUpdate } from '../../hooks/useAppUpdate';
import { desktopApi } from '../../lib/desktopTypes';

export function UpdateButton({ className = '' }: { className?: string }) {
  const update = useAppUpdate();
  if (update?.state === 'ready') {
    return (
      <button className={`pill update-pill ${className}`} onClick={() => void desktopApi()?.installUpdate()} title={`Restart to use version ${update.version}`}>
        Update ready · Restart
      </button>
    );
  }
  if (update?.state === 'available') {
    return (
      <a className={`pill update-pill ${className}`} href={update.url} target="_blank" rel="noreferrer" title="Opens the download page">
        Update available · {update.version}
      </a>
    );
  }
  if (update?.state === 'downloading') return <span className={`pill ${className}`}>Downloading {update.version}…</span>;
  return null;
}
