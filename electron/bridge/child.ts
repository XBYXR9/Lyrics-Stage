// Runs a long-lived helper process (osascript / PowerShell) that prints one
// JSON object per line, and restarts it if it stops.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export function splitJsonLines(onObject: (o: unknown) => void) {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onObject(JSON.parse(line));
      } catch {
        /* ignore partial or non-JSON lines */
      }
    }
  };
}

export class JsonLineProcess {
  private child: ChildProcess | null = null;
  private stopped = true;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  lastError = '';

  constructor(
    private command: string,
    private args: string[],
    private onObject: (o: unknown) => void,
    private onExit: (error: string) => void = () => {},
    private options: SpawnOptions = {},
  ) {}

  start() {
    this.stopped = false;
    this.spawnChild();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    this.child?.kill();
    this.child = null;
  }

  /** Writes one line to the helper's stdin (used for commands on Windows). */
  send(line: string): boolean {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return false;
    stdin.write(line + '\n');
    return true;
  }

  private spawnChild() {
    let child: ChildProcess;
    try {
      child = spawn(this.command, this.args, { windowsHide: true, ...this.options });
    } catch (err) {
      this.lastError = String(err);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', splitJsonLines((o) => {
      this.failures = 0;
      this.onObject(o);
    }));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d: string) => (this.lastError = (this.lastError + d).slice(-2000)));
    child.on('error', (err) => (this.lastError = String(err)));
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this.onExit(this.lastError);
      this.scheduleRestart();
    });
  }

  private scheduleRestart() {
    if (this.stopped) return;
    this.failures++;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.failures, 4));
    this.restartTimer = setTimeout(() => this.spawnChild(), delay);
  }
}
