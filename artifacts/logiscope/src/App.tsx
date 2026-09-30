import { type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SiteShell } from '@/components/site-shell';
import { AuthGate, UNAUTHORIZED_EVENT } from '@/components/auth-gate';
import Home from '@/pages/home';
import Searches from '@/pages/searches';
import SearchDetail from '@/pages/search-detail';
import Likes from '@/pages/likes';
import NotFound from '@/pages/not-found';

// Une session expirée (401) renvoie à l'écran de mot de passe, quelle que soit la requête qui l'a découverte.
const onUnauthorized = (error: unknown) => {
  if (error && typeof error === 'object' && 'status' in error && error.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
  defaultOptions: { queries: { retry: (count, error) => !(error && typeof error === 'object' && 'status' in error && error.status === 401) && count < 1, refetchOnWindowFocus: false } },
});

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRoutes() {
  return <SiteShell><RoutedErrorBoundary><Switch>
    <Route path="/" component={Home}/>
    <Route path="/searches" component={Searches}/>
    <Route path="/searches/:id" component={SearchDetail}/>
    <Route path="/likes" component={Likes}/>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary></SiteShell>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthGate><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRoutes/></WouterRouter></AuthGate>
      <Toaster/>
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;