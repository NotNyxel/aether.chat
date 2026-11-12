/** Opens the "Join a server" dialog from anywhere (links, deep links) without importing UI code. */
type Handler = (code: string) => void;
let handler: Handler | null = null;
let pending: string | null = null;

export function setJoinHandler(h: Handler | null) {
  handler = h;
  if (h && pending) {
    h(pending);
    pending = null;
  }
}

export function openJoinDialog(code: string) {
  if (handler) handler(code);
  else pending = code; // e.g. a link opened before signing in
}
