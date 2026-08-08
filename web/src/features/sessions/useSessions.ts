import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface SessionItem {
  id: string;
  name: string;
  messageCount: number;
  lastTs: number;
  archived: boolean;
}

export interface SessionsResponse {
  sessions: SessionItem[];
  total: number;
  limit: number;
  offset: number;
}

export function useSessions(archived = false) {
  return useQuery({
    queryKey: [...queryKeys.sessions.all, { archived }],
    queryFn: () => apiGet<SessionsResponse>(`/api/sessions?archived=${archived}`),
  });
}
