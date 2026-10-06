// The left menu (a bar of tabs along the bottom on a phone).
import { HeartIcon, HomeIcon, LibraryIcon, LyricsIcon, QueueIcon, SearchIcon, SettingsIcon } from '../Icons';
import { Cover, useLoad } from './common';
import { useApp } from './context';
import { UpdateButton } from './UpdateButton';
import type { View } from './nav';

const ITEMS: { view: View; label: string; icon: typeof HomeIcon }[] = [
  { view: 'home', label: 'Home', icon: HomeIcon },
  { view: 'search', label: 'Search', icon: SearchIcon },
  { view: 'library', label: 'Your Library', icon: LibraryIcon },
  { view: 'queue', label: 'Queue', icon: QueueIcon },
];

export function Sidebar() {
  const { router, catalog, openLyrics } = useApp();
  const current = router.route.view;
  const lists = useLoad(() => catalog.playlists(0), 'sidebar:playlists');
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ♪
        </span>
        <span className="brand-name">Lyrics Stage</span>
      </div>
      <div className="side-items">
        {ITEMS.map(({ view, label, icon: Icon }) => (
          <button key={view} className={`side-item${current === view ? ' on' : ''}`} onClick={() => router.go({ view } as never)} aria-current={current === view ? 'page' : undefined}>
            <Icon width={24} height={24} />
            <span>{label}</span>
          </button>
        ))}
        <button className="side-item lyrics-item" onClick={openLyrics}>
          <LyricsIcon width={24} height={24} />
          <span>Lyrics</span>
        </button>
        <button className={`side-item${current === 'settings' ? ' on' : ''}`} onClick={() => router.go({ view: 'settings' })}>
          <SettingsIcon width={24} height={24} />
          <span>Settings</span>
        </button>
      </div>
      <UpdateButton className="side-update" />
      <div className="side-lists" aria-label="Your playlists">
        <button className={`side-list${current === 'liked' ? ' on' : ''}`} onClick={() => router.go({ view: 'liked' })}>
          <span className="cover liked-cover small">
            <HeartIcon filled width={14} height={14} />
          </span>
          <span>Liked songs</span>
        </button>
        {lists.data?.items.map((p) => (
          <button key={p.id} className="side-list" onClick={() => router.go({ view: 'playlist', id: p.id })}>
            <Cover url={p.artUrl} className="small" />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
