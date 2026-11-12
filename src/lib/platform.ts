/** Runtime environment helpers: Tauri desktop shell or a plain browser. */

/** The desktop app (Windows, macOS, Linux). The Android app is the web app in a native shell, so it counts as web. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && !/Android|iPhone|iPad/i.test(navigator.userAgent);
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
/** The desktop app on macOS: native traffic-light buttons sit over our title bar. */
export const isMacApp = isTauri && /Mac OS X|Macintosh/i.test(ua);

/** Opens an http(s) link in the system browser, never inside the app's webview. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
