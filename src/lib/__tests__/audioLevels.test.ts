import { describe, expect, it } from 'vitest';
import { DelayLine, describeAudioError, LevelReader } from '../audioLevels';
import { BAR_COUNT } from '../pulse';

const BINS = 1024;

/** A made-up computer sound: every frequency at the same level (0..255), changeable while the test runs. */
function fakeSound(level = 0) {
  const sound = {
    level,
    looks: 0,
    fill(into: Uint8Array) {
      sound.looks++;
      into.fill(sound.level);
    },
  };
  return sound;
}

/** Reads 60 frames a second from `from` for `ms`, returning the strongest beat taken on the way. */
function run(reader: LevelReader, from: number, ms: number, out = new Float32Array(BAR_COUNT)) {
  let strongest = 0;
  let heard = false;
  for (let t = from; t < from + ms; t += 16) {
    heard = reader.read(t, out);
    strongest = Math.max(strongest, reader.takeBeat());
  }
  return { strongest, heard, end: from + ms };
}

describe('the song window', () => {
  it('ignores the computer’s sound completely while the window is closed', () => {
    const sound = fakeSound(40);
    const reader = new LevelReader((b) => sound.fill(b), 48000, BINS);
    const out = new Float32Array(BAR_COUNT);
    const calm = run(reader, 0, 1000);
    sound.level = 255; // something loud starts on the computer: a video, a ping
    const loud = run(reader, calm.end, 1000, out);
    expect(loud.heard).toBe(false);
    expect(loud.strongest).toBe(0);
    expect(sound.looks).toBe(0); // it doesn't even look at the sound
  });

  it('hears beats once the song is playing', () => {
    const sound = fakeSound(30);
    const reader = new LevelReader((b) => sound.fill(b), 48000, BINS);
    reader.setWindow(true);
    const quiet = run(reader, 0, 1000);
    expect(quiet.heard).toBe(true);
    expect(quiet.strongest).toBe(0); // steady sound is not a beat
    sound.level = 255;
    expect(run(reader, quiet.end, 300).strongest).toBeGreaterThan(0);
  });

  it('forgets a beat that was waiting when the song stops', () => {
    const sound = fakeSound(30);
    const reader = new LevelReader((b) => sound.fill(b), 48000, BINS);
    reader.setWindow(true);
    const quiet = run(reader, 0, 1000);
    sound.level = 255;
    const out = new Float32Array(BAR_COUNT);
    for (let t = quiet.end; t < quiet.end + 300; t += 16) reader.read(t, out); // a beat is now waiting
    reader.setWindow(false); // paused before it was used
    expect(reader.takeBeat()).toBe(0);
    expect(reader.read(quiet.end + 400, out)).toBe(false);
  });

  it('starts fresh when the song starts: loud music from the first second is not a beat', () => {
    const sound = fakeSound(30);
    const reader = new LevelReader((b) => sound.fill(b), 48000, BINS);
    reader.setWindow(true);
    run(reader, 0, 500);
    reader.setWindow(false);
    sound.level = 255; // already loud when the next song begins
    reader.setWindow(true);
    expect(run(reader, 2000, 600).strongest).toBe(0);
  });

  it('goes back to the estimate after a long silence', () => {
    const sound = fakeSound(120);
    const reader = new LevelReader((b) => sound.fill(b), 48000, BINS);
    reader.setWindow(true);
    expect(run(reader, 0, 500).heard).toBe(true);
    sound.level = 0;
    expect(run(reader, 500, 800).heard).toBe(true); // a short quiet moment keeps the bars
    expect(run(reader, 1300, 2500).heard).toBe(false);
  });
});

describe('the sound delay', () => {
  it('holds a beat back by the delay, for Bluetooth headphones', () => {
    const delayMs = 200;
    const sound = fakeSound(30);
    const reader = new LevelReader((b) => sound.fill(b), 48000, BINS);
    reader.setWindow(true);
    reader.setDelay(delayMs);
    const quiet = run(reader, 0, 1000);
    sound.level = 255;
    let firstBeatAt = -1;
    const out = new Float32Array(BAR_COUNT);
    for (let t = quiet.end; t < quiet.end + 800 && firstBeatAt < 0; t += 16) {
      reader.read(t, out);
      if (reader.takeBeat() > 0) firstBeatAt = t - quiet.end;
    }
    expect(firstBeatAt).toBeGreaterThanOrEqual(delayMs - 16);
    expect(firstBeatAt).toBeLessThan(delayMs + 120);
  });

  it('is limited to half a second', () => {
    const sound = fakeSound(30);
    const reader = new LevelReader((b) => sound.fill(b), 48000, BINS);
    reader.setWindow(true);
    reader.setDelay(5000);
    const quiet = run(reader, 0, 1000);
    sound.level = 255;
    let at = -1;
    const out = new Float32Array(BAR_COUNT);
    for (let t = quiet.end; t < quiet.end + 1500 && at < 0; t += 16) {
      reader.read(t, out);
      if (reader.takeBeat() > 0) at = t - quiet.end;
    }
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(700);
  });
});

describe('the delay line', () => {
  it('hands things out only once they are old enough, newest bars and strongest beat first', () => {
    const line = new DelayLine();
    const out = new Float32Array(2);
    line.push(0, [0.1, 0.1], 0);
    line.push(100, [0.5, 0.6], 0.8);
    line.push(200, [0.9, 0.9], 0.4);
    expect(line.release(-1, out)).toBeNull();
    expect(line.release(150, out)).toEqual({ beat: 0.8 });
    expect(Array.from(out).map((v) => +v.toFixed(2))).toEqual([0.5, 0.6]);
    expect(line.size).toBe(1);
    expect(line.release(150, out)).toBeNull(); // nothing new
    expect(line.release(300, out)).toEqual({ beat: 0.4 });
  });

  it('can be emptied', () => {
    const line = new DelayLine();
    line.push(0, [1], 1);
    line.clear();
    expect(line.size).toBe(0);
    expect(line.release(1000, new Float32Array(1))).toBeNull();
  });
});

describe('why listening failed', () => {
  it('says it in plain words', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name });
    expect(describeAudioError(named('NotAllowedError'))).toMatch(/click/i);
    expect(describeAudioError(named('NotFoundError'))).toMatch(/output/i);
    expect(describeAudioError(named('NotSupportedError'))).toMatch(/can’t listen/);
    expect(describeAudioError(named('NoSoundTrack'))).toMatch(/no sound/i);
    expect(describeAudioError(new Error('weird'))).toMatch(/couldn’t start/i);
    expect(describeAudioError(undefined)).toMatch(/couldn’t start/i);
  });
});
