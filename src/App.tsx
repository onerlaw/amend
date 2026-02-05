import { MainLayout } from '@/components/Layout/MainLayout';
import { useTheme } from '@/hooks/useTheme';

function App() {
  useTheme();
  return <MainLayout />;
}

export default App;
