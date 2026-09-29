// Lyrics without timestamps: shown as a readable page that slowly scrolls
// along with the song (you can scroll it yourself too).
import { useRef } from 'react';
import { useFrame } from '../hooks/hooks';
import type { Clock } from '../lib/clock';
import type { Lyrics } from '../lib/types';

export function PlainLyrics({ lyrics, clock, durationMs }: { lyrics: Lyrics; clock: Clock; durationMs: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);

  useFrame((now) => {
    const el = ref.current;
    if (!el || now - userScrolledAt.current < 4000) return;
    const progress = durationMs > 0 ? Math.min(1, clock.now(now) / durationMs) : 0;
    // Start scrolling a bit after the intro, finish a bit before the end.
    const eased = Math.min(1, Math.max(0, (progress - 0.08) / 0.84));
    const target = (el.scrollHeight - el.clientHeight) * eased;
    el.scrollTop += (target - el.scrollTop) * 0.04;
  });

  return (
    <div
      className="plain"
      ref={ref}
      onWheel={() => (userScrolledAt.current = performance.now())}
      onTouchMove={() => (userScrolledAt.current = performance.now())}
    >
      <div className="plain-note">These lyrics aren't time-synced yet, so they scroll along roughly.</div>
      {lyrics.lines.map((line) =>
        line.text ? (
          <p key={line.id} className="plain-line" dir={line.rtl ? 'rtl' : undefined}>
            {line.text}
          </p>
        ) : (
          <div key={line.id} className="plain-gap" />
        ),
      )}
    </div>
  );
}
