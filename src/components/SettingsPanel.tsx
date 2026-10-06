// Settings: lyric style, timing, text size, background, beat effects and Automix blending.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useFrame } from '../hooks/hooks';
import { timingReport } from '../lib/timingLog';
import { toast } from './Toasts';
import { audioCounting, getAudioStatus, MAX_SOUND_DELAY_MS, peekAudioLoudness, startAudioLevels, subscribeAudioStatus } from '../lib/audioLevels';
import { BEAT_PREVIEW_EVENT } from '../lib/beat';
import { desktopApi } from '../lib/desktopTypes';
import { isNativeApp } from '../lib/nativeApp';
import type { EngineKind } from '../lib/engine';
import { COLOR_THEMES, isHexColor, themeAccent } from '../lib/colorTheme';
import { MUSIC_APP_LABEL, MUSIC_APPS } from '../lib/desktopTypes';
import { forgetAllSongs, getSongPrefs, useRememberedCount, useSongPrefs } from '../lib/songMemory';
import { cancelSleepTimer, formatLeft, SLEEP_CHOICES, startSleepTimer, useSleepState } from '../lib/sleepTimer';
import { isTranslateLanguage, TRANSLATE_LANGUAGES } from '../lib/translate';
import { clearWallpaper, setWallpaperFromFile, useWallpaper } from '../lib/wallpaper';
import { updateSettings, type BeatStyle, type Settings } from '../lib/settings';
import type { StyleChoice, Vibe } from '../lib/types';
import { CloseIcon, PortraitIcon } from './Icons';
import { STYLES, styleName } from './styles';

