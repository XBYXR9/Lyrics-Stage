import { useEffect, useState } from 'react';
import { desktopApi, type UpdateStatus } from '../lib/desktopTypes';

/** Desktop app: where its own update stands (null in the browser). */
export function useAppUpdate(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => desktopApi()?.onUpdate(setStatus), []);
  return status;
}
