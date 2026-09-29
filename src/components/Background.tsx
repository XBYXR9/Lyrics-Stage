// The living background. Two looks:
//  • "art":   several copies of the album cover, slowly turning and drifting,
//             heavily blurred — the Apple Music full-screen look.
//  • "fluid": soft blobs of the cover's colors flowing around.
// It's drawn small (about 128px wide) and stretched, which keeps it cheap.
// Speed follows the song's energy, and on song changes the new background
// fades in over the same time as the lyric transition (long for Automix blends).
import { useEffect, useRef, type CSSProperties } from 'react';
import { loadImage } from '../lib/palette';
import type { BackgroundMode } from '../lib/settings';
import type { Palette } from '../lib/types';

interface BgLayer {
  img: HTMLImageElement | null;
  palette: Palette;
  born: number;
  fadeMs: number;
}

const W = 128;

export function Background({
  artUrl,
  palette,
  mode,
  motion,
  transitionMs,
  reduceMotion,
  shade,
}: {
  artUrl: string | null;
  palette: Palette;
  mode: BackgroundMode;
  motion: number;
  transitionMs: number;
  reduceMotion: boolean;
  /** 0..1 darkening so white lyrics stay readable on bright covers. */
  shade: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layers = useRef<BgLayer[]>([]);
  const opts = useRef({ mode, motion, reduceMotion });
  opts.current = { mode, motion, reduceMotion };

  // Add a new layer whenever the cover/palette changes.
  useEffect(() => {
    let alive = true;
    const add = (img: HTMLImageElement | null) => {
      if (!alive) return;
      layers.current.push({ img, palette, born: performance.now(), fadeMs: Math.max(300, transitionMs) });
      if (layers.current.length > 4) layers.current.splice(0, layers.current.length - 4);
    };
    if (artUrl) loadImage(artUrl).then(add, () => add(null));
    else add(null);
    return () => {
      alive = false;
    };
  }, [artUrl, palette]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d')!;
    // Safari before 18 can't blur on a canvas; fall back to a CSS blur there.
    const canFilter = typeof (ctx as { filter?: unknown }).filter === 'string';
    canvas.classList.toggle('css-blur', !canFilter);

    const resize = () => {
      const aspect = window.innerHeight / Math.max(1, window.innerWidth);
      const h = Math.max(48, Math.round(W * aspect));
      canvas.width = scratch.width = W;
      canvas.height = scratch.height = h;
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let last = 0;
    let t = 0; // animation time, advanced by `motion`
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return; // ~30 fps is plenty for a blurry background
      const dt = Math.min(100, now - last);
      last = now;
      const { mode, motion, reduceMotion } = opts.current;
      t += dt * (reduceMotion ? 0.15 : motion);

      const w = scratch.width;
      const h = scratch.height;
      const list = layers.current;
      // Drop layers fully covered by a newer, fully faded-in layer.
      while (list.length > 1 && now - list[1].born > list[1].fadeMs) list.shift();

      for (const layer of list) {
        const a = Math.min(1, (now - layer.born) / layer.fadeMs);
        const alpha = a * a * (3 - 2 * a); // smoothstep
        sctx.globalAlpha = alpha;
        sctx.fillStyle = layer.palette.base;
        sctx.fillRect(0, 0, w, h);
        if (mode === 'art' && layer.img) drawArt(sctx, layer.img, t, w, h, alpha);
        else drawFluid(sctx, layer.palette, t, w, h, alpha);
      }
      sctx.globalAlpha = 1;

      ctx.clearRect(0, 0, w, h);
      if (canFilter) {
        ctx.filter = 'blur(7px) saturate(1.35)';
        // Draw slightly larger so the blurred edges stay off-screen.
        ctx.drawImage(scratch, -w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
        ctx.filter = 'none';
      } else {
        ctx.drawImage(scratch, 0, 0);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="bg" aria-hidden>
      <canvas ref={canvasRef} className="bg-canvas" />
      <div className="bg-shade" style={{ '--shade': shade.toFixed(3) } as CSSProperties} />
    </div>
  );
}

function drawArt(ctx: CanvasRenderingContext2D, img: HTMLImageElement, t: number, w: number, h: number, alpha: number) {
  const size = Math.max(w, h);
  const spots = [
    { x: 0.3, y: 0.3, s: 1.5, spin: 1, a: 1 },
    { x: 0.75, y: 0.35, s: 1.1, spin: -1.3, a: 0.85 },
    { x: 0.35, y: 0.8, s: 1.2, spin: 0.8, a: 0.8 },
    { x: 0.8, y: 0.8, s: 0.9, spin: -0.7, a: 0.75 },
  ];
  spots.forEach((p, k) => {
    ctx.save();
    const cx = w * p.x + Math.sin(t * 0.00011 * (k + 1) + k) * w * 0.12;
    const cy = h * p.y + Math.cos(t * 0.00013 * (k + 1.3) + k * 2) * h * 0.12;
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.00006 * p.spin + k * 1.1);
    const s = size * p.s;
    ctx.globalAlpha = alpha * p.a;
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  });
}

function drawFluid(ctx: CanvasRenderingContext2D, palette: Palette, t: number, w: number, h: number, alpha: number) {
  const size = Math.max(w, h);
  palette.colors.forEach((color, k) => {
    const x = w * (0.5 + 0.38 * Math.sin(t * 0.00017 * (1 + k * 0.23) + k * 1.7));
    const y = h * (0.5 + 0.38 * Math.cos(t * 0.00013 * (1 + k * 0.31) + k * 2.3));
    const r = size * (0.45 + 0.12 * Math.sin(t * 0.0003 + k));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
