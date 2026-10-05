// Getting a finished lyric card out of the app: save it as a file, copy it, or send it on through the share sheet.
// What is possible depends on where the app runs: the desktop app and the website can save and copy (and share,
// where the browser has a share sheet), the Android app shares through Android's own share sheet.
import { isNativeApp } from './nativeApp';

export interface ShareAbilities {
  /** Download the picture as a file. */
  save: boolean;
  /** Put the picture on the clipboard, to paste into a chat or a post. */
  copy: boolean;
  /** Open the share sheet (Instagram, TikTok, Messages, Photos...). */
  share: boolean;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png');
    } catch {
      reject(new Error('The picture could not be made.'));
    }
  });
}

/** What this place can do with the picture. */
export function shareAbilities(): ShareAbilities {
  // Android's web view can neither download a file nor use the clipboard for pictures: only the share sheet works.
  if (isNativeApp()) return { save: false, copy: false, share: true };
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const copy = !!nav?.clipboard?.write && typeof ClipboardItem !== 'undefined';
  let share = false;
  try {
    const probe = new File([new Blob(['x'])], 'card.png', { type: 'image/png' });
    share = !!nav?.share && !!nav.canShare?.({ files: [probe] });
  } catch {
    share = false;
  }
  return { save: true, copy, share };
}

/** Saves the picture as a file (the desktop app asks where; a browser puts it in Downloads). */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function copyBlob(blob: Blob) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('The picture could not be read.'));
    r.readAsDataURL(blob);
  });
}

const cancelled = (err: unknown) => /cancel|abort|dismiss/i.test(err instanceof Error ? `${err.name} ${err.message}` : String(err));

/**
 * Opens the share sheet with the picture. Returns false when the person closed it without sharing, which is not an
 * error. In the Android app the picture is first written to the app's cache folder, which the share sheet can read.
 */
export async function shareBlob(blob: Blob, name: string, text: string): Promise<boolean> {
  try {
    if (isNativeApp()) {
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
      const written = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
      await Share.share({ title: text, text, files: [written.uri], dialogTitle: 'Share lyric card' });
      return true;
    }
    await navigator.share({ files: [new File([blob], name, { type: 'image/png' })], title: text, text });
    return true;
  } catch (err) {
    if (cancelled(err)) return false;
    throw err;
  }
}
