import { BrowserRouter } from 'react-router';
import { useTranslation } from 'react-i18next';
import { NetworkStatus } from './NetworkStatus';
import { SessionBoundary } from './SessionBoundary';

export function App() {
  useTranslation();
  return (
    <BrowserRouter>
      <NetworkStatus />
      <SessionBoundary />
    </BrowserRouter>
  );
}
