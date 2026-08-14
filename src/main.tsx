import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Must precede any store import — it renames the pre-Scry `showeq.` keys.
import './state/legacyKeys';
import { App } from './ui/App';
import { installSystemModeWatcher } from './state/theme';
import { setRandomTitle } from './title';
import './index.css';

setRandomTitle();
installSystemModeWatcher();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root not found');
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
