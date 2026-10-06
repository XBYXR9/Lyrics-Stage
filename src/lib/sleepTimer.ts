// The sleep timer: after the chosen time the music is paused and the screen goes dark. It lasts for this visit only.
import { useSyncExternalStore } from 'react';

/** The choices in Settings, in minutes. */
export const SLEEP_CHOICES = [15, 30, 45, 60, 90];
/** The screen starts to dim this long before the end. */
export const SLEEP_FADE_MS = 60_000;

export interface SleepState {
  /** When the music pauses (epoch ms), or null when no timer runs. */
  endsAt: number | null;
  /** The timer ran out: the screen stays dark until someone touches it. */
  done: boolean;
}

let state: SleepState = { endsAt: null, done: false };
const listeners = new Set<() => void>();

function set(next: SleepState) {
  state = next;
  listeners.forEach((l) => l());
}

export const getSleepState = () => state;
export const startSleepTimer = (minutes: number, now = Date.now()) => set({ endsAt: now + minutes * 60_000, done: false });
export const cancelSleepTimer = () => set({ endsAt: null, done: false });
export const finishSleepTimer = () => set({ endsAt: null, done: true });
export const wakeFromSleep = () => {
  if (state.done) set({ endsAt: null, done: false });
};

/** How dark the screen is: 0 (normal) to 0.92, growing over the last minute, and fully dark once the timer is done. */
export function sleepDim(endsAt: number | null, done: boolean, now: number): number {
  if (done) return 0.97;
  if (endsAt === null) return 0;
  const left = endsAt - now;
  if (left >= SLEEP_FADE_MS) return 0;
  return Math.min(0.92, Math.max(0, 1 - left / SLEEP_FADE_MS) * 0.92);
}

/** "12:05" or "45s" for a time left. */
export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSleepState(): SleepState {
  return useSyncExternalStore(subscribe, getSleepState);
}
