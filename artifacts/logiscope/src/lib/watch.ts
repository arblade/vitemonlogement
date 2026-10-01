import { getGetWatchedSearchQueryKey, useGetWatchedSearch } from '@workspace/api-client-react';

/**
 * La recherche suivie du compte (une au plus), pour les pastilles du site : nombre d'annonces arrivées depuis la
 * dernière ouverture. Relue chaque minute et au retour sur l'onglet (les passages ont lieu à 8 h et 18 h).
 */
export function useWatchedSearch() {
  const query = useGetWatchedSearch({ query: { queryKey: getGetWatchedSearchQueryKey(), refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 20_000, retry: false } });
  const search = query.data?.search ?? null;
  return { search, unseen: search?.unseenCount ?? 0 };
}
