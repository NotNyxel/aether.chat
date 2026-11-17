import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './motion.css';
import './decor.css';
import './cosmetics.css';
// Name fonts (bundled; the desktop app's CSP doesn't allow remote fonts).
import '@fontsource/bebas-neue/400.css';
import '@fontsource/nunito/800.css';
import '@fontsource/pacifico/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/press-start-2p/400.css';
// Orbit layout (2.1) themes.
import '@fontsource-variable/plus-jakarta-sans/wght.css';
// Lounge layout (2.1) themes.
import '@fontsource-variable/outfit/wght.css';
// Workspace layout (2.1) themes.
import '@fontsource-variable/inter/wght.css';
import { isTauri } from './lib/platform';
import { installPhoneLayout } from './lib/phone';
import { loadLanguage } from './lib/i18n';

document.documentElement.dataset.aeWeb = String(!isTauri);
installPhoneLayout();

// The chosen language loads first (a few KB), then the app's code: labels defined when a module
// loads are then already in the right language.
void loadLanguage()
  .then(() => Promise.all([import('./App'), import('./components/ErrorBoundary'), import('./components/ThemeEngine')]))
  .then(([{ App }, { ErrorBoundary }, { ThemeProvider }]) =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ThemeProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ThemeProvider>
      </StrictMode>,
    ),
  );
