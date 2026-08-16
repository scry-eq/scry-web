import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Must precede any store import — it renames the pre-Scry `showeq.` keys.
import './state/legacyKeys';
import { App } from './ui/App';
import { installSystemModeWatcher } from './state/theme';
import { installPrefsSync } from './state/prefsSync';
import { setRandomTitle } from './title';
import './index.css';

setRandomTitle();
installSystemModeWatcher();
// Keep this window's preferences in step with the other windows'.
installPrefsSync();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root not found');
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
