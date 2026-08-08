import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useProviders() {
  return useQuery({
    queryKey: queryKeys.providers.all,
    queryFn: async () => {
      const [providers, active] = await Promise.all([
        apiGet<any[]>('/api/providers').catch(() => [] as any[]),
        apiGet<any>('/api/providers/active').then((d) => d?.id ?? null).catch(() => null),
      ]);
      return { providers: providers ?? [], activeId: active as string | null };
    },
  });
}
