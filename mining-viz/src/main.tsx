import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { I18nProvider } from './lib/i18n';
import App from './App';
import { Toaster } from './components/ui/sonner';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" storageKey="mining-theme">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <I18nProvider>
            <App />
            <Toaster />
          </I18nProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
