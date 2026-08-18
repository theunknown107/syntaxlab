import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  // The element is static in index.html; if it is missing the document has
  // been tampered with or the bundle loaded into the wrong page.
  throw new Error('SyntaxLab: #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
