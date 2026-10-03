// The recording view: a portrait 9:16 frame (the shape of a TikTok video) in the
// middle of the screen, with nothing else on it. Record it with the screen
// recorder you already have, then crop to the frame.

/** Width ÷ height of a TikTok video. */
export const RECORD_ASPECT = 9 / 16;

export interface RecordFrame {
  width: number;
  height: number;
}

/** The biggest 9:16 frame that fits in a window of this size, in whole pixels. */
export function recordFrame(windowWidth: number, windowHeight: number): RecordFrame {
  const w = Math.max(1, Math.floor(windowWidth));
  const h = Math.max(1, Math.floor(windowHeight));
  const height = Math.min(h, Math.round(w / RECORD_ASPECT));
  return { width: Math.min(w, Math.round(height * RECORD_ASPECT)), height };
}

/** How tall the picture is: the screen normally, the 9:16 frame in the recording view. */
export function stageHeight(): number {
  return document.querySelector<HTMLElement>('.stage-frame')?.clientHeight || window.innerHeight;
}
