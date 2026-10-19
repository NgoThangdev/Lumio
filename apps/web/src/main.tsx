import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App.tsx';
import { applyAppearance, readAppearanceChoice } from './shared/ui/appearance';
import './index.css';

applyAppearance();
const appearanceMedia = window.matchMedia('(prefers-color-scheme: dark)');
appearanceMedia.addEventListener('change', () => {
  if (readAppearanceChoice() === 'system') applyAppearance('system');
});
window.addEventListener('storage', () => applyAppearance());

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(() => navigator.serviceWorker.ready)
        .then(() =>
          window.dispatchEvent(new Event('lumio:service-worker-ready')),
        )
        .catch((error: unknown) =>
          window.dispatchEvent(
            new CustomEvent('lumio:service-worker-error', { detail: error }),
          ),
        );
    },
    { once: true },
  );
}
