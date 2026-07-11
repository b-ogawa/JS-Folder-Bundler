import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { BabelPatcher } from './core/utils/BabelPatcher';

// Apply the Babel standalone internal API extraction patch
BabelPatcher.applyPatch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
