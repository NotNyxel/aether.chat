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
