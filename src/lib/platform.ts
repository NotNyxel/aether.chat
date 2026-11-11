/** Runtime environment helpers: Tauri desktop shell or a plain browser. */

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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
