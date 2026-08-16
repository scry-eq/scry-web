import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Overlay } from './Overlay';
import { installPrefsSync } from '../state/prefsSync';
import '../index.css';

const rootEl = document.getElementById('overlay-root');
if (!rootEl) {
  throw new Error('#overlay-root not found');
}
// Follow the main window's preference changes rather than freezing whatever was
// stored when this window opened.
installPrefsSync();

createRoot(rootEl).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
