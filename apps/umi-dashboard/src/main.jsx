import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '@lingui/react';
// Suppress React Router v6→v7 migration warnings — harmless in v6
import { AuthProvider } from '@/lib/auth.jsx';
import { i18n, initI18n } from '@/lib/i18n.js';
import App from './app.jsx';
import './styles.css';

// The catalog for the detected locale loads before the first paint, so no screen
// flashes message ids while the owner's language is still on the wire.
initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <I18nProvider i18n={i18n}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </I18nProvider>
    </React.StrictMode>,
  );
});
