// A soft glow and ring that pulse on strong beats during the short pauses
// between lines. On Windows with "Follow the real sound" on, the beats are heard
// in the music; everywhere else they come from the estimated rhythm (pulse.ts),
// which isn't locked to the real beat. See src/lib/beat.ts for the rules.
import { useRef } from 'react';
import { useFrame } from '../hooks/hooks';
import { readAudioLevels, takeBeat } from '../lib/audioLevels';
import { canFlash, flashShape, FLASH_MS, shortPauseAt } from '../lib/beat';
import type { Clock } from '../lib/clock';
import { BAR_COUNT, estimatedBeat } from '../lib/pulse';
import type { Lyrics } from '../lib/types';

export function BeatFlash({
  lyrics,
  clock,
  offsetMs,
  energy,
}: {
  lyrics: Lyrics;
  clock: Clock;
  offsetMs: number;
  /** 0..1, how energetic the song feels: sets the speed of the estimated rhythm. */
  energy: number;
}) {
  const glow = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const memory = useRef({ prevT: -1, at: -Infinity, strength: 0, dark: true });
  const scratch = useRef(new Float32Array(BAR_COUNT));

  useFrame((now) => {
    const m = memory.current;
    const t = clock.now(now) + offsetMs;

    // A strong beat this frame: heard in the music if we can, otherwise estimated.
    const heard = readAudioLevels(scratch.current);
    const real = takeBeat(); // always taken, so an old beat can't fire later
    const beat = heard ? real : estimatedBeat(m.prevT, t, energy);
    m.prevT = t;
    if (beat > 0 && shortPauseAt(lyrics.lines, t) && canFlash(now, m.at)) {
      m.at = now;
      m.strength = beat;
    }

    const age = now - m.at;
    if (age >= FLASH_MS) {
      if (!m.dark) {
        m.dark = true;
        if (glow.current) glow.current.style.opacity = '0';
        if (ring.current) ring.current.style.opacity = '0';
      }
      return;
    }
    m.dark = false;
    const shape = flashShape(age, m.strength);
    if (glow.current) glow.current.style.opacity = shape.glow.toFixed(3);
    if (ring.current) {
      ring.current.style.opacity = shape.ring.toFixed(3);
      ring.current.style.transform = `translate(-50%, -50%) scale(${shape.ringScale.toFixed(3)})`;
    }
  });

  return (
    <>
      <div className="beat-flash" ref={glow} aria-hidden />
      <div className="beat-ring" ref={ring} aria-hidden />
    </>
  );
}
