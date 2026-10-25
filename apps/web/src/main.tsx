import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider, UiProvider } from './components/ui';
import { KeelProvider } from './data/KeelProvider';
import './styles/base.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <KeelProvider>
        <UiProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </UiProvider>
      </KeelProvider>
    </BrowserRouter>
  </StrictMode>,
);
