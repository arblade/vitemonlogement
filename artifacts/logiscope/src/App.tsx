import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SiteShell } from '@/components/site-shell';
import Home from '@/pages/home';
import SearchDetail from '@/pages/search-detail';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRoutes() {
  return <SiteShell><RoutedErrorBoundary><Switch>
    <Route path="/" component={Home}/>
    <Route path="/searches/:id" component={SearchDetail}/>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary></SiteShell>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRoutes/></WouterRouter>
      <Toaster/>
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;