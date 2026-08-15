import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Overlay } from './Overlay';
import '../index.css';

const rootEl = document.getElementById('overlay-root');
if (!rootEl) {
  throw new Error('#overlay-root not found');
}
createRoot(rootEl).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
