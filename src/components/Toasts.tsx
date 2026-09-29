// Tiny notification bubbles ("Added to queue", errors, etc).
import { useSyncExternalStore } from 'react';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = nextId++;
  toasts = [...toasts.filter((t) => t.text !== text), { id, text, tone }].slice(-3);
  emit();
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    },
    tone === 'error' ? 5000 : 2600,
  );
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
