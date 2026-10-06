// Settings: your account, where the music plays, and every Lyrics Stage setting.
import { useEngineState } from '../../../hooks/hooks';
import { appVersion } from '../../../lib/timingLog';
import { updateSettings, useSettings } from '../../../lib/settings';
import { forgetSong, rememberSong } from '../../../lib/songMemory';
import { DeviceMenu } from '../../NowPlaying';
import { SettingsPanel } from '../../SettingsPanel';
import type { StyleChoice } from '../../../lib/types';
import { Cover } from '../common';
import { useApp } from '../context';

export function SettingsView() {
  const { engine, profile, onSignOut, reconnect, needsReconnect } = useApp();
  const state = useEngineState(engine);
  const settings = useSettings();
  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>

      <section className="settings-card">
        <h3>Account</h3>
        <div className="account-row">
          <Cover url={profile?.avatarUrl} round className="avatar" />
          <div>
            <div className="account-name">{profile?.name ?? 'Not signed in'}</div>
            <div className="account-sub">
              {engine.isDemo ? 'Demo mode: made-up songs, no sound' : profile?.premium === null || !profile ? 'Spotify' : profile.premium ? 'Spotify Premium' : 'Spotify Free (playback control needs Premium)'}
            </div>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={onSignOut}>
            {engine.isDemo ? 'Leave the demo' : 'Sign out'}
          </button>
        </div>
        {needsReconnect && !engine.isDemo && (
          <div className="account-warn">
            This sign-in is from before the library was added. Sign in again to see your playlists, liked songs and more.{' '}
            <button className="btn small" onClick={reconnect}>
              Sign in again
            </button>
          </div>
        )}
      </section>

      <section className="settings-card">
        <h3>Playback</h3>
        <p className="hint">Choose where the music plays: this computer, a phone, a speaker… Spotify controls the sound, this app is the remote and the lyrics.</p>
        <div className="device-line">
          <DeviceMenu engine={engine} state={state} />
        </div>
      </section>

      <SettingsPanel
        embedded
        settings={settings}
        styleChoice={settings.style}
        onPickStyle={(c: StyleChoice) => {
          updateSettings({ style: c });
          if (state.track && settings.rememberPerSong) rememberSong(state.track.key, { style: c });
        }}
        songKey={state.track?.key ?? null}
        onForgetSong={() => state.track && forgetSong(state.track.key)}
        vibe={null}
        typicalBlendMs={state.typicalBlendMs}
        engineKind={engine.kind}
        onClose={() => {}}
        onSignOut={onSignOut}
      />

      <section className="settings-card">
        <h3>About</h3>
        <p className="hint">
          Lyrics Stage {appVersion()}. Not affiliated with, or endorsed by, Spotify. Your library comes from Spotify’s Web API; the lyrics come
          from LRCLIB.
        </p>
      </section>
    </div>
  );
}
