import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface Agent {
  id: string;
  name: string;
  type: string;
  description?: string;
}

interface AgentsResponse {
  agents: Agent[];
}

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents.all,
    queryFn: () => apiGet<AgentsResponse>('/api/agents'),
    select: (data) => data.agents,
  });
}
