/**
 * Has this password shown up in a data breach? Uses HaveIBeenPwned's range API with k-anonymity:
 * only the first 5 characters of the password's SHA-1 hash are sent, never the password or the
 * full hash, and the match happens here on the device. Returns how many breaches it appeared in,
 * or 0 if it's clean or the check couldn't run (offline): a failed check never blocks you.
 */
export async function pwnedCount(password: string): Promise<number> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return 0;
    const suffix = hash.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** The message to show, or null if the password is fine. */
export async function pwnedMessage(password: string): Promise<string | null> {
  const n = await pwnedCount(password);
  if (!n) return null;
  return `This password has appeared in ${n.toLocaleString()} data breach${n === 1 ? '' : 'es'}, so attackers try it first. Pick a different one.`;
}
