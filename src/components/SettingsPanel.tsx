// Settings: lyric style, timing, text size, background, beat effects and Automix blending.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useFrame } from '../hooks/hooks';
import { audioCounting, getAudioStatus, MAX_SOUND_DELAY_MS, peekAudioLoudness, startAudioLevels, subscribeAudioStatus } from '../lib/audioLevels';
import { BEAT_PREVIEW_EVENT } from '../lib/beat';
import { desktopApi } from '../lib/desktopTypes';
import type { EngineKind } from '../lib/engine';
import { updateSettings, type BeatStyle, type Settings } from '../lib/settings';
import type { StyleChoice, Vibe } from '../lib/types';
import { CloseIcon } from './Icons';
import { STYLES, styleName } from './styles';

const BEAT_STYLES: { id: BeatStyle; name: string; blurb: string }[] = [
  { id: 'glow', name: 'Glow', blurb: 'A soft glow and ring behind the lyrics.' },
  { id: 'screen', name: 'Full screen', blurb: 'A soft color wash over the whole screen.' },
  { id: 'edges', name: 'Edges', blurb: 'The edges of the screen light up.' },
  { id: 'kick', name: 'Kick', blurb: 'The lyrics bump a little. No light at all.' },
  { id: 'off', name: 'Off', blurb: 'No flash.' },
];

/** Shows one sample flash of the chosen style (the main screen paints it). */
const previewBeat = () => window.dispatchEvent(new Event(BEAT_PREVIEW_EVENT));