/** Does the computer itself ask for less motion (for example Windows with animation effects switched off)? */
const systemReducesMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
  styleChoice,
  onPickStyle,
  songKey,
  onForgetSong,
  vibe,
  typicalBlendMs,
  engineKind,
  onClose,
  onSignOut,
  onSignIn,
  timingHeader,
  songNudgeMs = 0,
  onNudge,
  onResetNudge,
  onRecord,
  embedded = false,
}: {
  /** Shown as a page of the Spotify-style app instead of a side panel. */
  embedded?: boolean;
  settings: Settings;
  /** The lyric style in use for the song playing now (a saved choice for this song, or the general one). */
  styleChoice: StyleChoice;
  /** Picks a lyric style (for every song, and for this one when songs are remembered). */
  onPickStyle: (choice: StyleChoice) => void;
  /** The song playing now, if any. */
  songKey: string | null;
  /** Forgets what is saved for the song playing now. */
  onForgetSong: () => void;
  vibe: Vibe | null;
  typicalBlendMs: number | null;
  engineKind: EngineKind;
  onClose: () => void;
  onSignOut: () => void;
  onSignIn?: () => void;
  /** The first lines of the timing report (version, source, settings, what's playing). */
  timingHeader?: () => string[];
  /** The timing nudge for the song playing now (ms; positive = lyrics earlier), and how to change it. */
  songNudgeMs?: number;
  onNudge?: (deltaMs: number) => void;
  onResetNudge?: () => void;
  /** Opens the recording view (a full-screen 9:16 frame for TikTok). */
  onRecord?: () => void;
}) {
  const desktopApp = !!desktopApi();
  const native = isNativeApp();
  const platform = desktopApi()?.platform;
  const set = updateSettings;
  const choices: { id: StyleChoice; name: string; blurb: string }[] = [
    { id: 'auto', name: 'Auto', blurb: 'Picks a style that fits each song.' },
    ...STYLES,
  ];

  return (
    <aside className={embedded ? 'settings settings-page' : 'panel glass settings'} aria-label="Settings">
      {!embedded && (
        <div className="panel-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>
      )}

      <div className={embedded ? 'settings-body' : 'panel-body'}>
        <Section title="Lyrics style">
          <div className="style-grid">
            {choices.map((c) => (
              <button
                key={c.id}
                className={`style-card sc-${c.id}${styleChoice === c.id ? ' selected' : ''}`}
                onClick={() => onPickStyle(c.id)}
                aria-pressed={styleChoice === c.id}
              >
                <span className="sc-preview" aria-hidden>
                  Aa
                </span>
                <span className="sc-name">{c.name}</span>
                <span className="sc-blurb">{c.blurb}</span>
              </button>
            ))}
          </div>
          <Toggle
            checked={settings.rememberPerSong}
            onChange={(v) => set({ rememberPerSong: v })}
            label="Remember the style and timing for each song"
          />
          <RememberedInfo songKey={settings.rememberPerSong ? songKey : null} onForgetSong={onForgetSong} />
          {vibe && (
            <p className="hint">
              This song feels <b>{vibe.label}</b>
              {vibe.wordsPerSecond > 0 && <> ({vibe.wordsPerSecond.toFixed(1)} words/sec)</>}. Auto would pick{' '}
              <b>{styleName(vibe.autoStyle)}</b>.
            </p>
          )}
        </Section>

        <ColorsSection settings={settings} />

        <TranslationSection settings={settings} />

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
          <Toggle
            checked={settings.flashWhileSinging}
            onChange={(v) => set({ flashWhileSinging: v })}
            label="Bass beats glow even while singing"
          />
          <Toggle checked={settings.fastFlashes} onChange={(v) => set({ fastFlashes: v })} label="Flash on every fast beat" />
          <p className="hint">
            Shows on strong beats in the split-second pauses between lines, and on every strong beat in songs without
            lyrics. With <b>Follow your PC’s sound</b> (Windows), every bass beat also glows while someone is singing, the harder the brighter. Never more than three times a second, soft and tinted (never white). It’s off with Reduce motion.
            <br />
            <b>Flash on every fast beat</b> lets the flash follow fast drum patterns, up to about seven times a second
            instead of three. Off by default: it is <b>not for anyone sensitive to flashing light</b>.
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

        {onRecord && (
          <Section title="Record for TikTok">
            <button className="btn primary wide" onClick={onRecord}>
              <PortraitIcon width={18} height={18} /> Start the recording view
            </button>
            <Toggle
              checked={settings.recordInfo}
              onChange={(v) => set({ recordInfo: v })}
              label="Show the cover and song name at the top"
            />
            <p className="hint">
              {native
                ? 'The lyrics fill a 9:16 frame on the full screen, with the status bar and every button hidden. Start your phone’s screen recorder, then open this. The Back button leaves it.'
                : 'The lyrics fill a 9:16 frame in the middle of a full screen, with every button hidden. Record the screen with OBS or any screen recorder, then crop to the frame (its size shows for a few seconds). Press R, Esc or the ✕ to leave.'}{' '}
              Everything stays inside TikTok’s safe area, away from its own buttons and caption. It keeps the screen awake, and
              the beat effects and lyric styles all work as usual.
            </p>
            <p className="hint">
              <b>Record without the song’s sound</b> (turn off the computer or phone audio in your recorder), then add the
              song inside TikTok with <b>Add sound</b>. A video that has the song’s audio inside the file gets flagged as
              copyrighted and muted.
            </p>
          </Section>
        )}

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
          <p className="hint">
            Just this song is off (for example after an Automix)? Nudge it here
            {native ? '' : <> or press <kbd>,</kbd> (later) and <kbd>.</kbd> (earlier), <kbd>&lt;</kbd> and <kbd>&gt;</kbd> for a tenth of a second</>}
            . It ends with the song, and the music keeps playing.
          </p>
          {onNudge && (
            <div className="row">
              <button className="btn small" onClick={() => onNudge(-500)}>
                Later
              </button>
              <span className="value">
                {songNudgeMs > 0 ? '+' : ''}
                {(songNudgeMs / 1000).toFixed(1)}s
              </span>
              <button className="btn small" onClick={() => onNudge(500)}>
                Earlier
              </button>
              <button className="btn small" onClick={onResetNudge} disabled={songNudgeMs === 0}>
                Reset
              </button>
            </div>
          )}
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
            wrap
            value={settings.background}
            onChange={(v) => set({ background: v })}
            options={[
              { value: 'art', label: 'Album art' },
              { value: 'fluid', label: 'Color flow' },
              { value: 'cover', label: 'Still cover' },
              { value: 'gradient', label: 'Calm gradient' },
              { value: 'black', label: 'Black' },
              { value: 'image', label: 'My picture' },
            ]}
          />
          {settings.background === 'image' && <WallpaperPicker />}
          <Toggle checked={settings.backgroundBeat} onChange={(v) => set({ backgroundBeat: v })} label="Background moves with the beat" />
          <p className="hint">
            <b>Album art</b> and <b>Color flow</b> drift slowly; <b>Still cover</b> is the cover, big and blurred; <b>Calm
            gradient</b> is the same colors, much slower; <b>Black</b> is plain black. With <b>Background moves with the
            beat</b> the moving looks swell a few percent on every beat and settle again, softly, with no change in
            brightness. It follows the real beat with <b>Follow your PC’s sound</b> (Windows); without it, it follows a
            gentle estimated rhythm, so it can be a little off. It’s off with Reduce motion.
          </p>
        </Section>

        <SleepSection />

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
          <Toggle
            checked={settings.fixBlendTiming}
            onChange={(v) => set({ fixBlendTiming: v })}
            label="Keep lyrics in time after a blend"
          />
          <p className="hint">
            After Spotify mixes into the next song by itself, it can report the song position a little ahead (about a
            second on a real setup), so the lyrics run early until Spotify refreshes it. This takes off what the app
            has measured on earlier blends (nothing until it has measured one). If the lyrics come late after a
            blend instead, switch it off.
          </p>
          <Toggle
            checked={settings.resyncAfterBlend}
            onChange={(v) => set({ resyncAfterBlend: v })}
            label="Re-sync the timing after a blend"
          />
          <p className="hint">
            Spotify’s own apps have the same problem: after a blend the song position stays wrong until Spotify refreshes
            it, which pausing and playing again does (so does seeking, the thing you would do by hand). A few seconds
            after a blend, Lyrics Stage pauses and plays the music for a split second to do that, measures how far off
            Spotify was, and learns from it. Once it can tell how far off Spotify will be (after about two blends), it
            stops pausing the music and just takes that off, checking again less and less often. In the desktop app,
            when the Spotify app on this computer is playing, it pauses that app directly, which makes the gap much
            shorter. It also tries quiet ways first (a one-step volume nudge and back, a repeat-mode change and
            back) and keeps using one if Spotify refreshes its position from it, so nothing is paused at all.
            Needs Spotify Premium. Switch it off if you don’t want the music touched.
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
          <p className="hint">
            Tones down movement and blur, turns off the album cover merge during Automix and the beat effects, and makes
            song changes quick instead of a slow blend.
            {systemReducesMotion() && (
              <>
                {' '}
                <b>Your system has animations turned off</b> (Windows: Settings → Accessibility → Visual effects →
                Animation effects), which is why this started switched on. Switch it off here to see them.
              </>
            )}
          </p>
        </Section>

        {desktopApp && <MusicAppSection settings={settings} />}

        {desktopApp && engineKind !== 'demo' && settings.musicApp === 'spotify' && (
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

        {timingHeader && <TimingReport header={timingHeader} />}

        {!native && (
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
              <kbd>,</kbd> / <kbd>.</kbd> lyrics later / earlier, this song only
            </li>
            <li>
              <kbd>Y</kbd> next style · <kbd>L</kbd> lyrics only · <kbd>F</kbd> fullscreen
            </li>
            <li>
              <kbd>R</kbd> recording view for TikTok (9:16) · <kbd>Esc</kbd> leaves it
            </li>
          </ul>
        </Section>
        )}

        {(engineKind === 'demo' || (engineKind === 'web-api' && !desktopApp)) && (
          <button className="btn ghost wide" onClick={onSignOut}>
            {engineKind === 'demo' ? 'Leave the demo' : 'Disconnect Spotify'}
          </button>
        )}
      </div>
    </aside>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  wrap = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  /** Let the buttons go onto several rows (for many choices). */
  wrap?: boolean;
}) {
  return (
    <div className={`segmented${wrap ? ' wrap' : ''}`} role="radiogroup">
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

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
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

/** A copyable note of what Spotify reported around the latest song changes, for finding timing problems. */
function TimingReport({ header }: { header: () => string[] }) {
  const [text, setText] = useState('');
  const copy = () => {
    const report = timingReport(header());
    setText(report);
    void navigator.clipboard?.writeText(report).then(
      () => toast('Timing report copied'),
      () => toast('Select the text below and copy it', 'error'),
    );
  };
  return (
    <Section title="Timing report">
      <p className="hint">
        Lyrics out of time after a song change (Automix, Crossfade)? Right after it happens, click this and paste the
        result to the developer. It only lists song positions and times; nothing is sent anywhere.
      </p>
      <button className="btn wide" onClick={copy}>
        Copy timing report
      </button>
      {text && <textarea className="report-text" readOnly rows={7} value={text} onFocus={(e) => e.currentTarget.select()} />}
    </Section>
  );
}

/** What is saved for songs: for the one playing now, and how many in all. */
function RememberedInfo({ songKey, onForgetSong }: { songKey: string | null; onForgetSong: () => void }) {
  const saved = useSongPrefs(songKey);
  const count = useRememberedCount();
  if (!songKey) {
    return <p className="hint">Each song keeps its own lyric style and timing nudge. Off, every song uses the style you pick here.</p>;
  }
  const bits = [saved?.style && 'a lyric style', saved?.nudgeMs && 'a timing nudge'].filter(Boolean).join(' and ');
  return (
    <>
      <p className="hint">
        Pick a style or nudge the timing while a song plays and it comes back the next time that song plays.{' '}
        {bits ? <>This song has {bits} saved.</> : 'Nothing is saved for this song yet.'}
      </p>
      <div className="row wrap-row">
        {saved && getSongPrefs(songKey) && (
          <button className="btn small" onClick={onForgetSong}>
            Forget this song
          </button>
        )}
        {count > 0 && (
          <button
            className="btn small"
            onClick={() => {
              forgetAllSongs();
              toast('Forgot every saved song');
            }}
          >
            Forget all {count} saved {count === 1 ? 'song' : 'songs'}
          </button>
        )}
      </div>
    </>
  );
}

/** Ready-made color themes, or one color of the user's own, instead of each cover's colors. */
function ColorsSection({ settings }: { settings: Settings }) {
  return (
    <Section title="Colors">
      <div className="theme-grid" role="radiogroup" aria-label="Color theme">
        {COLOR_THEMES.map((t) => {
          const swatch = t.id === 'custom' ? settings.customColor : t.accent;
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={settings.colorTheme === t.id}
              className={`theme-chip${settings.colorTheme === t.id ? ' selected' : ''}`}
              onClick={() => updateSettings({ colorTheme: t.id })}
            >
              <span
                className={`theme-dot${t.id === 'album' ? ' album' : ''}`}
                style={t.id === 'album' ? undefined : { background: swatch }}
                aria-hidden
              />
              {t.name}
            </button>
          );
        })}
      </div>
      {settings.colorTheme === 'custom' && (
        <label className="row color-pick">
          <input
            type="color"
            value={isHexColor(settings.customColor) ? settings.customColor : '#ff5a8a'}
            onChange={(e) => updateSettings({ customColor: e.target.value })}
            aria-label="Your color"
          />
          <span className="value left">{settings.customColor}</span>
        </label>
      )}
      <p className="hint">
        {themeAccent(settings.colorTheme, settings.customColor)
          ? 'The highlights, glows and color backgrounds use this color on every song. The Album art look still shows the cover.'
          : 'The colors come from each song’s cover.'}
      </p>
    </Section>
  );
}

/** A translation of the line being sung, in the language the user prefers. */
function TranslationSection({ settings }: { settings: Settings }) {
  const known = isTranslateLanguage(settings.translateTo);
  return (
    <Section title="Translation">
      <Toggle checked={settings.translate} onChange={(v) => updateSettings({ translate: v })} label="Show a translation under the lyrics" />
      <label className="field">
        <span>My language</span>
        <select
          value={known ? settings.translateTo : 'en'}
          onChange={(e) => updateSettings({ translateTo: e.target.value })}
          disabled={!settings.translate}
          aria-label="Translate into"
        >
          {TRANSLATE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        A small translation of the line being sung shows at the bottom, in the language you pick. Songs already in your
        language show nothing. The lyrics are sent to Google Translate to do this, and each song is only sent once; the
        translation is then kept in this browser. It needs the internet, and only works for lyrics with timing.
      </p>
    </Section>
  );
}

/** The sleep timer: pause the music after a while and dim the screen. */
function SleepSection() {
  const sleep = useSleepState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleep.endsAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sleep.endsAt]);
  return (
    <Section title="Sleep timer">
      <div className="row wrap-row">
        {SLEEP_CHOICES.map((m) => (
          <button key={m} className="btn small" onClick={() => startSleepTimer(m)}>
            {m} min
          </button>
        ))}
        {sleep.endsAt !== null && (
          <button className="btn small" onClick={cancelSleepTimer}>
            Cancel
          </button>
        )}
      </div>
      <p className="hint">
        {sleep.endsAt !== null ? (
          <>
            The music pauses in <b>{formatLeft(sleep.endsAt - now)}</b>.{' '}
          </>
        ) : (
          'Pick a time and the music pauses when it is up. '
        )}
        The screen slowly dims over the last minute, then goes dark until you touch it. It only lasts until you close
        the app.
      </p>
    </Section>
  );
}

/** "Background: My picture": choose a picture file from this computer or phone. */
function WallpaperPicker() {
  const picture = useWallpaper();
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      await setWallpaperFromFile(file);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That picture didn’t work.', 'error');
    }
  };
  return (
    <div className="wallpaper">
      {picture && <img className="wallpaper-thumb" src={picture} alt="Your background picture" />}
      <label className="btn small">
        {picture ? 'Change picture' : 'Choose a picture'}
        <input type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {picture && (
        <button className="btn small" onClick={clearWallpaper}>
          Remove
        </button>
      )}
      {!picture && <p className="hint">Pick a picture and it becomes the background (it is kept in this browser only).</p>}
    </div>
  );
}

/** Desktop app: which music app to follow. */
function MusicAppSection({ settings }: { settings: Settings }) {
  const app = settings.musicApp;
  return (
    <Section title="Music app">
      <Segmented
        value={app}
        onChange={(v) => updateSettings({ musicApp: v })}
        options={MUSIC_APPS.map((a) => ({ value: a, label: MUSIC_APP_LABEL[a] }))}
      />
      <p className="hint">
        {app === 'spotify' &&
          'Following the Spotify app on this computer (or your Spotify account, once you sign in).'}
        {app === 'apple' &&
          'Following the Apple Music app on this computer (Windows and Mac). Play and pause, skip and search open in Apple Music itself.'}
        {app === 'youtube' &&
          'Following whatever YouTube Music shows as playing on this computer, in your browser or in a YouTube Music app (Windows and Linux). If another tab or app is playing too, the one that is playing wins. Not on Mac yet.'}
      </p>
      {app !== 'spotify' && (
        <p className="hint">
          The lyrics are found by the song’s title and artist. Covers come from the app when it shares one, and are looked up
          otherwise. Automix timing tricks are Spotify-only, and so is “Up next” (the app has to know your queue).
        </p>
      )}
    </Section>
  );
}
