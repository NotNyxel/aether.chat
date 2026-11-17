/**
 * Shared by every website page (scripts/build-site.mjs): styles, sending app links to /app, and
 * Log in / Sign up → "Open Aether" when you're signed in.
 */
import './home.css';

// Links from account emails and the installed web app belong to the app, not the website.
const { search, hash } = window.location;
if (/access_token|refresh_token|error_description|[?&]code=|#goto=/.test(hash + search) || window.matchMedia('(display-mode: standalone)').matches) {
  window.location.replace(`/app${search}${hash}`);
}

let signedIn = false;
try {
  signedIn = !!localStorage.getItem('aether.auth');
} catch {
  /* storage blocked: show Log in / Sign up */
}
if (signedIn) {
  const auth = document.getElementById('auth');
  if (auth) auth.innerHTML = '<a class="btn primary" href="/app">Open Aether</a>';
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Nav: glass background once you scroll.
const nav = document.querySelector('.nav');
const onScroll = () => nav?.classList.toggle('scrolled', scrollY > 12);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Scroll reveal: sections and cards fade up as they arrive (staggered within a group).
if (!reduced && 'IntersectionObserver' in window) {
  const groups = ['.grid > article', '.feature-list > article', '.dl-grid > a', '.faq details', '.numbers > div', '.cols > .col', '.layouts-gallery > figure'];
  const items = new Set<HTMLElement>();
  for (const sel of groups) document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => (el.style.setProperty('--d', `${(i % 6) * 70}ms`), items.add(el)));
  document.querySelectorAll<HTMLElement>('main > section:not(.hero):not(.page-top) > :is(h2, .lead, .eyebrow, .tabs, figure, .show-text, .device, .cta, .more)').forEach((el) => items.add(el));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  for (const el of items) {
    // Already on screen at load: show without the jump.
    if (el.getBoundingClientRect().top < innerHeight * 0.92) continue;
    el.classList.add('rv');
    io.observe(el);
  }
}

// Cards: a soft light follows the cursor.
document.addEventListener('pointermove', (e) => {
  const card = (e.target as HTMLElement | null)?.closest?.('.grid article, .feature-list article') as HTMLElement | null;
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${e.clientX - r.left}px`);
  card.style.setProperty('--my', `${e.clientY - r.top}px`);
});

// Hero: the app tilts gently toward the cursor.
const tilt = document.querySelector<HTMLElement>('.tilt');
if (tilt && !reduced && matchMedia('(pointer: fine)').matches) {
  addEventListener('pointermove', (e) => {
    const x = e.clientX / innerWidth - 0.5;
    const y = e.clientY / innerHeight - 0.5;
    tilt.style.setProperty('--ry', `${-8 + x * 10}deg`);
    tilt.style.setProperty('--rx', `${4 - y * 8}deg`);
  });
}
