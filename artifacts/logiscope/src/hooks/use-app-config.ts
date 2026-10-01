import { useQuery } from '@tanstack/react-query';

type AppConfig = { liveDays: number };

// Réglages du serveur utiles à l'affichage : la recherche en direct couvre `liveDays` jours (LIVE_SEARCH_DAYS).
export function useAppConfig() {
  return useQuery({
    queryKey: ['app-config'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AppConfig> => {
      const response = await fetch('/api/config', { credentials: 'same-origin' });
      if (!response.ok) throw Object.assign(new Error('Configuration indisponible.'), { status: response.status });
      return response.json();
    },
  });
}
