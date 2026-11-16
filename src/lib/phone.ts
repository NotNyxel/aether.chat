/**
 * Phone layout, tablet layout or desktop layout. Phones get the phone layout upright or sideways (a
 * touch screen under 540px tall is a phone on its side). Tablets and iPads get the tablet layout:
 * the desktop arrangement made for touch. Sets <html data-ae-phone / data-ae-tablet / data-ae-touch>,
 * which the CSS keys off, and keeps them updated when the device rotates or the window resizes.
 */
export const PHONE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 540px)';
/** Tablets and iPads: a touch screen bigger than a phone, in either orientation. */
export const TABLET_QUERY = '(pointer: coarse) and (min-width: 768px) and (min-height: 541px)';
/** A touch screen as the main input. */
export const TOUCH_QUERY = '(pointer: coarse)';

export function isPhoneLayout(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;
}

export function isTabletLayout(): boolean {
  return typeof window !== 'undefined' && !isPhoneLayout() && window.matchMedia(TABLET_QUERY).matches;
}

export function installPhoneLayout(): void {
  if (typeof window === 'undefined') return;
  const queries = [PHONE_QUERY, TABLET_QUERY, TOUCH_QUERY].map((q) => window.matchMedia(q));
  const apply = () => {
    const root = document.documentElement.dataset;
    root.aePhone = String(isPhoneLayout());
    root.aeTablet = String(isTabletLayout());
    root.aeTouch = String(window.matchMedia(TOUCH_QUERY).matches);
  };
  apply();
  for (const mq of queries) mq.addEventListener('change', apply);
}

/**
 * A touch screen as the main input (phones and tablets in any orientation). Touch-first pieces (the
 * press-and-hold sheet, the reaction picker sheet) follow this, not the layout: a phone turned
 * sideways gets the wider desktop layout but still has no mouse to hover with.
 */
export function isTouchUi(): boolean {
  return typeof window !== 'undefined' && (isPhoneLayout() || window.matchMedia('(pointer: coarse)').matches);
}
