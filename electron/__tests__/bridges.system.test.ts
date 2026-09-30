// Runs the real helper scripts on the operating system they're written for.
// These only run on that OS — the "Build desktop app" workflow runs the test
// suite on Windows and macOS machines, so they're checked there. Spotify isn't
// installed on those machines, so they check that each script starts, reports
// its state as JSON and handles commands without errors.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { splitJsonLines } from '../bridge/child';
import { JXA_LOOP } from '../bridge/mac';
import { encodePowerShell, SMTC_SCRIPT } from '../bridge/windows';

type Line = Record<string, unknown>;

function waitFor(check: () => boolean, ms: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${what}`));
      }
    }, 100);
  });
}

describe.runIf(process.platform === 'win32')('Windows media-controls script (real PowerShell)', () => {
  it('starts, reports its state as JSON and answers commands', async () => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(SMTC_SCRIPT)],
      { windowsHide: true },
    );
    const lines: Line[] = [];
    let stderr = '';
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', splitJsonLines((o) => lines.push(o as Line)));
    ps.stderr.setEncoding('utf8');
    ps.stderr.on('data', (d: string) => (stderr += d));
    try {
      await waitFor(() => lines.some((l) => 'running' in l) || stderr.length > 0, 30000, 'a state line');
      expect(stderr).toBe('');
      const state = lines.find((l) => 'running' in l)!;
      expect(state.error).toBeUndefined();
      expect(typeof state.at).toBe('number');
      // No Spotify on the test machine, so the command can't succeed — but it must get an answer.
      ps.stdin.write(JSON.stringify({ type: 'playpause', id: 7 }) + '\n');
      await waitFor(() => lines.some((l) => l.reply === 7), 15000, 'a reply to the command');
      expect(stderr).toBe('');
    } finally {
      ps.kill();
    }
  }, 60000);
});

describe.runIf(process.platform === 'darwin')('macOS AppleScript loop (real osascript)', () => {
  it('starts and reports its state as JSON', async () => {
    const child = spawn('osascript', ['-l', 'JavaScript', '-e', JXA_LOOP]);
    const lines: Line[] = [];
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', splitJsonLines((o) => lines.push(o as Line)));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => (stderr += d));
    try {
      await waitFor(() => lines.length > 0 || stderr.length > 0, 30000, 'a state line');
      expect(stderr).toBe('');
      const first = lines[0];
      // Spotify isn't installed on the test machine; either answer is fine as long as the script runs.
      expect(first.installed === false || first.running === false || first.running === true || 'error' in first).toBe(true);
      expect(typeof first.at).toBe('number');
    } finally {
      child.kill();
    }
  }, 60000);
});
