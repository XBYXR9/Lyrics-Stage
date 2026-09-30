// Settings: lyric style, timing, text size, background and Automix blending.
import type { ReactNode } from 'react';
import { desktopApi } from '../lib/desktopTypes';
import type { EngineKind } from '../lib/engine';
import { updateSettings, type Settings } from '../lib/settings';
import type { StyleChoice, Vibe } from '../lib/types';
import { CloseIcon } from './Icons';
import { STYLES, styleName } from './styles';

export function SettingsPanel({
  settings,
  vibe,
  typicalBlendMs,
  engineKind,
  onClose,
  onSignOut,
}: {
  settings: Settings;
  vibe: Vibe | null;
  typicalBlendMs: number | null;
  engineKind: EngineKind;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const set = updateSettings;
  const choices: { id: StyleChoice; name: string; blurb: string }[] = [
    { id: 'auto', name: 'Auto', blurb: 'Picks a style that fits each song.' },
    ...STYLES,
  ];

  return (
    <aside className="panel glass settings" aria-label="Settings">
      <div className="panel-head">
        <h2>Settings</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings">
          <CloseIcon />
        </button>
      </div>

      <div className="panel-body">
        <Section title="Lyrics style">
          <div className="style-grid">
            {choices.map((c) => (
              <button
                key={c.id}
                className={`style-card sc-${c.id}${settings.style === c.id ? ' selected' : ''}`}
                onClick={() => set({ style: c.id })}
                aria-pressed={settings.style === c.id}
              >
                <span className="sc-preview" aria-hidden>
                  Aa
                </span>
                <span className="sc-name">{c.name}</span>
                <span className="sc-blurb">{c.blurb}</span>
              </button>
            ))}
          </div>
          {vibe && (
            <p className="hint">
              This song feels <b>{vibe.label}</b>
              {vibe.wordsPerSecond > 0 && <> ({vibe.wordsPerSecond.toFixed(1)} words/sec)</>}. Auto would pick{' '}
              <b>{styleName(vibe.autoStyle)}</b>.
            </p>
          )}
        </Section>

        <Section title="Word-by-word highlight">
          <Segmented
            value={settings.wordSweep}
            onChange={(v) => set({ wordSweep: v })}
            options={[
              { value: 'estimated', label: 'Always' },
              { value: 'real-only', label: 'Only exact' },
              { value: 'off', label: 'Whole lines' },
            ]}
          />
          <p className="hint">
            Most songs only have line timing, so word timing is estimated. “Only exact” uses word highlighting just when
            the lyrics have real word timing.
          </p>
        </Section>

        <Section title="Lyrics timing">
          <div className="row">
            <input
              type="range"
              min={-2000}
              max={2000}
              step={50}
              value={settings.offsetMs}
              onChange={(e) => set({ offsetMs: Number(e.target.value) })}
              aria-label="Lyrics timing offset"
            />
            <span className="value">
              {settings.offsetMs > 0 ? '+' : ''}
              {(settings.offsetMs / 1000).toFixed(2)}s
            </span>
            <button className="btn small" onClick={() => set({ offsetMs: 0 })}>
              Reset
            </button>
          </div>
          <p className="hint">
            Lyrics late (e.g. Bluetooth headphones)? Slide right to show them earlier. Shortcut: <kbd>[</kbd> and{' '}
            <kbd>]</kbd>.
          </p>
        </Section>

        <Section title="Text size">
          <div className="row">
            <input
              type="range"
              min={0.7}
              max={1.5}
              step={0.05}
              value={settings.fontScale}
              onChange={(e) => set({ fontScale: Number(e.target.value) })}
              aria-label="Text size"
            />
            <span className="value">{Math.round(settings.fontScale * 100)}%</span>
          </div>
        </Section>

        <Section title="Background">
          <Segmented
            value={settings.background}
            onChange={(v) => set({ background: v })}
            options={[
              { value: 'art', label: 'Album art' },
              { value: 'fluid', label: 'Color flow' },
            ]}
          />
        </Section>

        <Section title="Song transitions">
          <Toggle
            checked={settings.automixBlend}
            onChange={(v) => set({ automixBlend: v })}
            label="Blend with Spotify Automix & Crossfade"
          />
          <p className="hint">
            When Spotify mixes one song into the next, the lyrics and colors crossfade for exactly as long as the songs
            overlap.
            {typicalBlendMs ? ` Your blends so far last about ${(typicalBlendMs / 1000).toFixed(1)}s.` : ''}
          </p>
          <p className="hint">
            <b>Turn on Automix:</b> in the Spotify app, click your profile picture → <b>Settings</b> → <b>Playback</b> →
            switch on <b>Automix</b> (or <b>Crossfade songs</b>). Needs Spotify Premium; Automix works on select
            playlists.
            {engineKind === 'desktop' && (
              <>
                {' '}
                <button className="link inline" onClick={() => void desktopApi()?.openSpotify()}>
                  Open Spotify
                </button>
              </>
            )}
          </p>
          <Toggle checked={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label="Reduce motion" />
        </Section>

        {engineKind === 'desktop' && (
          <Section title="Window">
            <Toggle
              checked={settings.alwaysOnTop}
              onChange={(v) => set({ alwaysOnTop: v })}
              label="Keep on top of other windows"
            />
            <p className="hint">Handy as a small lyrics window next to your work. Press L for lyrics only.</p>
          </Section>
        )}

        <Section title="Keyboard shortcuts">
          <ul className="keys">
            <li>
              <kbd>Space</kbd> play / pause
            </li>
            <li>
              <kbd>N</kbd> / <kbd>P</kbd> next / previous
            </li>
            <li>
              <kbd>/</kbd> search · <kbd>S</kbd> settings
            </li>
            <li>
              <kbd>Y</kbd> next style · <kbd>L</kbd> lyrics only · <kbd>F</kbd> fullscreen
            </li>
          </ul>
        </Section>

        {engineKind !== 'desktop' && (
          <button className="btn ghost wide" onClick={onSignOut}>
            {engineKind === 'demo' ? 'Leave the demo' : 'Disconnect Spotify'}
          </button>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
      <span>{label}</span>
    </label>
  );
}
