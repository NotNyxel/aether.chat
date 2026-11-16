/**
 * Downloads every emoji image once, quietly in the background, the first time Aether runs on a
 * device (web, desktop and mobile), so the emoji picker and messages show them instantly later
 * instead of fetching each one on first sight. Low priority, a few at a time, only when the device
 * isn't asking to save data, and it resumes where it stopped if the app closes partway.
 * The images are long-lived files on a CDN, so the browser keeps them in its cache.
 */
import { loadEmoji } from './emoji';
import { emojiUrl } from './twemoji';

const KEY = 'aether.emojiWarm.v1'; // bump if the emoji set or CDN version changes
const PARALLEL = 4;

function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c?.saveData || c?.effectiveType === '2g' || c?.effectiveType === 'slow-2g';
}

let started = false;

export function warmEmojiCache(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  let done = 0;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'done') return;
    done = Number(v) || 0;
  } catch {
    /* storage blocked: still warm, just can't resume */
  }
  if (saveData()) return;
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 200));
  void loadEmoji()
    .then(async (data) => {
      // Skin-tone variants are only fetched when someone picks one; the base set is what the picker shows.
      const urls = [...new Set(data.list.map((e) => emojiUrl(e.emoji)))];
      let next = done;
      const worker = async () => {
        while (next < urls.length) {
          if (!navigator.onLine || saveData()) return;
          const i = next++;
          await fetch(urls[i]!, { mode: 'no-cors', cache: 'force-cache', priority: 'low' } as RequestInit).catch(() => {});
          if (i % 50 === 0) {
            try {
              localStorage.setItem(KEY, String(i));
            } catch {
              /* ignore */
            }
          }
        }
      };
      await new Promise<void>((resolve) => idle(() => resolve()));
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      if (next >= urls.length)
        try {
          localStorage.setItem(KEY, 'done');
        } catch {
          /* ignore */
        }
    })
    .catch(() => {});
}
