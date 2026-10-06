// The lyric card: pick a few lines of the song, and get a picture in the album's colors to post or send.
// The picture is painted by src/lib/lyricCard.ts; getting it out (save, copy, share) is in src/lib/shareCard.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cardFileName,
  cardFontFamily,
  cardLines,
  CARD_FORMATS,
  CARD_TEXT_STYLES,
  defaultSelection,
  drawCard,
  MAX_CARD_LINES,
  type CardFormat,
  type CardLook,
  type LyricLayout,
} from '../lib/lyricCard';
import { FALLBACK_PALETTE, getPalette, loadImage } from '../lib/palette';
import { canvasToBlob, copyBlob, saveBlob, shareAbilities, shareBlob } from '../lib/shareCard';
import type { Lyrics, Palette, StyleId, TrackInfo } from '../lib/types';
import { CloseIcon } from './Icons';
import { Section, Segmented, Toggle } from './SettingsPanel';
import { STYLES } from './styles';
import { toast } from './Toasts';

interface Prefs {
  format: CardFormat;
  look: CardLook;
  /** 'current' follows the lyric style chosen in the app; otherwise one specific style. */
  textStyle: 'current' | StyleId;
  showInfo: boolean;
  mark: boolean;
}

const PREFS_KEY = 'ls.card.v1';
const DEFAULT_PREFS: Prefs = { format: 'story', look: 'cover', textStyle: 'current', showInfo: true, mark: true };

/** What was chosen last time (a convenience, so it is fine when the browser keeps nothing). */
function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      format: CARD_FORMATS.some((f) => f.id === raw.format) ? (raw.format as CardFormat) : DEFAULT_PREFS.format,
      look: raw.look === 'gradient' ? 'gradient' : 'cover',
      textStyle: raw.textStyle && raw.textStyle in CARD_TEXT_STYLES ? (raw.textStyle as StyleId) : 'current',
      showInfo: raw.showInfo !== false,
      mark: raw.mark !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* not remembered */
  }
}

