import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './components/ThemeEngine';
import './index.css';
import './motion.css';
import './decor.css';
// Name fonts (bundled; the desktop app's CSP doesn't allow remote fonts).
import '@fontsource/bebas-neue/400.css';
import '@fontsource/nunito/800.css';
import '@fontsource/pacifico/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/press-start-2p/400.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