export function SettingsPanel({
  settings,
  vibe,
  typicalBlendMs,
  engineKind,
  onClose,
  onSignOut,
  onSignIn,
}: {
  settings: Settings;
  vibe: Vibe | null;
  typicalBlendMs: number | null;
  engineKind: EngineKind;
  onClose: () => void;
  onSignOut: () => void;
  onSignIn?: () => void;
}) {
  const desktopApp = !!desktopApi();
  const platform = desktopApi()?.platform;
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

        <Section title="Instrumental breaks">
          <Segmented
            value={settings.breakVisual}
            onChange={(v) => set({ breakVisual: v })}
            options={[
              { value: 'bars', label: 'Visualizer' },
              { value: 'dots', label: 'Dots' },
            ]}
          />
          <p className="hint">
            When the singing pauses, moving bars in the album’s colors keep the beat. A thin line shows when the lyrics
            come back.
          </p>
        </Section>

        <Section title="Beat flash">
          <div className="bf-grid" role="radiogroup" aria-label="Beat flash style">
            {BEAT_STYLES.map((b) => (
              <button
                key={b.id}
                role="radio"
                aria-checked={settings.beatStyle === b.id}
                className={`style-card bf-${b.id}-card${settings.beatStyle === b.id ? ' selected' : ''}`}
                onClick={() => {
                  set({ beatStyle: b.id });
                  if (b.id !== 'off') setTimeout(previewBeat, 90);
                }}
              >
                <span className="bf-mini" aria-hidden />
                <span className="sc-name">{b.name}</span>
                <span className="sc-blurb">{b.blurb}</span>
              </button>
            ))}
          </div>
          {settings.beatStyle !== 'off' && !settings.reduceMotion && (
            <button className="btn small" onClick={previewBeat}>
              Try it
            </button>
          )}
          <p className="hint">
            Shows on strong beats in the split-second pauses between lines, and on every strong beat in songs without
            lyrics. Never more than three times a second, soft and tinted (never white). It’s off with Reduce motion.
          </p>
        </Section>

        <Section title="Songs without lyrics">
          <Segmented
            value={settings.noLyricsVisual}
            onChange={(v) => set({ noLyricsVisual: v })}
            options={[
              { value: 'orb', label: 'Orb' },
              { value: 'bars', label: 'Equalizer' },
              { value: 'message', label: 'Just a message' },
            ]}
          />
          <p className="hint">
            For songs with no lyrics, and instrumentals, a scene in the album’s colors moves with the beat. Big beats get a
            bigger punch and a shockwave across the screen. It’s a plain message with Reduce motion.
          </p>
        </Section>

        {desktopApp && platform === 'win32' && <SoundSection settings={settings} />}

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

        {desktopApp && engineKind !== 'demo' && (
          <Section title="Spotify connection">
            {engineKind === 'desktop' ? (
              <>
                <p className="hint">Following the Spotify app on this computer.</p>
                {onSignIn && (
                  <button className="btn wide" onClick={onSignIn}>
                    Sign in with Spotify
                  </button>
                )}
                <p className="hint">
                  Signing in uses Spotify’s own data: exact timing and covers, and it follows your phone or speakers too.
                  It needs a free Spotify developer app (a one-time setup).
                </p>
              </>
            ) : (
              <>
                <p className="hint">Signed in to Spotify.</p>
                <button className="btn wide" onClick={onSignOut}>
                  Sign out
                </button>
                <p className="hint">Lyrics Stage then follows the Spotify app on this computer again.</p>
              </>
            )}
          </Section>
        )}

        {desktopApp && (
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

        {(engineKind === 'demo' || (engineKind === 'web-api' && !desktopApp)) && (
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

/** Windows desktop app: follow the computer's real sound, with a status and a level meter so problems can be seen. */
function SoundSection({ settings }: { settings: Settings }) {
  const status = useSyncExternalStore(subscribeAudioStatus, getAudioStatus);
  const on = settings.soundSync === 'on';
  let line = 'Not chosen yet. Pick On to try it.';
  if (settings.soundSync === 'off') line = 'Off. The effects use an estimated rhythm instead.';
  else if (on) {
    line =
      status.state === 'listening'
        ? 'Listening to your computer’s sound.'
        : status.state === 'starting'
          ? 'Starting…'
          : status.reason ?? 'Not listening yet.';
  }
  return (
    <Section title="Follow your PC’s sound">
      <Segmented
        value={settings.soundSync}
        onChange={(v) => updateSettings({ soundSync: v })}
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
      <p className={`hint${on && status.state === 'failed' ? ' warn-text' : ''}`}>{line}</p>
      {on && status.state === 'listening' && <SoundMeter />}
      {on && (status.state === 'failed' || status.state === 'waiting') && (
        <button className="btn small" onClick={() => void startAudioLevels()}>
          Try again
        </button>
      )}
      <p className="hint">
        The bars, the beat flash and the no-lyrics scene then hit the real beat. The sound is analysed inside the app and
        never recorded or sent anywhere.
      </p>
      <p className="hint">
        <b>Only while a song plays:</b> the sound counts only when Spotify is playing and the position is inside the
        song, so a video or a ping can’t set off the effects while Spotify is paused. Windows can’t share just
        Spotify’s sound though, so while a song plays, other loud sounds can still nudge them.
      </p>
      <div className="row">
        <input
          type="range"
          min={0}
          max={MAX_SOUND_DELAY_MS}
          step={10}
          value={settings.soundDelayMs}
          onChange={(e) => updateSettings({ soundDelayMs: Number(e.target.value) })}
          aria-label="Sound delay for Bluetooth headphones"
        />
        <span className="value">{settings.soundDelayMs} ms</span>
        <button className="btn small" onClick={() => updateSettings({ soundDelayMs: 0 })}>
          Reset
        </button>
      </div>
      <p className="hint">
        Bluetooth headphones play the sound a moment after the computer sends it. If the effects come too early, slide
        right until they land on the beat you hear (often 100–250 ms).
      </p>
    </Section>
  );
}

/** A live level of the computer's sound, and whether it currently counts for the effects. */
function SoundMeter() {
  const [counting, setCounting] = useState(audioCounting());
  const fill = useMeterFill();
  useFrame(() => {
    const c = audioCounting();
    setCounting((prev) => (prev === c ? prev : c));
  });
  return (
    <div className="meter-row">
      <span className="meter" aria-hidden>
        <span className="meter-fill" ref={fill} />
      </span>
      <span className="meter-note">{counting ? 'Counting for the effects' : 'Ignored: no song is playing'}</span>
    </div>
  );
}

function useMeterFill() {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!el) return;
    let id = 0;
    const loop = () => {
      el.style.transform = `scaleX(${peekAudioLoudness().toFixed(3)})`;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [el]);
  return setEl;
}