/** Waits for the page's web fonts (so the picture uses them), but never for long: offline they never come. */
const fontsReady = () =>
  Promise.race([
    Promise.all([
      document.fonts?.load('800 60px Inter'),
      document.fonts?.load('600 40px Inter'),
      document.fonts?.load('400 60px Tilt Neon'),
      document.fonts?.load('italic 600 60px Fraunces'),
      document.fonts?.load('400 60px Anton'),
      document.fonts?.load('400 60px Special Elite'),
      document.fonts?.load('400 60px VT323'),
    ]).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);

export function CardPanel({
  track,
  lyrics,
  playingMs,
  appStyle,
  onClose,
}: {
  track: TrackInfo;
  /** The lyric style showing in the app right now (what the card uses unless another one is picked). */
  appStyle: StyleId;
  lyrics: Lyrics | null;
  /** Where the song is now, to start with the line being sung (null: no timing to go by). */
  playingMs: number | null;
  onClose: () => void;
}) {
  const lines = useMemo(() => cardLines(lyrics?.lines ?? []), [lyrics]);
  const synced = lyrics?.kind === 'synced';
  const [selected, setSelected] = useState<number[]>(() => defaultSelection(lines, synced ? playingMs : null));
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [assets, setAssets] = useState<{ key: string; cover: HTMLImageElement | null; palette: Palette } | null>(null);
  const [fonts, setFonts] = useState(false);
  const [layout, setLayout] = useState<{ shown: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const abilities = useMemo(shareAbilities, []);

  const set = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });

  // A different song (or its lyrics arriving a moment later): start again from the line being sung.
  const songKey = `${track.key}|${lines.length}`;
  const [seenSong, setSeenSong] = useState(songKey);
  if (seenSong !== songKey) {
    setSeenSong(songKey);
    setSelected(defaultSelection(lines, synced ? playingMs : null));
  }

  useEffect(() => {
    let alive = true;
    void fontsReady().then(() => alive && setFonts(true));
    return () => {
      alive = false;
    };
  }, []);

  // The cover and its colors.
  useEffect(() => {
    let alive = true;
    const key = track.artUrl ?? '';
    Promise.all([track.artUrl ? loadImage(track.artUrl).catch(() => null) : Promise.resolve(null), getPalette(track.artUrl)]).then(
      ([cover, palette]) => alive && setAssets({ key, cover, palette }),
    );
    return () => {
      alive = false;
    };
  }, [track.artUrl]);

  const chosen = useMemo(() => lines.filter((l) => selected.includes(l.id)), [lines, selected]);

  const textStyle: StyleId = prefs.textStyle === 'current' ? appStyle : prefs.textStyle;

  // Paint the picture again whenever anything it shows changes.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !fonts || !chosen.length) return;
    const ready = assets && assets.key === (track.artUrl ?? '');
    const result: LyricLayout = drawCard(el, {
      format: prefs.format,
      look: prefs.look,
      textStyle,
      lines: chosen.map((l) => ({ text: l.text, rtl: l.rtl })),
      title: track.name,
      artist: track.artists.join(', '),
      cover: ready ? assets.cover : null,
      palette: ready ? assets.palette : FALLBACK_PALETTE,
      showInfo: prefs.showInfo,
      mark: prefs.mark,
      family: cardFontFamily(),
    });
    setLayout((prev) => (prev && prev.shown === result.shown && prev.total === result.total ? prev : { shown: result.shown, total: result.total }));
  }, [chosen, prefs, textStyle, assets, fonts, track.name, track.artists, track.artUrl]);

  // Show the lines that were picked at the start.
  useEffect(() => {
    // Scroll the list only (scrollIntoView would also scroll the whole panel up under its title).
    const box = list.current;
    const first = box?.querySelector('.card-line.on');
    if (box && first) box.scrollTop += first.getBoundingClientRect().top - box.getBoundingClientRect().top - (box.clientHeight - first.clientHeight) / 2;
    // only when the panel opens or the song changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songKey]);

  const toggleLine = (id: number) =>
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_CARD_LINES) {
        toast(`A card holds up to ${MAX_CARD_LINES} lines`);
        return cur;
      }
      return [...cur, id];
    });

  const name = cardFileName(track.name, track.artists.join(', '));
  const text = `${track.name} · ${track.artists.join(', ')}`;
  const act = (what: 'save' | 'copy' | 'share') => async () => {
    const el = canvas.current;
    if (!el || busy || !chosen.length) return;
    setBusy(true);
    try {
      const blob = await canvasToBlob(el);
      if (what === 'save') {
        saveBlob(blob, name);
        toast('Saving the picture…');
      } else if (what === 'copy') {
        await copyBlob(blob);
        toast('Picture copied. Paste it into a post or a chat.');
      } else await shareBlob(blob, name, text);
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'That didn’t work. Try another way.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const none = !lines.length;
  return (
    <aside className="panel glass card-panel" aria-label="Lyric card">
      <div className="panel-head">
        <h2>Lyric card</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close lyric card">
          <CloseIcon />
        </button>
      </div>

      <div className="panel-body">
        {none ? (
          <p className="panel-hint">
            {lyrics === null ? 'The lyrics are still loading.' : 'There are no lyrics to put on a card for this song.'}
          </p>
        ) : (
          <>
            <div className="card-preview">
              {chosen.length ? <canvas ref={canvas} aria-label="Preview of the card" /> : <p className="panel-hint">Pick a line below.</p>}
            </div>
            {layout && layout.shown < layout.total && (
              <p className="hint warn-text">Only the first {layout.shown} of the {layout.total} lines fit. Pick fewer or shorter lines.</p>
            )}
            <div className="card-actions">
              {abilities.share && (
                <button className="btn primary" onClick={act('share')} disabled={busy || !chosen.length}>
                  Share…
                </button>
              )}
              {abilities.save && (
                <button className={`btn${abilities.share ? '' : ' primary'}`} onClick={act('save')} disabled={busy || !chosen.length}>
                  Save picture
                </button>
              )}
              {abilities.copy && (
                <button className="btn" onClick={act('copy')} disabled={busy || !chosen.length}>
                  Copy
                </button>
              )}
            </div>

            <Section title="Lines">
              <div className="card-lines" ref={list} role="group" aria-label="Lines on the card">
                {lines.map((l) => {
                  const on = selected.includes(l.id);
                  return (
                    <button key={l.id} className={`card-line${on ? ' on' : ''}`} aria-pressed={on} dir={l.rtl ? 'rtl' : undefined} onClick={() => toggleLine(l.id)}>
                      {l.text}
                    </button>
                  );
                })}
              </div>
              <p className="hint">Tap lines to add or remove them (up to {MAX_CARD_LINES}).</p>
            </Section>

            <Section title="Shape">
              <Segmented
                value={prefs.format}
                onChange={(v) => set({ format: v })}
                options={CARD_FORMATS.map((f) => ({ value: f.id, label: `${f.label} ${f.ratio}` }))}
              />
              <p className="hint">
                {prefs.format === 'story'
                  ? 'For TikTok and Instagram stories. The text stays clear of the buttons and the caption that cover the top and the bottom.'
                  : prefs.format === 'post'
                    ? 'For Instagram and most feeds.'
                    : 'Works everywhere.'}
              </p>
            </Section>

            <Section title="Lyrics style">
              <div className="card-styles" role="radiogroup" aria-label="Lyrics style on the card">
                {[{ id: 'current' as const, name: 'Same as the app' }, ...STYLES].map((st) => (
                  <button
                    key={st.id}
                    role="radio"
                    aria-checked={prefs.textStyle === st.id}
                    className={`btn small${prefs.textStyle === st.id ? ' primary' : ''}`}
                    onClick={() => set({ textStyle: st.id })}
                  >
                    {st.name}
                  </button>
                ))}
              </div>
              <p className="hint">
                {prefs.textStyle === 'current'
                  ? 'The card is written in the lyric style you have on now, and follows it when you change it.'
                  : 'The card uses this style, whatever the app is showing.'}
              </p>
            </Section>

            <Section title="Look">
              <Segmented
                value={prefs.look}
                onChange={(v) => set({ look: v })}
                options={[
                  { value: 'cover', label: 'Blurred cover' },
                  { value: 'gradient', label: 'Colors' },
                ]}
              />
              <Toggle checked={prefs.showInfo} onChange={(v) => set({ showInfo: v })} label="Show the cover and song name" />
              <Toggle checked={prefs.mark} onChange={(v) => set({ mark: v })} label="Small “Lyrics Stage” mark" />
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}
