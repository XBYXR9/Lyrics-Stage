// What a song without lyrics (or an instrumental) shows instead of words: a
// pulsing orb with bars around it, or a mirrored equalizer, in the album's
// colors. It moves with the sound on Windows (when the user allowed it) and with
// the estimated rhythm everywhere else. Strong beats punch it, and big beats
// send a shockwave across the screen. See src/lib/scene.ts for the shapes.
import { useEffect, useRef, type ReactNode } from 'react';
import { useFrame } from '../hooks/hooks';
import { readAudioLevels } from '../lib/audioLevels';
import { onBeat } from '../lib/beat';
import type { Clock } from '../lib/clock';
import { BAR_COUNT, estimatedBars } from '../lib/pulse';
import { isBigBeat, mean, mixHsl, punchShape, resampleLevels, rippleShape, RIPPLE_MS, withAlpha } from '../lib/scene';
import type { NoLyricsVisual } from '../lib/settings';
import type { Palette } from '../lib/types';

interface Ripple {
  at: number;
  strength: number;
}

const SPOKES = 48;
const EQ_BARS = 48;

export function BeatScene({
  visual,
  palette,
  clock,
  energy,
  title,
  subtitle,
}: {
  visual: Exclude<NoLyricsVisual, 'message'>;
  palette: Palette;
  clock: Clock;
  /** 0..1, how energetic the song feels: sets the speed of the estimated rhythm. */
  energy: number;
  title: string;
  subtitle?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const ripples = useRef<Ripple[]>([]);
  const last = useRef<Ripple>({ at: -Infinity, strength: 0 });
  const levels = useRef(new Float32Array(BAR_COUNT));
  const wide = useRef(new Float32Array(SPOKES / 2));
  const eq = useRef(new Float32Array(EQ_BARS / 2));

  useEffect(
    () =>
      onBeat((strength) => {
        const beat = { at: performance.now(), strength };
        last.current = beat;
        ripples.current.push(beat);
        if (ripples.current.length > 6) ripples.current.shift();
      }),
    [],
  );

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      size.current = { w, h, dpr };
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useFrame((now) => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const { w, h, dpr } = size.current;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Bar heights: the real sound, else the estimated rhythm; at rest while paused.
    const lv = levels.current;
    const t = clock.now(now);
    if (!clock.playing) {
      for (let i = 0; i < lv.length; i++) lv[i] = 0.05 + 0.03 * Math.sin(now / 900 + i * 0.4);
    } else if (!readAudioLevels(lv)) estimatedBars(lv, t, energy);

    const bass = mean(lv, 0, 6);
    const punch = punchShape(now - last.current.at, last.current.strength);
    ripples.current = ripples.current.filter((r) => now - r.at < RIPPLE_MS);

    if (visual === 'orb') drawOrb(ctx, w, h, palette, lv, wide.current, bass, punch, ripples.current, now);
    else drawEqualizer(ctx, w, h, palette, lv, eq.current, bass, punch, ripples.current, now);
  });

  return (
    <div className="beat-scene">
      <canvas ref={canvas} className="beat-canvas" aria-hidden />
      <div className="beat-caption">
        <div className="beat-caption-title">{title}</div>
        {subtitle && <div className="beat-caption-sub">{subtitle}</div>}
      </div>
    </div>
  );
}

