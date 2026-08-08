import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useProviders() {
  return useQuery({
    queryKey: queryKeys.providers.all,
    queryFn: () => apiGet<{ providers: any[]; activeId: string | null }>('/api/providers'),
  });
}
