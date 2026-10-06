// The Lyrics tab: Lyrics Stage grows out of the cover in the player bar until it fills the window, and shrinks back
// into it on the way out. It is a window opening (a clip), so the lyrics screen is always its full size and never squashed.
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export type OverlayPhase = 'open' | 'closing';

/** The shape of the window at the start: the cover's box, with rounded corners. */
export function clipFromRect(rect: { top: number; left: number; right: number; bottom: number } | null, width: number, height: number): string {
  if (!rect) return `inset(${height * 0.5}px ${width * 0.5}px ${height * 0.5}px ${width * 0.5}px round 12px)`;
  const clamp = (n: number, max: number) => Math.round(Math.min(Math.max(n, 0), max));
  return `inset(${clamp(rect.top, height)}px ${clamp(width - rect.right, width)}px ${clamp(height - rect.bottom, height)}px ${clamp(rect.left, width)}px round 10px)`;
}

const FULL = 'inset(0px 0px 0px 0px round 0px)';

export function LyricsOverlay({
  phase,
  origin,
  reduceMotion,
  onExited,
  children,
}: {
  phase: OverlayPhase;
  /** Where the cover is on screen (where the window opens from). */
  origin: DOMRect | null;
  reduceMotion: boolean;
  /** The closing animation is done: take the lyrics away. */
  onExited: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const exited = useRef(onExited);
  exited.current = onExited;

  // Runs before the first picture is painted, so there is never a flash of the full lyrics screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const small = clipFromRect(origin, window.innerWidth, window.innerHeight);
    const opening = phase === 'open';
    const frames: Keyframe[] = reduceMotion
      ? [{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }]
      : opening
        ? [{ clipPath: small, opacity: 0.4 }, { clipPath: FULL, opacity: 1 }]
        : [{ clipPath: FULL, opacity: 1 }, { clipPath: small, opacity: 0.2 }];
    const anim = el.animate(frames, {
      duration: reduceMotion ? 180 : opening ? 640 : 480,
      easing: opening ? 'cubic-bezier(0.22, 0.9, 0.2, 1)' : 'cubic-bezier(0.5, 0, 0.75, 0)',
      fill: 'both',
    });
    if (!opening) anim.onfinish = () => exited.current();
    return () => anim.cancel();
    // the shape is decided when the phase changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="lyrics-overlay" ref={ref} role="dialog" aria-label="Lyrics" aria-modal="true">
      {children}
    </div>
  );
}