function drawOrb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  lv: Float32Array,
  half: Float32Array,
  bass: number,
  punch: number,
  ripples: Ripple[],
  now: number,
) {
  const cx = w / 2;
  const cy = h * 0.5;
  const base = Math.min(w, h * 1.15) * 0.17;
  const r = base * (1 + punch + bass * 0.1);

  // A soft glow behind everything that swells with the bass.
  const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * (2.4 + bass * 0.8 + punch * 2));
  glow.addColorStop(0, withAlpha(p.accent, 0.28 + bass * 0.25 + punch * 0.4));
  glow.addColorStop(1, withAlpha(p.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Shockwaves: each strong beat sends a ring outward, a big beat sends a wide, bright one.
  for (const rp of ripples) {
    const s = rippleShape(now - rp.at, rp.strength);
    if (!s) continue;
    ctx.strokeStyle = withAlpha(isBigBeat(rp.strength) ? p.accent2 : p.accent, s.alpha);
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.arc(cx, cy, base * s.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Bars all the way round: low sounds at the bottom, high sounds at the top, mirrored left and right.
  resampleLevels(lv, half.length, half);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2.5, base * 0.07);
  for (let k = 0; k < SPOKES; k++) {
    const level = half[k < SPOKES / 2 ? k : SPOKES - 1 - k];
    const angle = Math.PI / 2 + (k / SPOKES) * Math.PI * 2;
    const from = r * 1.1;
    const to = from + base * (0.1 + level * 0.62) * (1 + punch * 1.6);
    // The two album colors blend smoothly all the way round: the first on the left, the second on the right, no seam.
    ctx.strokeStyle = mixHsl(p.accent, p.accent2, (1 + Math.cos(angle)) / 2, 0.5 + level * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * from, cy + Math.sin(angle) * from);
    ctx.lineTo(cx + Math.cos(angle) * to, cy + Math.sin(angle) * to);
    ctx.stroke();
  }

  // The orb itself.
  const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  body.addColorStop(0, withAlpha(p.accent2, 0.95));
  body.addColorStop(0.55, withAlpha(p.accent, 0.9));
  body.addColorStop(1, withAlpha(p.accent, 0.55));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawEqualizer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  lv: Float32Array,
  half: Float32Array,
  bass: number,
  punch: number,
  ripples: Ripple[],
  now: number,
) {
  const cx = w / 2;
  const cy = h * 0.5;
  const span = Math.min(w * 0.86, 1100);
  const slot = span / EQ_BARS;
  const maxH = Math.min(h * 0.62, 520);

  // A glow along the middle that swells with the bass, and a wide pulse on strong beats.
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, span * 0.6);
  glow.addColorStop(0, withAlpha(p.accent, 0.2 + bass * 0.22 + punch * 0.4));
  glow.addColorStop(1, withAlpha(p.accent, 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, (maxH * 0.5) / (span * 0.6));
  ctx.translate(-cx, -cy);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h * 4);
  ctx.restore();

  for (const rp of ripples) {
    const s = rippleShape(now - rp.at, rp.strength);
    if (!s) continue;
    ctx.strokeStyle = withAlpha(isBigBeat(rp.strength) ? p.accent2 : p.accent, s.alpha);
    ctx.lineWidth = s.width;
    const reach = (span / 2) * Math.min(1.2, 0.25 + (s.radius - 1.15) * 0.3);
    ctx.beginPath();
    ctx.ellipse(cx, cy, reach, reach * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Bars: lows in the middle, highs at the edges, mirrored up and down.
  resampleLevels(lv, half.length, half);
  const barW = slot * 0.62;
  const grad = ctx.createLinearGradient(0, cy - maxH / 2, 0, cy + maxH / 2);
  grad.addColorStop(0, withAlpha(p.accent2, 0.95));
  grad.addColorStop(0.5, withAlpha(p.accent, 1));
  grad.addColorStop(1, withAlpha(p.accent2, 0.95));
  ctx.fillStyle = grad;
  for (let i = 0; i < EQ_BARS; i++) {
    const level = half[Math.min(half.length - 1, Math.floor(Math.abs(i - (EQ_BARS - 1) / 2)))];
    const height = Math.max(barW, maxH * (0.04 + level * 0.96) * (1 + punch * 1.4));
    const x = cx - span / 2 + i * slot + (slot - barW) / 2;
    ctx.beginPath();
    ctx.roundRect(x, cy - Math.min(height, maxH * 1.15) / 2, barW, Math.min(height, maxH * 1.15), barW / 2);
    ctx.fill();
  }
}
