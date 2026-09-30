import { useQuery } from '@tanstack/react-query';

type AppConfig = { resultsPerCall: number };

// Limite de résultats par appel, telle que configurée sur le serveur (APIFY_RESULT_LIMIT).
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
