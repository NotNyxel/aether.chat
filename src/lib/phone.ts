/**
 * Phone layout or desktop layout. Phones always get the phone layout; tablets get it while held
 * upright (portrait), and the desktop layout when turned sideways. Sets <html data-ae-phone>,
 * which the CSS keys off, and keeps it updated when the device rotates or the window resizes.
 */
export const PHONE_QUERY = '(max-width: 767px), (orientation: portrait) and (pointer: coarse) and (max-width: 1199px)';

export function isPhoneLayout(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;
}

export function installPhoneLayout(): void {
  if (typeof window === 'undefined') return;
  const mq = window.matchMedia(PHONE_QUERY);
  const apply = () => (document.documentElement.dataset.aePhone = String(mq.matches));
  apply();
  mq.addEventListener('change', apply);
}
