/**
 * Phone layout or desktop layout. Phones always get the phone layout, upright or sideways (a touch
 * screen under 540px tall is a phone on its side); tablets get it while held upright (portrait),
 * and the desktop layout when turned sideways. Sets <html data-ae-phone>, which the CSS keys off,
 * and keeps it updated when the device rotates or the window resizes.
 */
export const PHONE_QUERY = '(max-width: 767px), (orientation: portrait) and (pointer: coarse) and (max-width: 1199px), (pointer: coarse) and (max-height: 540px)';

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

/**
 * A touch screen as the main input (phones and tablets in any orientation). Touch-first pieces (the
 * press-and-hold sheet, the reaction picker sheet) follow this, not the layout: a phone turned
 * sideways gets the wider desktop layout but still has no mouse to hover with.
 */
export function isTouchUi(): boolean {
  return typeof window !== 'undefined' && (isPhoneLayout() || window.matchMedia('(pointer: coarse)').matches);
}
