import { AppShell } from './app/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function App(): React.JSX.Element {
  return (
    <ErrorBoundary scope="app">
      <AppShell />
    </ErrorBoundary>
  );
}
