import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet } from '@/lib/api';
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
    staleTime: 0, // 始终拉最新 session 列表，确保刚创建的 session 立即可见
  });
}

/**
 * 删除会话：后端 `DELETE /api/sessions/:id` 幂等返回 204。
 *
 * 成功后同时清理：
 * - `sessions.all` 列表缓存（侧边栏刷新）
 * - `sessions.detail(id)` / `sessions.history(id)` 单条缓存
 *
 * 调用方拿到被删除 id 后可自行决定是否跳转
 * （如「删的就是当前打开的会话 → 跳回空 /chat」）。
 */
export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/sessions/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.removeQueries({ queryKey: queryKeys.sessions.detail(id) });
      queryClient.removeQueries({ queryKey: queryKeys.sessions.history(id) });
    },
  });
}
