import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface SessionItem {
  id: string;
  title: string;
  createdAt: string;
  archived: boolean;
}

export interface SessionsResponse {
  sessions: SessionItem[];
}

export function useSessions(archived = false) {
  return useQuery({
    queryKey: [...queryKeys.sessions.all, { archived }],
    queryFn: () => apiGet<SessionsResponse>(`/api/sessions?archived=${archived}`),
  });
}
