// Quiet ways to make Spotify report the song position again, without pausing the music.
//
// After a blend, Spotify keeps reporting a wrong position until its player publishes a fresh state. A pause and
// resume does that (and is heard). Other things the player answers, like a change of volume or of the repeat mode,
// might make it publish a fresh state too, with no gap at all. Nobody knows if they do, so the app tries them on its
// own: after a quiet attempt it looks at what Spotify reports, and if nothing changed it pauses and resumes as before,
// which shows whether the quiet attempt really did nothing. A quiet way that made the position jump is used from then
// on, every blend. This remembers what worked and what didn't.

/** One quiet attempt. It has to leave everything as it found it (volume, repeat mode). */
export interface SilentProbe {
  id: string;
  run: () => Promise<void>;
}

/** A change in the reported position of at least this much (ms) shows that Spotify refreshed it. */
export const PROBE_REFRESH_MIN_MS = 800;

/** How often one quiet way is tried in one run of the app while it shows nothing (the blend may simply have had no error). */
const MAX_TRIES = 2;

export interface ProbeMemorySaved {
  works: string | null;
  failed: string[];
}

export class ProbeMemory {
  works: string | null;
  failed: string[];
  private tries = new Map<string, number>();

  constructor(
    saved: ProbeMemorySaved = { works: null, failed: [] },
    private readonly onChange?: (s: ProbeMemorySaved) => void,
  ) {
    this.works = saved.works;
    this.failed = [...saved.failed];
  }

  /** The quiet way to use now: the one that works, else one not tried out yet. Null when there is none to try. */
  pick(available: string[]): string | null {
    if (this.works && available.includes(this.works)) return this.works;
    return available.find((id) => !this.failed.includes(id) && (this.tries.get(id) ?? 0) < MAX_TRIES) ?? null;
  }

  /** It was tried and showed nothing (maybe because this blend had no error). */
  noteTried(id: string) {
    this.tries.set(id, (this.tries.get(id) ?? 0) + 1);
  }

  markWorks(id: string) {
    this.works = id;
    this.failed = this.failed.filter((f) => f !== id);
    this.save();
  }

  markFailed(id: string) {
    if (this.works === id) this.works = null;
    if (!this.failed.includes(id)) this.failed.push(id);
    this.save();
  }

  describe() {
    return `quiet: works=${this.works ?? 'none yet'} failed=[${this.failed.join(',')}]`;
  }

  private save() {
    this.onChange?.({ works: this.works, failed: [...this.failed] });
  }
}

const STORE_KEY = 'ls.silentProbes.v1';

export function loadProbeMemory(): ProbeMemorySaved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    const works = typeof raw?.works === 'string' ? raw.works : null;
    const failed = Array.isArray(raw?.failed) ? raw.failed.filter((f: unknown) => typeof f === 'string') : [];
    return { works, failed };
  } catch {
    return { works: null, failed: [] };
  }
}

export function saveProbeMemory(s: ProbeMemorySaved) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: it just won't be remembered */
  }
}

/** Spotify said no to this (not allowed, not supported, not found): no point in trying it again. Not a network hiccup. */
export function isRefusal(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 400 || status === 403 || status === 404;
}
